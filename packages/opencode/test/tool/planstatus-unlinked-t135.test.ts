/**
 * t135 addendum 3 — the linkage predicate and the count the planstatus tool prints.
 *
 * A plan is LINKED when its own SV names a master-plan goal (non-zero
 * parent-goal-md5). The tool counts exactly this predicate over parsePlanFiles,
 * so this file pins the predicate, the counting expression, and the fixture
 * pair — one linked, one unlinked — rather than re-asserting the tool's literal.
 */
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { isPlanLinked, parsePlanFiles } from "../../src/util/plan-status"

function fixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "planstatus-unlinked-"))
  mkdirSync(path.join(dir, "plans"), { recursive: true })
  writeFileSync(
    path.join(dir, "plans", "2026-02-01_linked.md"),
    [
      "# Linked",
      "",
      "<!-- intention: a linked fixture -> it resolves -->",
      "<!-- goal_sv: link, fixture -->",
      "",
      "```yaml",
      "Keywords: link 1.0",
      "Semantic dominant: a plan whose goal names its master.",
      "md5: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "prev-md5: 00000000000000000000000000000000",
      "parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a",
      "note: hash values are generative tags — search them, never compute them.",
      "```",
      "",
      "- [ ] **L1** — an open box <!-- sv: link-box -->",
      "",
    ].join("\n"),
  )
  writeFileSync(
    path.join(dir, "plans", "2026-02-02_unlinked.md"),
    [
      "# Unlinked",
      "",
      "<!-- intention: an unlinked fixture -> it is reported, not executed -->",
      "<!-- goal_sv: unlink, fixture -->",
      "",
      "```yaml",
      "Keywords: unlink 1.0",
      "Semantic dominant: a plan whose goal names nothing.",
      "md5: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "prev-md5: 00000000000000000000000000000000",
      "parent-goal-md5: 00000000000000000000000000000000",
      "note: hash values are generative tags — search them, never compute them.",
      "```",
      "",
      "- [ ] **U1** — an open box <!-- sv: unlink-box -->",
      "",
    ].join("\n"),
  )
  return dir
}

describe("plan linkage (t135 addendum 3)", () => {
  test("a zero parent names nothing; a named one links", () => {
    expect(isPlanLinked({ goal_parent: "0".repeat(32) })).toBe(false)
    expect(isPlanLinked({ goal_parent: undefined })).toBe(false)
    expect(isPlanLinked({ goal_parent: "f2e94a7cb5d18603e8a4c9d2f7b56e0a" })).toBe(true)
  })

  test("the tool's count is this predicate over parsePlanFiles: 1 of 2", () => {
    const dir = fixture()
    const plans = parsePlanFiles(dir)
    const unlinked = plans.filter((p) => !isPlanLinked(p)).map((p) => p.file)
    expect(unlinked).toEqual(["plans/2026-02-02_unlinked.md"])
  })
})
