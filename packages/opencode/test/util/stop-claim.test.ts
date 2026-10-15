import { describe, expect, test } from "bun:test"
import {
  cleanNextStateProblems,
  findCleanNextStateSection,
  findStopClaimSection,
  hasValidCleanNextState,
  hasValidStopClaim,
  stopClaimProblems,
} from "../../src/util/stop-claim"

// The «## Stop claim» form — t42 report §1.5/§2/§2.2, owner decision 2026-10-14 «Да + механизм».
// The measured red case it exists for: Codex parked a plan as BLOCKED after ONE refused route,
// reason = the refusal text, lift signal = a tautology, NO routes list (docs/robot-protocol-log.md:49).
// A form that only SOMETIMES demands the table is not binding; every piece below is named when missing.

const VALID = `# Parked probe

## Основание

Один маршрут отклонён политикой; работа остановлена.

## Stop claim

Ни один известный маршрут не достиг цели на этих попытках.

| route | receipt | failing component |
|---|---|---|
| cmd_runner start (direct) | 20261013T151834Z_19c6f90e — exit 1, WinError 5 | job breakaway denial |
| Terminal panel run_in_terminal | tab c2, host pid 18384 :63413 answered | port 4096 held by universal-search |

untried routes: an approval request; the second worktree's resident host
reopen_when: the runtime permits an independent host launch, or the port is free
`

describe("util.stop-claim section finder", () => {
  test("finds the section body and stops at the next level-2 heading", () => {
    const body = findStopClaimSection(VALID)
    expect(body).toBeDefined()
    expect(body).toContain("| route | receipt | failing component |")
    expect(body).toContain("untried routes:")
    // The finder must not leak the next section into the claim.
    expect(body).not.toContain("## Основание")
  })

  test("a text without the heading HAS no claim section", () => {
    expect(findStopClaimSection("# Just a report\n\nВсе хорошо.")).toBeUndefined()
    expect(hasValidStopClaim("# Just a report\n\nВсе хорошо.")).toBe(false)
  })
})

describe("util.stop-claim form", () => {
  test("the complete form is VALID — the positive control", () => {
    expect(stopClaimProblems(findStopClaimSection(VALID)!)).toEqual([])
    expect(hasValidStopClaim(VALID)).toBe(true)
  })

  test("a missing routes table is a named problem", () => {
    const text = `## Stop claim\n\nНи один маршрут не достиг цели.\n\nuntried routes: an approval request\nreopen_when: policy changes\n`
    const problems = stopClaimProblems(findStopClaimSection(text)!)
    expect(problems.some((p) => /routes table/i.test(p))).toBe(true)
    expect(hasValidStopClaim(text)).toBe(false)
  })

  test("a table missing the failing-component column is a named problem", () => {
    const text = `## Stop claim\n\n| route | receipt |\n|---|---|\n| A | run-1 |\n\nuntried routes: B\nreopen_when: X\n`
    expect(stopClaimProblems(findStopClaimSection(text)!).some((p) => /component/i.test(p))).toBe(true)
  })

  test("a table with zero data rows is a named problem", () => {
    const text = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n\nuntried routes: B\nreopen_when: X\n`
    expect(stopClaimProblems(findStopClaimSection(text)!).some((p) => /row/i.test(p))).toBe(true)
  })

  test("a row with an EMPTY receipt (a dash is not a receipt) is a named problem", () => {
    const text = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| cmd_runner | - | job breakaway |\n\nuntried routes: B\nreopen_when: X\n`
    const problems = stopClaimProblems(findStopClaimSection(text)!)
    expect(problems.some((p) => /receipt/i.test(p))).toBe(true)
  })

  test("an empty failing component cell is a named problem", () => {
    const text = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| cmd_runner | run-1 exit 1 | n/a |\n\nuntried routes: B\nreopen_when: X\n`
    expect(stopClaimProblems(findStopClaimSection(text)!).some((p) => /component/i.test(p))).toBe(true)
  })

  test("untried routes missing, or the bare word «none», is a named problem", () => {
    const missing = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| A | run-1 | policy |\n\nreopen_when: X\n`
    expect(stopClaimProblems(findStopClaimSection(missing)!).some((p) => /untried/i.test(p))).toBe(true)

    // The Codex shape: the tautology. A bare «none» states nothing about the route space.
    const bare = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| A | run-1 | policy |\n\nuntried routes: none\nreopen_when: X\n`
    expect(stopClaimProblems(findStopClaimSection(bare)!).some((p) => /untried/i.test(p))).toBe(true)
  })

  test("reopen_when missing or empty is a named problem; the «lift signal» spelling is accepted", () => {
    const missing = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| A | run-1 | policy |\n\nuntried routes: B\n`
    expect(stopClaimProblems(findStopClaimSection(missing)!).some((p) => /reopen/i.test(p))).toBe(true)

    const empty = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| A | run-1 | policy |\n\nuntried routes: B\nreopen_when:\n`
    expect(stopClaimProblems(findStopClaimSection(empty)!).some((p) => /reopen/i.test(p))).toBe(true)

    // §2.2: the resume condition IS the postponed template's «lift signal» — same field, two spellings.
    const lift = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| A | run-1 | policy |\n\nuntried routes: B\nlift signal: the policy changes\n`
    expect(stopClaimProblems(findStopClaimSection(lift)!)).toEqual([])
  })

  test("heading spellings are accepted too — a reader that knows one form declares the rest absent", () => {
    const text = `## Stop claim\n\n| route | receipt | failing component |\n|---|---|---|\n| A | run-1 | policy |\n\n### Untried routes\n\nAn approval request; the resident host of the second worktree.\n\n### Reopen when\n\nThe runtime permits an independent launch.\n`
    expect(stopClaimProblems(findStopClaimSection(text)!)).toEqual([])
    expect(hasValidStopClaim(text)).toBe(true)
  })

  test("the claim's table must not be borrowed from the NEXT section", () => {
    const text = `## Stop claim\n\nТут нет таблицы.\n\n## Risks\n\n| route | receipt | failing component |\n|---|---|---|\n| A | run-1 | policy |\n\nuntried routes: none\nreopen_when: never\n`
    expect(hasValidStopClaim(text)).toBe(false)
  })
})

