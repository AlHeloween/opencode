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
})
