/**
 * The REVERTED RUN — the messages an undo actually took back.
 *
 * A caller used to ask "is this message at or after the revert cursor?" and hide
 * everything that answered yes. That predicate is wrong the moment new work
 * arrives, and the symptom is the worst kind: the agent runs, every message is
 * written, published and stored, the "working" indicator animates — and the
 * transcript is EMPTY. Measured live 2026-09-27 (owner, after one `/undo`): the
 * session log showed `loop` steps 0→9 with zero errors, all rows were in the
 * database, and restarting or re-entering the session brought every one of them
 * back, because re-entry drops the in-memory `revert` and the filter stops
 * applying. `m.id >= revertID` is not "is reverted", it is "was created at or
 * after the undo", and after a new turn that is a strict superset.
 *
 * WHY NO NEW STATE IS NEEDED. `session.revert` carries `messageID / partID /
 * op_id / redo_stack / diff / conflicts` (`session.ts:301-313`) and no boundary
 * of its own, so a boundary has to be derived from the transcript. It is
 * derived from the shape of a transcript: a turn is one user message and the
 * assistant messages answering it, so the undo took back a CONTIGUOUS run
 * starting at `revertID`, and that run ends where the next turn begins.
 *
 * TWO RULES, and the second is the one that makes absence safe:
 *
 *   1. The run starts at `revertID` and stops at the first LATER user message
 *      that is not synthetic — that is the request the owner sent after the
 *      undo, and everything from it on is new work that must be visible.
 *      A synthetic row is not a turn: the Layer-1 panel is a synthetic user
 *      message (`prompt.ts`, the restored producer) and the `message*`
 *      compaction carrier is one too. This file does not guess which is which —
 *      the CALLER passes the predicate, and the sibling computation at
 *      `routes/session/index.tsx:1428-1433` already carries it.
 *
 *   2. If `revertID` is not in the list, NOTHING is hidden. The old predicate
 *      had no such branch: a cursor that names nothing hid everything after it,
 *      which is the same silent-empty-transcript failure wearing a different
 *      cause. An anchor that cannot be found is an absence, and this project
 *      reads an absence as FALSE (`AGENTS.md`, measured 2026-09-24) — never as
 *      "hide the rest of the session".
 */
export function revertedRun<T extends { id: string; role?: string }>(
  messages: readonly T[],
  revertID: string | undefined,
  isSynthetic?: (m: T) => boolean,
): Set<string> {
  const hidden = new Set<string>()
  if (!revertID) return hidden
  const start = messages.findIndex((m) => m.id === revertID)
  if (start < 0) return hidden
  for (let i = start; i < messages.length; i++) {
    const m = messages[i]!
    if (i > start && m.role === "user" && !isSynthetic?.(m)) break
    hidden.add(m.id)
  }
  return hidden
}