// ── «## Clean next state» — the form that lets a turn END (plan 2026-10-15 B3, audit F2) ──
// The kernel removed the BLOCKED terminal: blocked is not an exit — name the next action and do
// it; when the run limit is really reached, the turn ends with a `## Clean next state` section
// (completed, residual, next action, continuation receipt). That section, not a stop claim, is
// what lets the turn end. The stop-claim form above stays for the PLAN side (plans/postponed/
// audits in util/plan-status.ts) — the two forms answer different questions.

const CLEAN_VALID = `## Clean next state

completed: the reproducer and the red tests
residual: the gated install of the kernel pipeline
next action: run the install after the review
continuation receipt: plans/2026-10-15_kernel-continuation-without-blocked.md B2
`

describe("util.stop-claim / clean next state", () => {
  test("finds the section body and stops at the next level-2 heading", () => {
    const body = findCleanNextStateSection(CLEAN_VALID + "\n## Risks\n\nnone\n")
    expect(body).toBeDefined()
    expect(body).toContain("completed:")
    expect(body).not.toContain("## Risks")
  })

  test("the complete form is VALID — the positive control", () => {
    expect(cleanNextStateProblems(findCleanNextStateSection(CLEAN_VALID)!)).toEqual([])
    expect(hasValidCleanNextState(CLEAN_VALID)).toBe(true)
  })

  test("a text without the heading has no clean-next-state section", () => {
    expect(findCleanNextStateSection("# Just a report\n\nВсе хорошо.")).toBeUndefined()
    expect(hasValidCleanNextState("# Just a report\n\nВсе хорошо.")).toBe(false)
  })

  test("each of the four fields missing is a NAMED problem", () => {
    for (const name of ["completed", "residual", "next action", "continuation receipt"]) {
      const section = CLEAN_VALID.replace(new RegExp(`^${name}:.*$`, "im"), "")
      const problems = cleanNextStateProblems(findCleanNextStateSection(section)!)
      expect(problems.some((p) => p.startsWith(name))).toBe(true)
    }
  })

  test("an empty or dash value is a named problem — a dash is not a field", () => {
    const empty = CLEAN_VALID.replace(/^residual:.*$/im, "residual:")
    expect(cleanNextStateProblems(findCleanNextStateSection(empty)!).some((p) => p.startsWith("residual"))).toBe(true)
    const dashed = CLEAN_VALID.replace(/^next action:.*$/im, "next action: -")
    expect(cleanNextStateProblems(findCleanNextStateSection(dashed)!).some((p) => p.startsWith("next action"))).toBe(true)
    expect(hasValidCleanNextState(empty)).toBe(false)
  })

  test("heading spellings and underscore spellings are accepted too", () => {
    const headed =
      "## Clean next state\n\n### Completed\n\nthe reproducer.\n\n### Residual\n\nthe install.\n\n### Next action\n\nrun it.\n\n### Continuation receipt\n\nplans/2026-10-15_kernel-continuation-without-blocked.md B2\n"
    expect(cleanNextStateProblems(findCleanNextStateSection(headed)!)).toEqual([])
    const underscored =
      "## Clean next state\n\ncompleted: the reproducer.\nresidual: the install.\nnext_action: run it.\ncontinuation_receipt: plans/2026-10-15_kernel-continuation-without-blocked.md B2\n"
    expect(hasValidCleanNextState(underscored)).toBe(true)
  })

  test("the section's fields must not be borrowed from the NEXT section", () => {
    const text = "## Clean next state\n\nТут ничего нет.\n\n## Details\n\ncompleted: x\nresidual: y\nnext action: z\ncontinuation receipt: w\n"
    expect(hasValidCleanNextState(text)).toBe(false)
  })
})
