import { expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { mechanicalSummaryBody } from "../../src/session/compaction"
import type { PlanStatePayload } from "../../src/util/plan-status"

/**
 * t130 reproducer — the layer-1 summary hands a robot another task's goal after its fold.
 *
 * Real shape (2026-10-21): three sessions whose `## Goal` named
 * `plans/2026-10-21_tui-standards-fixes.md` while none was ordered onto it.
 * t127 was ordered onto memory organisation (brief `t127-memory-organize.md`,
 * first user SV md5 `c7218c11…`); t129 onto verification; t123 onto its own order.
 *
 * Fixture copies that shape: planState holds the session's OWN plan plus a
 * newer unrelated plan (the TUI plan, newest-first as `collectPlanState` sorts),
 * and the range's first user message names ONLY the own plan.
 */

const msg = (id: string, role: "user" | "assistant", text: string) =>
  ({ info: { id, role }, parts: [{ type: "text", text }] }) as unknown as MessageV2.WithParts

const vector = (dominant: string, md5: string, prevMd5: string, parentGoal: string) =>
  ["Keywords: summary-goal-misattribution 0.35, robot-drift-after-fold 0.25", `Semantic dominant: ${dominant}`, `md5: ${md5}`, `prev-md5: ${prevMd5}`, `parent-goal-md5: ${parentGoal}`].join("\n")

const A = "aaaabbbbccccddddeeeeffff00001111"
const B = "11112222333344445555666677778888"
const C = "99998888777766665555444433332222"
const ZERO = "0".repeat(32)
const BRIEF_MD5 = "c7218c11aaaa1111bbbb2222cccc3333"

const OWN = "plans/2026-10-21_memory-organize.md"
const TUI = "plans/2026-10-21_tui-standards-fixes.md"

function planState(): PlanStatePayload {
  return {
    plans: [
      {
        file: TUI,
        lifecycle: "ACTIVE",
        intention: { from_state: "tui has no standards", to_state: "tui meets standards" },
        goal_sv: ["tui", "standards"],
        invariants: [],
        tasks: [{ id: "TASK-1", title: "tui fix one", sv: [], status: "PENDING", done_pct: null, attempts: 0 }],
      },
      {
        file: OWN,
        lifecycle: "ACTIVE",
        intention: { from_state: "memory is scattered", to_state: "memory is organised" },
        goal_sv: ["memory", "organise"],
        invariants: [],
        tasks: [{ id: "M1", title: "organise memory", sv: [], status: "PENDING", done_pct: null, attempts: 0 }],
      },
    ],
  }
}

function orderedOnOwn(): MessageV2.WithParts[] {
  return [
    msg("msg_1", "user", `Work on ${OWN} until it is done. Brief t127-memory-organize.`),
    msg("msg_2", "assistant", vector("organising memory", A, ZERO, BRIEF_MD5)),
    msg("msg_3", "assistant", vector("still organising", B, A, BRIEF_MD5)),
  ]
}

const section = (out: string, start: string, end: string) => {
  const a = out.indexOf(start)
  if (a < 0) return ""
  const b = out.indexOf(end, a + start.length)
  return b < 0 ? out.slice(a) : out.slice(a, b)
}

test("t130: a session ordered onto its own plan names THAT plan — never the newest unrelated one", () => {
  const out = mechanicalSummaryBody({ messages: orderedOnOwn(), diffs: [], planState: planState() })
  const goal = section(out, "## Goal", "## Plan")
  const next = section(out, "## Next Steps", "## Critical Context")
  expect(goal).toContain(OWN)
  expect(goal).toContain("memory is scattered -> memory is organised")
  expect(goal).not.toContain(TUI)
  expect(goal).not.toContain("tui meets standards")
  // Next Steps follow the same ownership: own box, never the other plan's.
  expect(next).toContain("organise memory")
  expect(next).not.toContain("tui fix one")
  expect(next).not.toContain(TUI)
})

test("t130-followup: plan-less first range falls back to its order, never no-goal stupor", () => {
  const messages: MessageV2.WithParts[] = [
    msg("msg_1", "user", "hello — no plan named in this brief, just verify the build"),
    msg("msg_2", "assistant", vector("verifying build", C, ZERO, ZERO)),
  ]
  const out = mechanicalSummaryBody({ messages, diffs: [], planState: planState() })
  const goal = section(out, "## Goal", "## Plan")
  const next = section(out, "## Next Steps", "## Critical Context")
  expect(goal).toContain("Session order msg_1")
  expect(goal).toContain("hello — no plan named in this brief, just verify the build")
  expect(goal).toContain("sessionread msg_1")
  expect(goal).not.toContain(TUI)
  expect(goal).not.toContain("tui meets standards")
  expect(goal.toLowerCase()).not.toContain("no goal found")
  expect(next).toContain("continue the session order msg_1")
  expect(next).not.toContain("tui fix one")
  expect(next).not.toContain(TUI)
})

test("t130-followup: later range of a plan-less session names the FIRST order with its SV, not the marker", () => {
  const orderText = [
    "Verify the build stands.",
    "",
    "Keywords: build-verify 0.50, stand-check 0.30, order-guard 0.20",
    "Semantic dominant: build stands verified",
    `md5: ${A}`,
    `prev-md5: ${ZERO}`,
    `parent-goal-md5: ${BRIEF_MD5}`,
  ].join("\n")
  const order: MessageV2.WithParts[] = [
    msg("msg_1", "user", orderText),
    msg("msg_2", "assistant", vector("checking the build", B, A, BRIEF_MD5)),
  ]
  const later: MessageV2.WithParts[] = [
    msg("msg_9", "assistant", vector("still checking", C, B, BRIEF_MD5)),
    msg("msg_10", "user", "=== COMPACTED ==="),
  ]
  const out = mechanicalSummaryBody({
    messages: later,
    diffs: [],
    planState: planState(),
    sessionMessages: [...order, ...later],
  })
  const goal = section(out, "## Goal", "## Plan")
  const next = section(out, "## Next Steps", "## Critical Context")
  expect(goal).toContain("Session order msg_1")
  expect(goal).toContain('dominant "build stands verified"')
  expect(goal).toContain("build-verify")
  expect(goal).toContain("sessionread msg_1")
  expect(goal).not.toContain("=== COMPACTED ===")
  expect(goal).not.toContain(TUI)
  expect(goal.toLowerCase()).not.toContain("no goal found")
  expect(next).toContain("continue the session order msg_1")
  expect(next).not.toContain(TUI)
})

test("t130-followup: a follow-up note refines the order but never replaces it", () => {
  const order: MessageV2.WithParts[] = [
    msg("msg_1", "user", "Verify the build stands."),
    msg("msg_2", "assistant", vector("checking the build", B, ZERO, ZERO)),
  ]
  const later: MessageV2.WithParts[] = [
    msg("msg_9", "assistant", vector("still checking", C, B, ZERO)),
    msg("msg_10", "user", "Also check the installer."),
  ]
  const out = mechanicalSummaryBody({
    messages: later,
    diffs: [],
    planState: planState(),
    sessionMessages: [...order, ...later],
  })
  const goal = section(out, "## Goal", "## Plan")
  expect(goal).toContain("Session order msg_1")
  expect(goal).toContain("Verify the build stands.")
  expect(goal).toContain("sessionread msg_1")
  expect(goal).toContain("latest note msg_10 refines it (does not replace it)")
  expect(goal).not.toContain("The range opens on the request: Also check")
  expect(goal).not.toContain(TUI)
})

test("t130-followup: no user order at all says no goal found and names the G0 move", () => {
  const messages: MessageV2.WithParts[] = [
    msg("msg_1", "assistant", vector("working with no order", C, ZERO, ZERO)),
    msg("msg_2", "assistant", vector("still no order", B, C, ZERO)),
  ]
  const out = mechanicalSummaryBody({ messages, diffs: [], planState: planState() })
  const goal = section(out, "## Goal", "## Plan")
  const next = section(out, "## Next Steps", "## Critical Context")
  expect(goal.toLowerCase()).toContain("no goal found")
  expect(goal).toContain("ask the delegator; do not invent a goal")
  expect(goal).not.toContain(TUI)
  expect(next).toContain("ask the delegator; do not invent a goal")
  expect(next).not.toContain(TUI)
})

test("t130: a later range still resolves the session brief that precedes it (full lineage)", () => {
  const brief: MessageV2.WithParts[] = [
    msg("msg_1", "user", `Work on ${OWN} until it is done. Brief t127-memory-organize.`),
    msg("msg_2", "assistant", vector("organising memory", A, ZERO, BRIEF_MD5)),
  ]
  const later: MessageV2.WithParts[] = [
    msg("msg_9", "assistant", vector("still organising, no plan named here", B, A, BRIEF_MD5)),
    msg("msg_10", "user", "continue"),
  ]
  const out = mechanicalSummaryBody({
    messages: later,
    diffs: [],
    planState: planState(),
    sessionMessages: [...brief, ...later],
  })
  const goal = section(out, "## Goal", "## Plan")
  const next = section(out, "## Next Steps", "## Critical Context")
  expect(goal).toContain(OWN)
  expect(goal).not.toContain(TUI)
  expect(next).toContain("organise memory")
  expect(next).not.toContain(TUI)
  expect(goal.toLowerCase()).not.toContain("no goal found")
})
