import { describe, expect, test } from "bun:test"
import { shouldSnapshot } from "@/session/processor"

/**
 * The snapshot/revert/summary contract, pinned.
 *
 * All four boundaries are the SAME boundary — the end of one user turn:
 *
 *   fossil snapshot  ──┐
 *   summary + filediffs ├── end of turn
 *   revert target     ──┤   (revert.ts folds its target to the last user message)
 *   redo target       ──┘
 *
 * Taking a snapshot anywhere else produces a leaf nothing can ever revert to,
 * costs ~1861ms (measured, 62 calls / 115s in one session), and made the undo
 * walk classify its manifest against unreachable states — T7 and T8 in
 * undo-visibility were red from 2026-08-30 until this stopped.
 *
 * These are pure-predicate tests on purpose: the full-stack path needs a Fossil
 * binary and is red in environments without one, so it cannot hold a contract.
 */
describe("shouldSnapshot — one snapshot per user turn, at its end", () => {
  const base = { finishReason: "stop", write: true, exact: true, changedFiles: 1 }

  test("mid-turn steps never snapshot, however much they wrote", () => {
    expect(shouldSnapshot({ ...base, finishReason: "tool-calls" })).toBe(false)
    expect(shouldSnapshot({ ...base, finishReason: "tool-calls", changedFiles: 40 })).toBe(false)
  })

  test("a turn that ends with file mutations snapshots exactly once", () => {
    expect(shouldSnapshot(base)).toBe(true)
    expect(shouldSnapshot({ ...base, finishReason: "length" })).toBe(true)
    expect(shouldSnapshot({ ...base, finishReason: undefined })).toBe(true)
  })

  test("read-only turns spawn no fossil process at all", () => {
    // 51% of snapshot-bearing messages in the measured session were this case:
    // 365 pure `read`, 299 `cua`, 138 `jobwait`, 69 `grep`, 13 `webfetch`.
    expect(shouldSnapshot({ ...base, write: false, exact: false, changedFiles: 0 })).toBe(false)
  })

  test("a shell tool that changed nothing is not a mutation", () => {
    // `bun --version` through bash: write-class tool, zero filediff evidence,
    // no exact write tool. Creating a leaf for it is the 2026-09-09 defect.
    expect(shouldSnapshot({ finishReason: "stop", write: true, exact: false, changedFiles: 0 })).toBe(false)
  })

  test("a shell tool WITH filediff evidence does snapshot", () => {
    expect(shouldSnapshot({ finishReason: "stop", write: true, exact: false, changedFiles: 1 })).toBe(true)
  })

  test("an exact write tool snapshots even without filediff evidence", () => {
    // edit/write/multiedit/applypatch are self-evident: the diff may be absent
    // (new file, binary) but the mutation is not in doubt.
    expect(shouldSnapshot({ finishReason: "stop", write: true, exact: true, changedFiles: 0 })).toBe(true)
  })

  test("the mid-turn rule outranks every write signal", () => {
    // Ordering matters: a turn can be both mid-flight and full of exact writes.
    // Those writes are carried forward and land in the end-of-turn snapshot.
    for (const exact of [true, false])
      for (const changedFiles of [0, 1, 99])
        expect(shouldSnapshot({ finishReason: "tool-calls", write: true, exact, changedFiles })).toBe(false)
  })
})
