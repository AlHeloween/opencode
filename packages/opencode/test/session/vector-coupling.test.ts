/**
 * The coupling watcher (owner, 2026-09-22): «alerter … will follow messages in compact — their md5
 * actually… сцепление memory и всего остального контента».
 *
 * With generation removed, NOTHING produces the vector→plan linkage any more, so it has to be
 * checked rather than hoped for: a vector whose `parent-goal-md5` names a plan the memory map does
 * not declare is floating free, and a map entry naming a plan file that does not exist is a link
 * into nothing. These are the falsifiers the plan named, plus the one the wiring exposed — the
 * reader must accept the FORM THE WRITERS ACTUALLY WRITE, or it alarms on everything.
 */
import { describe, expect, test } from "bun:test"
import { EMPTY_HASH, couplingFindings, extractVectorChain, parsePlanMap } from "../../src/memory/spine"
import { TAIL_NOTE_PREFIX, tailNote } from "../../src/session/compaction"

const PLAN = "plans/2026-09-21_x.md"
/** The form the memory MAP uses for its labels: four groups of eight. */
const LABEL_SPACED = "a7f3c1e0 d95b4826 f1a0c3e7 8b2d6405"
/** The same label, canonical. */
const LABEL = "a7f3c1e0d95b4826f1a0c3e78b2d6405"
/** A perfectly valid label that no map entry declares — somebody else's plan. */
const OFF_PLAN = "11111111111111111111111111111111"

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
    })
    expect(result.checked).toBe(1)
    expect(result.findings).toEqual([])
  })

  test("a vector whose parent nobody declares is exactly one finding, naming the message", () => {
    const result = couplingFindings({
      messages: [carrier("msg_7", OFF_PLAN)],
      map: [{ plan: PLAN, label: LABEL }],
      plans: new Set([PLAN]),
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
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toContain("msg_1")
  })

  test("the all-zero parent opens a chain: nothing to couple, nothing counted", () => {
    const result = couplingFindings({
      messages: [carrier("msg_1", EMPTY_HASH)],
      map: [],
      plans: new Set(),
    })
    expect(result.checked).toBe(0)
    expect(result.findings).toEqual([])
  })

  test("a label naming a plan with no file on disk is a finding — the relevance filter is not the question", () => {
    // `planFiles` lists what EXISTS, deliberately unlike `collectPlanState`, which drops plans with
    // no open work. A map entry for a plan the filter hides is still a path that must resolve.
    const result = couplingFindings({ messages: [], map: [{ plan: PLAN, label: LABEL }], plans: new Set() })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toContain(PLAN)
  })

  test("the map is read as WRITTEN — 8×4 labels included, which is the form memory uses", () => {
    const memory = [
      "## Мастер-план: план ↔ SVM ↔ носитель",
      "",
      `**\`${PLAN}\`** — носитель: the fold's head`,
      "Keywords: fold-head 0.30, mStarRow 0.24",
      "Semantic dominant: …",
      `md5: ${LABEL_SPACED}`,
      `prev-md5: ${EMPTY_HASH}`,
      `parent-goal-md5: ${EMPTY_HASH}`,
      "",
      "**Храповик:** `plans/2026-09-20_y.md` · `plans/2026-09-19_z.md`",
    ].join("\n")
    // A ratchet entry with no `md5:` line is not a link, and the reader must not invent one for it.
    expect(parsePlanMap(memory)).toEqual([{ plan: PLAN, label: LABEL }])
    // The same form is readable where the OTHER writer puts it: in a message's vector.
    expect(extractVectorChain(carrier("msg_1", LABEL_SPACED).text).parentGoalMd5).toBe(LABEL)
  })

  test("the push prints the count even at zero — a silent check is not a check", () => {
    const quiet = tailNote({ open: [], window: null, coupling: { checked: 3, findings: [] } })
    expect(quiet.startsWith(TAIL_NOTE_PREFIX)).toBe(true)
    expect(quiet).toContain("coupling: 3 vector(s) with a plan link · 0 findings")
    const alarmed = tailNote({
      open: [],
      window: null,
      coupling: { checked: 3, findings: ["vector-off-plan msg_9 → …"] },
    })
    expect(alarmed).toContain("1 finding(s)")
    expect(alarmed).toContain("msg_9")
    // No watcher handed in ⇒ no line: a caller without a map keeps the note's old contract.
    expect(tailNote({ open: [], window: null })).toBe("")
  })
})
