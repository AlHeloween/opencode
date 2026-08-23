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

### 3.1 Leaf scope — what a leaf contains (read before debugging undo)

`track(paths)` stages **only the given paths** into the next leaf. A leaf therefore
contains exactly what agent steps explicitly tracked — never "whatever changed on
disk". Consequences:

- Writes to files that were never passed to `track()` are **invisible to undo**:
  after `revertTo(hash)` they remain on disk as never-tracked extras (by design —
  user files must survive).
- `patch.files[]` on a message part is UI/summary bookkeeping only. It does **not**
  scope the restore: `revertTo` always checks out the whole leaf.
- Debugging recipe for "undo left file X in future state": check whether X was ever
  tracked (`fossil ls`) and which leaf `patches[0].hash` points to
  (`fossil cat <path>` against that hash). In synthetic tests a missing `patch`
  part makes revert a silent no-op — replicate the canonical shape from
  `session-undo-fossil.test.ts`.

---

## 4. Performance envelope (measured 2026-08-23, Windows, tools/fossil.exe 2.28)

| Operation | Cost | Notes |
|-----------|------|-------|
| Per-process floor | **80–130 ms** | Even `fossil info`/`status` on a trivial tree; spawn + repo open dominates |
| First track (cold) | ~2.4 s | One-time: settings auto-configure + clean init (`fossil.ts` ensureInit path) |
| Warm `track(1 file)` | ~0.5 s | `info`×2 + `add --force` + `commit --hash`; flat vs unchanged-tree size |
| `track` over 1000 dirty files in a 10 000-file tree | ~0.46 s | Checkout mtime cache — cost is flat vs unchanged files |
| Revert (`revertTo`) | ~1.4–2.5 s | Full checkout + extras cleanup; scales with changed-set, not tree size |

Fossil handles large unchanged trees at the same speed as tiny ones; do not add
caching layers for "many files" — the cost model is per-invocation, not per-file.
Benchmarks: `experiments/2026-08-23_fossil_smoke.ps1`,
`experiments/2026-08-23_undo_scale.test.ts`, `experiments/2026-08-23_undo_scale10k.test.ts`.

---

## 5. Tests (real Fossil binary)

| Suite | Coverage |
|-------|----------|
| `test/session/session-undo-fossil.test.ts` | Structure walk h1/h2→h2′/h3→h4 both directions; multi-level redo; HISTORY_INVALID; invalid hash |
| `test/snapshot/snapshot.test.ts` (`-t revert`) | Full-leaf revert after `track()` |
| `test/snapshot/fossil-*.test.ts` | CLI, lifecycle, extras cleanup, ignore-glob |

Run from `packages/opencode` (not repo root). **Use `--timeout 30000`:** these are
real-subprocess integration tests; bun's default 5 s per-test limit produces false
failures (~5.8 s/test measured). Tests must bind `patch` parts to messages exactly
like the canonical suite — without them revert targeting is a no-op and synthetic
assertions misfire.

---

## 6. API surface (`Snapshot.Service`)

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

## 7. Self-healing and HISTORY_INVALID

On corrupt / unopenable repo:

1. Backup `snapshot.fsl` → `snapshot.fsl.bak.<timestamp>`  
2. Write `HISTORY_INVALID.json` `{ at, backupPath, reason }`  
3. Reinit empty timeline  

Old session patch hashes are then **invalid**. Undo fails with a clear error pointing at the backup. There is no automatic silent wipe to `opencode-init` empty tree.

---

## 8. Integration points

| Area | Behavior |
|------|----------|
| **Processor** | Checkpoint at create; `track` after write tools; emit `patch` with pre-step hash; weak hash → soft warn |
| **Summary / Modified Files** | Tool `filediff` + CodeGraph for Exact memory — Fossil is **rollback**, not summary Exact ([summary-exact-handles.md](summary-exact-handles.md)) |
| **Compaction** | Fossil diffs may attach to summary handles when available; soft-fail if missing |
| **TUI** | Footer: fossil green when sidecar/open markers present; undo/redo UI via session revert |

---

## 9. Troubleshooting

| Symptom | Check |
|---------|--------|
| Undo empties wrong tree / keeps deleted files | Logs `snapshot-fossil`; extras cleanup; ensure agent **tracked** new files |
| Undo fails “hash not found” | `fossil info <hash>`; repo recreated? `HISTORY_INVALID.json` + `*.bak.*` |
| Undo fails after corruption recovery | **Manual recovery (no auto UX yet):** (1) stop opencode for that worktree; (2) copy `snapshot.fsl.bak.<ts>` over `snapshot.fsl` under `.opencode/data/fossil/{projectID}/`; (3) delete `HISTORY_INVALID.json`; (4) restart. Do not invent hashes. |
| “Modified Files” empty | Patch parts present? `resolveHash` errors in log (should fail, not silent empty baseline) |
| User untracked file deleted on undo | Should not happen for never-tracked paths; file report + preLs logic |
| Snapshot disabled | Config `snapshot: false` |

---

## 10. Related docs

- [startup-bootstrap.md](startup-bootstrap.md) — Snapshot vs Git vs TUI  
- [tools-and-sidecars.md](tools-and-sidecars.md) — `fossil.exe` layout  
- [summary-exact-handles.md](summary-exact-handles.md) — Fossil ≠ summary Exact  
- [background-jobs.md](background-jobs.md) — jobs (orthogonal)  
- `plans_completed/fossil-undo-redo-fix.md` — bug catalog + smoke stamps  
- `plans_completed/2026-08-05_master_critical_remediation.md` — SP-01…05 delivery record  
