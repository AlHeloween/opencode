import { describe, expect, test } from "bun:test"
import { beginTurn, endTurn, resetTurns } from "@/session/processor"

/**
 * The snapshot/revert/summary contract, pinned.
 *
 * All four boundaries are the SAME boundary — one user turn:
 *
 *   fossil snapshot  ──┐
 *   summary + filediffs ├── the turn
 *   revert target     ──┤   (revert.ts folds its target to the last user message)
 *   redo target       ──┘
 *
 * The baseline is taken at the turn's START, before anything is touched: that
 * is the state revert goes back to, and taken there it needs no evidence about
 * what the turn is going to do. `track(undefined)` runs `addremove`, so it
 * picks up whatever appeared since the last turn regardless of who wrote it —
 * bash, edit, or the user's own editor between turns. Fossil has no autotrack;
 * a new file stays `extras` until `addremove` runs, so that call IS the
 * automatic tracking.
 *
 * What this replaced decided at the END of the turn, from per-tool evidence.
 * Shell tools emit no `filediff` metadata at all (only edit.ts and write.ts
 * do), so "zero reported files" covered both `bun --version` and a command that
 * had just created a file — and every shell mutation fell out of undo coverage
 * from c41c4b9bf2 until this. snapshot-tool-race.test.ts was red that whole
 * time, stating the intent the code had dropped.
 *
 * What is left to pin is that "once per turn" is literally once. A turn spans
 * several assistant messages and `create` runs for each, so the snapshot has to
 * fire on the first and no other. These are pure state-machine tests on
 * purpose: the full-stack path needs a Fossil binary and is red in environments
 * without one, so it cannot hold a contract.
 */
describe("one snapshot per user turn, at its start", () => {
  test("the first assistant message of a turn opens it, the rest do not", () => {
    resetTurns()
    expect(beginTurn("s1")).toBe(true)
    // A fifty-tool turn is still one snapshot: create() runs per assistant
    // message, and every one after the first must answer false.
    for (let i = 0; i < 50; i++) expect(beginTurn("s1")).toBe(false)
  })

  test("the next turn opens again once the previous one ended", () => {
    resetTurns()
    expect(beginTurn("s1")).toBe(true)
    expect(beginTurn("s1")).toBe(false)
    endTurn("s1")
    expect(beginTurn("s1")).toBe(true)
  })

  test("sessions do not close each other's turns", () => {
    resetTurns()
    expect(beginTurn("s1")).toBe(true)
    expect(beginTurn("s2")).toBe(true)
    endTurn("s1")
    // s2 is mid-turn and must not be reopened by s1 ending.
    expect(beginTurn("s2")).toBe(false)
    expect(beginTurn("s1")).toBe(true)
  })

  test("ending a turn that never opened is not an error and opens nothing", () => {
    resetTurns()
    endTurn("never-seen")
    expect(beginTurn("never-seen")).toBe(true)
  })
})
