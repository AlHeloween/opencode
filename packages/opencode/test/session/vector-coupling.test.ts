/**
 * The coupling watcher (owner, 2026-09-22): «alerter … will follow messages in compact — their md5
 * actually… сцепление memory и всего остального контента».
 *
 * With generation removed, NOTHING produces the vector→plan linkage any more, so it has to be
 * checked rather than hoped for: a vector whose `parent-goal-md5` names a plan no file declares is
 * floating free, and a declared label naming a plan that does not exist is a link into nothing.
 * These are the falsifiers the plan named, plus the one the wiring exposed — the reader must accept
 * the FORM THE WRITERS ACTUALLY WRITE, or it alarms on everything.
 *
 * The label source changed on 2026-10-01 (plan L2/L3): it was the map hand-kept in
 * `memory/reasoning.md`, MEASURED to hold ZERO `md5:` lines, so every non-zero parent came back
 * off-plan; it is now each plan's OWN header (`util/plan-status.ts` → `planLabels`).
 */
import { describe, expect, test } from "bun:test"
import { EMPTY_HASH, couplingFindings, extractVectorChain, planHeaderLabel } from "../../src/memory/spine"
import { TAIL_NOTE_PREFIX, tailNote } from "../../src/session/compaction"

const PLAN = "plans/2026-09-21_x.md"
/** The form the memory MAP uses for its labels: four groups of eight. */
const LABEL_SPACED = "a7f3c1e0 d95b4826 f1a0c3e7 8b2d6405"
/** The same label, canonical. */
const LABEL = "a7f3c1e0d95b4826f1a0c3e78b2d6405"
/** A perfectly valid label that no map entry declares — somebody else's plan. */
const OFF_PLAN = "11111111111111111111111111111111"
/**
 * The store's answer when nothing was handed in: zero manifests looked at, no orphans. The field is
 * REQUIRED rather than optional (plan S5) so a caller cannot silently skip the check — and an omitted
 * one would print `0 manifest(s)`, which reads as «the store holds nothing» rather than «nobody asked».
 */
const NOTHING_STORED = { checked: 0, orphans: [] } as const

/** A message carrying a vector, in the shape the rows actually use. */
const carrier = (id: string, parent: string = LABEL) => ({
  id,
  text: [
    "did the thing",
    'dominant: "the thing"',
    "Keywords: thing 0.6, work 0.4",
    "",
    "md5: 22222222222222222222222222222222",
    `prev-md5: ${EMPTY_HASH}`,
    `parent-goal-md5: ${parent}`,
  ].join("\n"),
})

