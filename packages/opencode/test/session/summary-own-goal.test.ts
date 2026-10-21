import { expect, test } from "bun:test"
import type { MessageV2 } from "../../src/session/message-v2"
import { hasExplicitRebindCue, mechanicalSummaryBody, REBIND_CUE } from "../../src/session/compaction"
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

test("review2: order-named plan absent from the mirror shows the order, never another plan", () => {
  // Measured on ses_ea267453: the order names plans/2026-10-21_delegator-memory-repair.md,
  // the mirror has no such file, and newest-mention bound the foreign TUI plan.
  const GHOST = "plans/2026-10-21_delegator-memory-repair.md"
  const order: MessageV2.WithParts[] = [
    msg("msg_1", "user", `Repair the delegator memory index per ${GHOST}.`),
    msg("msg_2", "assistant", vector("repairing", A, ZERO, BRIEF_MD5)),
  ]
  const later: MessageV2.WithParts[] = [
    msg("msg_9", "assistant", vector("still repairing", B, A, BRIEF_MD5)),
    msg("msg_10", "user", `noted that ${TUI} is active today`),
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
  expect(goal).toContain(GHOST)
  expect(goal).toContain("not in the plan mirror")
  expect(goal).not.toContain(TUI)
  expect(goal).not.toContain("tui meets standards")
  expect(next).toContain(`No owed task in ${GHOST}`)
  expect(next).not.toContain(TUI)
})

test("review2: a plan mentioned in passing never becomes the goal", () => {
  const order: MessageV2.WithParts[] = [
    msg("msg_1", "user", `Work on ${OWN} until it is done.`),
    msg("msg_2", "assistant", vector("organising", A, ZERO, BRIEF_MD5)),
  ]
  const later: MessageV2.WithParts[] = [
    msg("msg_9", "assistant", vector("still organising", B, A, BRIEF_MD5)),
    msg("msg_10", "user", `saw ${TUI} mentioned in the status note today`),
  ]
  const out = mechanicalSummaryBody({
    messages: later,
    diffs: [],
    planState: planState(),
    sessionMessages: [...order, ...later],
  })
  const goal = section(out, "## Goal", "## Plan")
  const next = section(out, "## Next Steps", "## Critical Context")
expect(goal).toContain(OWN)
  expect(goal).toContain("memory is scattered -> memory is organised")
  // Carrier semantics, as the t132 sample reads them: the intention part names the
  // own plan; the range's own request (with its passing mention) rides after the split.
  const carrier8 = goal.split(" In this range the user asked:")[0]!
  expect(carrier8).toContain(OWN)
  expect(carrier8).not.toContain(TUI)
  expect(goal).toContain(`saw ${TUI} mentioned in the status note today`)
  expect(next).toContain("organise memory")
  expect(next).not.toContain(TUI)
})

test("review2: an explicit later note rebinds the goal plan (capability pin, passes before and after)", () => {
  const order: MessageV2.WithParts[] = [
    msg("msg_1", "user", `Work on ${OWN} until it is done.`),
    msg("msg_2", "assistant", vector("organising", A, ZERO, BRIEF_MD5)),
  ]
  const later: MessageV2.WithParts[] = [
    msg("msg_9", "assistant", vector("still organising", B, A, BRIEF_MD5)),
    msg("msg_10", "user", `Switch to ${TUI} now — the delegator reordered the day.`),
  ]
  const out = mechanicalSummaryBody({
    messages: later,
    diffs: [],
    planState: planState(),
    sessionMessages: [...order, ...later],
  })
  const goal = section(out, "## Goal", "## Plan")
  expect(goal).toContain(TUI)
  expect(goal).toContain("tui has no standards -> tui meets standards")
  expect(goal).not.toContain(OWN)
})

test("review3b: a descriptive must-move-to note never rebinds (ckpt_15d0ee621)", () => {
  const KIT = "plans/2026-10-21_portable-delegation-kit.md"
  const kitState: PlanStatePayload = {
    plans: [
      {
        file: KIT,
        lifecycle: "ACTIVE",
        intention: { from_state: "procedure pinned", to_state: "kit tracked" },
        goal_sv: ["kit"],
        invariants: [],
        tasks: [{ id: "K1", title: "inventory", sv: [], status: "PENDING", done_pct: null, attempts: 0 }],
      },
    ],
  }
  const t120 = [
    "# t120 — the delegation procedure must move to another machine: plan the portable kit (plan only)",
    "",
    `See ${KIT} for the piece list.`,
  ].join("\n")
  const lineage: MessageV2.WithParts[] = [
    msg("msg_1", "user", "Handshake the day: what is on the agenda?"),
    msg("msg_2", "assistant", vector("handshaking", A, ZERO, ZERO)),
    msg("msg_9", "assistant", vector("working", B, A, ZERO)),
    msg("msg_10", "user", t120),
  ]
  const out = mechanicalSummaryBody({
    messages: lineage.slice(2),
    diffs: [],
    planState: kitState,
    sessionMessages: lineage,
  })
  const goal = section(out, "## Goal", "## Plan")
  // The old vocabulary still sees its verb here — the gate, not the vocabulary, refuses it.
  expect(REBIND_CUE.test(t120)).toBe(true)
  expect(hasExplicitRebindCue(t120)).toBe(false)
  expect(hasExplicitRebindCue(`Switch to ${KIT} now.`)).toBe(true)
  expect(goal).toContain("Session order msg_1")
  expect(goal).not.toContain(KIT)
})

test("review3b: a window without the first order points LOUD at dbread, never silent", () => {
  const messages: MessageV2.WithParts[] = [
    msg("msg_1", "assistant", vector("working with no order", C, ZERO, ZERO)),
    msg("msg_2", "assistant", vector("still no order", B, C, ZERO)),
  ]
  const out = mechanicalSummaryBody({ messages, diffs: [], planState: planState() })
  const goal = section(out, "## Goal", "## Plan")
  expect(goal.toLowerCase()).toContain("no goal found")
  expect(goal).toContain("dbread")
  expect(goal).toContain("sessionread")
  expect(goal).toContain("summaries")
  expect(goal).toContain("ask the delegator; do not invent a goal")
  expect(goal).not.toContain("no user order in this session")
  expect(goal).not.toContain(TUI)
})

test("review4: first order out of reach — later order labelled, never bound (Case B)", () => {
  // The session's first order folded away: the lineage holds only a later note naming TUI.
  const lineage: MessageV2.WithParts[] = [
    msg("msg_8", "assistant", vector("working", B, A, BRIEF_MD5)),
    msg("msg_9", "user", `Continue with ${TUI} per today's note.`),
  ]
  const out = mechanicalSummaryBody({
    messages: lineage,
    diffs: [],
    planState: planState(),
    sessionMessages: lineage,
    orderTruncated: true,
  })
  const goal = section(out, "## Goal", "## Plan")
  const next = section(out, "## Next Steps", "## Critical Context")
  expect(goal).toContain("latest order in window msg_9")
  expect(goal).toContain("dbread")
  expect(goal).toContain("sessionread")
  expect(goal.toLowerCase()).toContain("no goal found")
  expect(goal).toContain("do not invent a goal")
  // Labelled as later — never bound as the goal.
  expect(goal).not.toContain("tui has no standards -> tui meets standards")
  expect(goal).not.toContain("own plan")
  expect(next).toContain("latest order in window msg_9 is not the goal")
  expect(next).toContain("ask the delegator; do not invent a goal")
})
