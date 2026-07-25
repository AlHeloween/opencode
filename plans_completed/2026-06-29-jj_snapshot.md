---
status: superseded
owner: codex
created: 2026-06-29
superseded: 2026-07-02
---

# jj Snapshot - Superseded

## Outcome

The jj snapshot experiment was abandoned after it created repository pollution and did not provide a reliable internal snapshot backend for this worktree.

## Cleanup Record

- [x] Removed the tracked `tools/jj.exe` binary.
- [x] Removed the tracked `experiments/20260629_jj_smoke.ts` smoke experiment.
- [x] Removed `.jj/` from the worktree.
- [x] Removed `refs/jj/*` loose refs from `.git/refs/jj`.
- [x] Removed packed `refs/jj/*` entries from `.git/packed-refs`.
- [x] Restored snapshots to an isolated git backend under opencode runtime data.

## Replacement Direction

The snapshot layer now uses a separate bare gitdir configured with `core.worktree` instead of colocated jj state. This keeps internal snapshots out of the user's real `.git` refs and avoids writing `.jj/` into the project.

## Verification

- `git for-each-ref refs/jj` must return no refs.
- `.git/refs/jj` and `.jj` must be absent.
- `packages/opencode` snapshot tests must pass.
- `packages/opencode` typecheck must pass.
