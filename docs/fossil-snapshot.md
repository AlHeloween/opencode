# Fossil Snapshot System (agent undo / Modified Files)

**Canonical product doc** for agent working-copy snapshots.  
Code: `packages/opencode/src/snapshot/fossil.ts`, `packages/opencode/src/session/revert.ts`.  
Audit / bug history: `plans_completed/fossil-undo-redo-fix.md`.

---

## 1. Role (do not conflate)

| System | Role |
|--------|------|
| **Git** | Project version control (`project/vcs.ts`) — branches, commits, agent git status |
| **Fossil** | **Agent only**: automatic WC snapshots, session undo/redo, “Modified Files” diffs |
| **jj** | TUI footer detection only (`.jj`) — not used for snapshots |

Fossil lives in a **sidecar** file under worktree data — never colocated with project `.git`.

```
{worktree}/.opencode/data/fossil/{projectID}/snapshot.fsl
{worktree}/.opencode/data/fossil/{projectID}/HISTORY_INVALID.json   # only after corrupt reinit
```

Binary resolution: [tools-and-sidecars.md](tools-and-sidecars.md) §4.1.  
Bootstrap: [startup-bootstrap.md](startup-bootstrap.md).

---

## 2. Mental model: leaves, not per-file soup

Each successful agent write era ends as a **Fossil checkin (leaf)**: a complete tree state.

```
T0: {h1, h2}
T1: {h1, h2′, h3}     // modified h2, added h3
T2: {h1, h2′, h3, h4} // added h4
```

**Undo / redo** move the working tree to another **whole leaf**:

```
T2 → undo → T1 → undo → T0
T0 → redo → T1 → redo → T2
```

- History in `.fsl` is not “erased”: deleted/renamed paths remain on older leaves.  
- After `checkout --force TARGET`, Fossil leaves former tracked paths as **extras** on disk.  
- Cleanup removes only **`extras ∩ preCheckoutLs`** (paths that were tracked at the previous leaf).  
- Never-tracked **user** files are not in `ls` → they stay.  
- **No** `fossil clean --force` (would delete arbitrary untracked user files).

Per-file `fossil revert -r HASH` mixes hashes across files (broken after moves/renames).  
Session undo uses **`revertTo(targetHash)`** = full leaf only.

---

## 3. Session undo / redo

**Code:** `session/revert.ts` + `Snapshot.revertTo` / `checkout` / `restore`.

| Action | Behavior |
|--------|----------|
| **Undo** to message `M` | Collect `patch` parts after `M`. Target leaf = `patches[0].hash` (tree **before** earliest undone agent step). Fresh `checkpoint()` → `op_id` / `snapshot` (redo anchor). |
| **Multi-level undo** | Previous `op_id` frames push onto `session.revert.redo_stack`. |
| **Redo (unrevert)** | `checkout(op_id)`; if `redo_stack` non-empty, pop next frame; else clear revert. |
| **Isolation** | Does not read or write edit `.bak` files. The `restore` tool owns point recovery from pre-edit backups. |

Patch parts (written by processor after track) store:

```ts
{ type: "patch", hash: /* leaf BEFORE this step */, files: string[] }
```

Agent tools should **`track()` after writes** so the tip leaf includes new files; otherwise extras cleanup cannot treat them as agent-owned.

---

## 4. API surface (`Snapshot.Service`)

| Method | Purpose |
|--------|---------|
| `track(files?)` | Commit current WC (optional explicit paths) → new leaf hash |
| `checkpoint()` / `opId()` | Current leaf hash (fast; no full addremove) |
| `patch(hash)` | Brief diff from `hash` to working tree / tip |
| `diff` / `diffFull` | Diffs for UI / summary |
| `restore` / `checkout` | Materialize leaf + structure-preserving extras cleanup |
| `revertTo(hash, { preserveFiles? })` | Session undo: full leaf; optional user-edit restore |
| `revert(patches)` | Thin wrapper → `revertTo(patches[0].hash)` |
| `impact` / `lastImpact` | CodeGraph structural tags (MCP + SQLite pack) |

Fail-loud:

- Missing checkin hash → error (no fallback to earliest empty init).  
- `HISTORY_INVALID.json` present → undo/checkout refuse with backup path in message.

---

## 5. Self-healing and HISTORY_INVALID

On corrupt / unopenable repo:

1. Backup `snapshot.fsl` → `snapshot.fsl.bak.<timestamp>`  
2. Write `HISTORY_INVALID.json` `{ at, backupPath, reason }`  
3. Reinit empty timeline  

Old session patch hashes are then **invalid**. Undo fails with a clear error pointing at the backup. There is no automatic silent wipe to `opencode-init` empty tree.

---

## 6. Integration points

| Area | Behavior |
|------|----------|
| **Processor** | Checkpoint at create; `track` after write tools; emit `patch` with pre-step hash; weak hash → soft warn |
| **Summary / Modified Files** | Tool `filediff` + CodeGraph for Exact memory — Fossil is **rollback**, not summary Exact ([summary-exact-handles.md](summary-exact-handles.md)) |
| **Compaction** | Fossil diffs may attach to summary handles when available; soft-fail if missing |
| **TUI** | Footer: fossil green when sidecar/open markers present; undo/redo UI via session revert |

---

## 7. Tests (real Fossil binary)

| Suite | Coverage |
|-------|----------|
| `test/session/session-undo-fossil.test.ts` | Structure walk h1/h2→h2′/h3→h4 both directions; multi-level redo; HISTORY_INVALID; invalid hash |
| `test/snapshot/snapshot.test.ts` (`-t revert`) | Full-leaf revert after `track()` |
| `test/snapshot/fossil-*.test.ts` | CLI, lifecycle, extras cleanup, ignore-glob |

Run from `packages/opencode` (not repo root).

---

## 8. Troubleshooting

| Symptom | Check |
|---------|--------|
| Undo empties wrong tree / keeps deleted files | Logs `snapshot-fossil`; extras cleanup; ensure agent **tracked** new files |
| Undo fails “hash not found” | `fossil info <hash>`; repo recreated? `HISTORY_INVALID.json` + `*.bak.*` |
| Undo fails after corruption recovery | **Manual recovery (no auto UX yet):** (1) stop opencode for that worktree; (2) copy `snapshot.fsl.bak.<ts>` over `snapshot.fsl` under `.opencode/data/fossil/{projectID}/`; (3) delete `HISTORY_INVALID.json`; (4) restart. Do not invent hashes. |
| “Modified Files” empty | Patch parts present? `resolveHash` errors in log (should fail, not silent empty baseline) |
| User untracked file deleted on undo | Should not happen for never-tracked paths; file report + preLs logic |
| Snapshot disabled | Config `snapshot: false` |

---

## 9. Related docs

- [startup-bootstrap.md](startup-bootstrap.md) — Snapshot vs Git vs TUI  
- [tools-and-sidecars.md](tools-and-sidecars.md) — `fossil.exe` layout  
- [summary-exact-handles.md](summary-exact-handles.md) — Fossil ≠ summary Exact  
- [background-jobs.md](background-jobs.md) — jobs (orthogonal)  
- `plans_completed/fossil-undo-redo-fix.md` — bug catalog + smoke stamps  
- `plans_completed/2026-08-05_master_critical_remediation.md` — SP-01…05 delivery record  