describe("the coupling watcher", () => {
  test("a vector linked to a declared plan is silent — and still counted", () => {
    const result = couplingFindings({
      messages: [carrier("msg_1")],
      map: [{ plan: PLAN, label: LABEL }],
      plans: new Set([PLAN]),
      manifests: NOTHING_STORED,
    })
    expect(result.checked).toBe(1)
    expect(result.manifests).toBe(0)
    expect(result.findings).toEqual([])
  })

  test("a vector whose parent nobody declares is exactly one finding, naming the message", () => {
    const result = couplingFindings({
      messages: [carrier("msg_7", OFF_PLAN)],
      map: [{ plan: PLAN, label: LABEL }],
      plans: new Set([PLAN]),
      manifests: NOTHING_STORED,
    })
    expect(result.checked).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toContain("msg_7")
    expect(result.findings[0]).toContain(OFF_PLAN)
  })

  test("an empty map makes every linked vector a finding — silence there is how the linkage rots", () => {
    const result = couplingFindings({
      messages: [carrier("msg_1")],
      map: [],
      plans: new Set([PLAN]),
      manifests: NOTHING_STORED,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toContain("msg_1")
  })

  test("the all-zero parent opens a chain: nothing to couple, nothing counted", () => {
    const result = couplingFindings({
      messages: [carrier("msg_1", EMPTY_HASH)],
      map: [],
      plans: new Set(),
      manifests: NOTHING_STORED,
    })
    expect(result.checked).toBe(0)
    expect(result.findings).toEqual([])
  })

  test("a label naming a plan with no file on disk is a finding — the relevance filter is not the question", () => {
    // `planFiles` lists what EXISTS, deliberately unlike `collectPlanState`, which drops plans with
    // no open work. A map entry for a plan the filter hides is still a path that must resolve.
    const result = couplingFindings({
      messages: [],
      map: [{ plan: PLAN, label: LABEL }],
      plans: new Set(),
      manifests: NOTHING_STORED,
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toContain(PLAN)
  })

  test("a manifest whose plan is gone is a finding of its OWN kind, and the two counts stay two (S5)", () => {
    // THE THIRD CARRIER of one predicate (plan S5): a stored manifest whose `plan:` no longer resolves.
    // Its own kind, because a reader must know WHICH writer to go and fix — and its own count, because
    // `manifests` answers a different question from `checked`: one is what the window declared, the
    // other is what the store was asked about, and one number must not answer both.
    const result = couplingFindings({
      messages: [carrier("msg_1")],
      map: [{ plan: PLAN, label: LABEL }],
      plans: new Set([PLAN]),
      manifests: { checked: 2, orphans: [{ plan: "plans/gone.md", task: "S9", reason: "deleted" }] },
    })
    expect(result.checked).toBe(1)
    expect(result.manifests).toBe(2)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toContain("manifest-names-missing-plan")
    expect(result.findings[0]).toContain("plans/gone.md S9")
    // MOVED and DELETED are different findings with different remedies; the reason is carried through.
    expect(result.findings[0]).toContain("DELETED")
  })

  test("the push prints the count even at zero — a silent check is not a check", () => {
    const quiet = tailNote({ open: [], window: null, coupling: { checked: 3, findings: [], manifests: 4 } })
    expect(quiet.startsWith(TAIL_NOTE_PREFIX)).toBe(true)
    // TWO counts on one line — the vector links that were looked at, and the manifests the store was
    // asked about. Both printed at zero, because a silent check is not a check.
    expect(quiet).toContain("coupling: 3 vector link(s), 4 manifest(s) · 0 findings")
    const alarmed = tailNote({
      open: [],
      window: null,
      coupling: { checked: 3, findings: ["vector-off-plan msg_9 → …"], manifests: 0 },
    })
    expect(alarmed).toContain("1 finding(s)")
    expect(alarmed).toContain("msg_9")
    // No watcher handed in ⇒ no line: a caller without a map keeps the note's old contract.
    expect(tailNote({ open: [], window: null })).toBe("")
  })
})

describe("a plan's label comes from its OWN header (plan 2026-10-01)", () => {
  // The watcher's label source was the hand-kept map in `memory/reasoning.md`, and it is MEASURED
  // (2026-10-01) to hold ZERO `md5:` lines — so `labels` was empty and every non-zero
  // `parent-goal-md5` came back off-plan: 15 findings in one session, each a true statement about a
  // DEAD INPUT. A plan already declares its label in its own header; this reader takes it from there,
  // so a label is written once, in the file that IS the plan.
  //
  // The fixture repeats the PRODUCTION header shape (`plans/2026-10-01_tool-description-contracts.md`),
  // fenced YAML included — a fixture that invents its own shape cannot observe a reader that accepts
  // only the real one.
  const header = (md5: string) =>
    [
      "# Tool description contracts — every published promise is true and pinned",
      "",
      "<!-- intention: … -->",
      "",
      "- **plan_id:** 2026-10-01_tool-description-contracts",
      "",
      "```yaml",
      "Keywords: tool-description-contracts 0.30, falsifiable-promise 0.24",
      "Semantic dominant: каждое обещание либо закреплено тестом, либо вычеркнуто.",
      `md5: ${md5}`,
      `prev-md5: ${EMPTY_HASH}`,
      `parent-goal-md5: ${EMPTY_HASH}`,
      "```",
      "",
    ].join("\n")

  test("the header's label is the plan's label", () => {
    expect(planHeaderLabel(header(LABEL))).toBe(LABEL)
  })

  test("every form the writers use is readable, and the answer is canonical", () => {
    // All three forms `HEX32_SOURCE` accepts. A reader that knew only the contiguous one is how an
    // alerter becomes one nobody reads.
    expect(planHeaderLabel(header("a7f3c1e0d95b4826 f1a0c3e78b2d6405"))).toBe(LABEL)
    expect(planHeaderLabel(header("a7f3c1e0 d95b4826 f1a0c3e7 8b2d6405"))).toBe(LABEL)
  })

  test("a plan declaring no label has none — the reader never invents one", () => {
    expect(planHeaderLabel("# A plan\n\n- **plan_id:** x\n\n```yaml\nKeywords: a 1.0\n```\n")).toBeUndefined()
  })

  test("`prev-md5:` and `parent-goal-md5:` are NOT the label, even as the only hex present", () => {
    const text = [
      "# x",
      "",
      "```yaml",
      `prev-md5: ${LABEL}`,
      `parent-goal-md5: ${EMPTY_HASH}`,
      "```",
    ].join("\n")
    expect(planHeaderLabel(text)).toBeUndefined()
  })

  test("the FIRST `md5:` wins: the header owns the label, a later copy does not", () => {
    // A plan quotes its own vector further down (an example, a checklist). The header is first by
    // construction, so first-wins is what makes the header the owner and the copy a copy.
    const text = header(LABEL) + "\n## Example\n\n```yaml\nmd5: 44444444444444444444444444444444\n```\n"
    expect(planHeaderLabel(text)).toBe(LABEL)
  })

  // MOVED here from the removed `parsePlanMap` case (2026-10-01, plan L3): two of its observations that
  // the surviving reader must also hold, so removing that reader costs no coverage. The third — «a block
  // with no `md5:` is not a link» — is already case 3 above.
  test("an UNFENCED header is still a header — a reader that alarms on a shape it was never shown is not a reader", () => {
    expect(planHeaderLabel(`# x\n\nmd5: ${LABEL_SPACED}\n`)).toBe(LABEL)
  })

  test("the same spaced label is readable where the OTHER writer puts it: a vector's parent-goal-md5", () => {
    // `extractVectorChain` reads vectors, not headers — the other end of the same label form, and the
    // reason the spaced form must never be read as a foreign value.
    expect(extractVectorChain(carrier("msg_1", LABEL_SPACED).text).parentGoalMd5).toBe(LABEL)
  })
})
