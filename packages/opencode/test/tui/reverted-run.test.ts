import { describe, expect, test } from "bun:test"
import { revertedRun } from "../../src/cli/cmd/tui/util/reverted-run"

type M = { id: string; role: string; synthetic?: boolean }

/** Ascending ids in transcript order — the shape `messagesList` actually receives. */
const turn = (prefix: string, n: number): M[] => [
  { id: `${prefix}u`, role: "user" },
  { id: `${prefix}a1`, role: "assistant" },
  { id: `${prefix}a2`, role: "assistant" },
]

describe("the reverted run", () => {
  test("no revert hides nothing", () => {
    expect(revertedRun(turn("t1", 1), undefined).size).toBe(0)
  })

  test("an undo with no new work still hides its whole tail", () => {
    // This is the ORIGINAL behaviour and it is correct: nothing arrived since.
    const all = [...turn("t1", 1), ...turn("t2", 1)]
    const hidden = revertedRun(all, "t2u")
    expect([...hidden].sort()).toEqual(["t2a1", "t2a2", "t2u"])
    // The turn BEFORE the cursor is untouched — the bug is never "hide everything".
    expect(hidden.has("t1u")).toBe(false)
    expect(hidden.has("t1a1")).toBe(false)
  })

  test("THE LIVE DEFECT: work sent AFTER the undo is visible", () => {
    // owner, 2026-09-27: one `/undo`, then a request. The agent ran to completion
    // and the transcript was empty until the TUI was restarted.
    const all = [...turn("t1", 1), ...turn("t2", 1), ...turn("t3", 1)]
    const hidden = revertedRun(all, "t2u")
    expect([...hidden].sort()).toEqual(["t2a1", "t2a2", "t2u"])
    // Every message of the NEW turn must reach the render. Under `m.id >= revertID`
    // all five of these were hidden, which IS the reported symptom.
    for (const id of ["t3u", "t3a1", "t3a2"]) expect(hidden.has(id)).toBe(false)
  })

  test("a synthetic user row is not a turn and does not end the run", () => {
    // The restored Layer-1 panel is a synthetic user message, and the `message*`
    // compaction carrier is one too. Treating either as a new turn would reveal
    // the reverted tail the moment a panel appeared.
    const all: M[] = [
      { id: "t2u", role: "user" },
      { id: "panel", role: "user", synthetic: true },
      { id: "t2a1", role: "assistant" },
    ]
    const hidden = revertedRun(all, "t2u", (m) => m.synthetic === true)
    expect([...hidden].sort()).toEqual(["panel", "t2a1", "t2u"])
  })

  test("AN ANCHOR THAT NAMES NOTHING HIDES NOTHING", () => {
    // The safety rule, and the second half of the same failure: a cursor with no
    // row behind it must not hide the rest of the session.
    const all = turn("t1", 1)
    expect(revertedRun(all, "t9u").size).toBe(0)
  })

  test("a one-message run is the cursor itself", () => {
    expect([...revertedRun([{ id: "a", role: "user" }], "a")]).toEqual(["a"])
  })

  /**
   * THE REAL CAPTURE, not a fixture. Taken from the live database at 07:33 the
   * moment the bug reproduced (owner: «упало, сейчас в tui ничего не отображается
   * кроме working spinner»). `session.revert` was NULL in the SAME query, which is
   * what makes this a CLIENT-cursor case: the server had already run
   * `revert.cleanup` at the top of the turn (`prompt.ts:1478-1480`) and the TUI
   * was still holding a cursor naming a message the server had disowned.
   */
  const CAPTURED: M[] = [
    { id: "msg_0e1acf8af0018MR1GTYSCzsibK", role: "assistant" },
    { id: "msg_0e1ad4188001XoLuG1RJpYpAuH", role: "user" }, // the undo target — the stale cursor
    { id: "msg_0e1c719b1001Z96DyBSp3xBfXf", role: "user" }, // the request sent AFTER the undo
    { id: "msg_0e1c719eb001OZ3C3Ujn11GuY5", role: "assistant" },
    { id: "msg_0e1c7580b001lWgkLBM8iqGPIJ", role: "assistant" },
    { id: "msg_0e1c77a43001xuI5MPtQoI7NF0", role: "assistant" },
    { id: "msg_0e1c7bc72001FnAWquFRXIrPqt", role: "assistant" },
    { id: "msg_0e1c7cf9b001aBo6v4Fxl2v5Q3", role: "assistant" },
    { id: "msg_0e1c7fbb1001o48rK8SWBnqaA9", role: "assistant" },
    { id: "msg_0e1c825de001HZqJujMBDI8D0o", role: "assistant" },
    { id: "msg_0e1c8959200152J6tRcyfNy2k5", role: "user" },
    { id: "msg_0e1c895bb001E99hLSejtGFwl5", role: "assistant" },
  ]
  const CURSOR = "msg_0e1ad4188001XoLuG1RJpYpAuH"

  test("the captured failure: a stale cursor hides ONLY its own turn", () => {
    const hidden = revertedRun(CAPTURED, CURSOR, (m) => m.synthetic === true)
    // The undone request, and nothing else. This is the whole repair.
    expect([...hidden]).toEqual([CURSOR])
  })

  test("what the OLD predicate did to the same capture", () => {
    // `m.id < revertID` on these real ids. Named for what each list IS, after
    // getting it backwards once: the first draft called the KEPT list `oldHidden`
    // and every number below it was inverted, which the test caught at the first
    // assertion. A variable named for its opposite is a measurement that lies.
    const oldKeeps = CAPTURED.filter((m) => m.id < CURSOR).map((m) => m.id)
    const newHides = [...revertedRun(CAPTURED, CURSOR, (m) => m.synthetic === true)]

    // The old predicate KEEPS the one message before the cursor and hides the other
    // eleven: the owner's own request, the answers to it, and the turn he is
    // looking at right now. One visible message out of twelve is not a degraded
    // view and not a scroll position — it is an empty screen with a spinner.
    expect(oldKeeps).toEqual(["msg_0e1acf8af0018MR1GTYSCzsibK"])
    expect(CAPTURED.length - oldKeeps.length).toBe(11)

    // The repair hides the undone request and NOTHING else: 1 of 12, and the one
    // is the message the undo was about.
    expect(newHides).toEqual([CURSOR])
    expect(CAPTURED.length - newHides.length).toBe(11)
    // The owner's own request survives both counts as VISIBLE.
    expect(oldKeeps).not.toContain("msg_0e1c719b1001Z96DyBSp3xBfXf")
    expect(newHides).not.toContain("msg_0e1c719b1001Z96DyBSp3xBfXf")
  })

  test("and when the server has already disowned the cursor, nothing is hidden at all", () => {
    // The same live state, read the way a CORRECT client reads it: `revert` NULL.
    // The repair does not depend on the client being told — and this is the branch
    // that makes the stale-cursor case survivable rather than merely narrowed.
    expect(revertedRun(CAPTURED, undefined).size).toBe(0)
  })
})
