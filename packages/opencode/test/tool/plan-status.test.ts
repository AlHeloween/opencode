/**
 * The tick report (owner, 2026-09-22): «у нас в оркестраторе есть подсчёт галок — сделай тулзу, чтобы
 * получить этот отчёт, для того чтобы держать репозиторий правильно».
 *
 * Two properties are pinned, and they fail in different places. The REPORT is checked on a fixture, so a
 * wrong count is a red test rather than a wrong repository. The NAME is checked in the three surfaces a
 * wire name must appear in — `registry.ts` (the definition and the builtin list) and
 * `util/dsml-normalizer.ts` — because a name missing from the last one fails SILENTLY and only for
 * DeepSeek: the model emits a call nobody recognises, and nothing anywhere says why.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { formatPlanHygiene, getPlanStatus, planDebt } from "../../src/util/plan-status"

function fixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plan-status-"))
  mkdirSync(path.join(dir, "plans"), { recursive: true })
  mkdirSync(path.join(dir, "plans_completed"), { recursive: true })
  return dir
}

describe("the tick report", () => {
  test("names the terminals, and calls a plan in the wrong one misplaced", () => {
    const dir = fixture()
    writeFileSync(path.join(dir, "plans", "2026-01-01_open.md"), "# Open\n\n- [ ] one\n- [x] done\n")
    writeFileSync(path.join(dir, "plans", "2026-01-02_finished.md"), "# Finished\n\n- [x] one\n")
    // Kernel-authored plans carry workflow:/sv: tags — their BOXES are authoritative, so a plan with
    // open boxes in plans_completed/ is misplaced and reopenable.
    writeFileSync(
      path.join(dir, "plans_completed", "2026-01-03_kernel-open.md"),
      "# Late\n\n<!-- workflow: gated -->\n\n- [ ] never closed\n",
    )
    // A LOOSE plan is user-curated: placement decides completion, and it is never auto-reopened even
    // with open boxes (plan-status.ts:55). The pin holds BOTH sides, because the seam is the rule.
    writeFileSync(path.join(dir, "plans_completed", "2026-01-04_loose-open.md"), "# Loose\n\n- [ ] also open\n")

    const status = getPlanStatus(dir)
    expect(status.active).toEqual(["2026-01-01_open.md"])
    // A plan in plans/ with no open box belongs to plans_completed/; a kernel-authored plan in
    // plans_completed/ with one belongs back in plans/. Both directions are the SAME defect read from
    // opposite sides — and the loose one is NOT a defect, by design.
    expect(status.misplaced.some((f) => f.includes("2026-01-02_finished.md"))).toBe(true)
    expect(status.misplaced.some((f) => f.includes("2026-01-03_kernel-open.md"))).toBe(true)
    expect(status.misplaced.some((f) => f.includes("2026-01-04_loose-open.md"))).toBe(false)

    // The debt counts plans/ only — completed work owes nothing — and it counts the FULL set, which is
    // what `owed` in the status note reads: the capped head view is an address, this is the measure.
    expect(planDebt(dir)).toEqual({ plans: 2, open: 1 })

    const report = formatPlanHygiene(status)
    expect(report).toContain("Plan progress:")
    expect(report).toContain("Misplaced:")
  })

  test("the wire name is in the registry and in the normalizer — all three surfaces", () => {
    const read = (rel: string) => readFileSync(path.join(import.meta.dir, "../..", rel), "utf8")
    const registry = read("src/tool/registry.ts")
    expect(registry).toContain("planstatus: Tool.init(planStatus)")
    expect(registry).toContain("tool.planstatus,")
    expect(read("src/util/dsml-normalizer.ts")).toContain('"planstatus"')
  })
})
