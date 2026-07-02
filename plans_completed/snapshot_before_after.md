# Conflict Detection for Undo via .bak Files

## Problem

When user manually edits files after the assistant runs, `undo` silently overwrites those edits. No warning, no detection.

## Key Insight

We already have per-file "before" state: `.bak` files created by the edit tool at `{data}/backups/{sessionID}/`. Each `.bak` contains pre-edit content, `.meta.json` has the original path.

**Unique advantage**: `.bak` files work for ANY directory, including gitignored ones. Git snapshots can't see gitignored files (or skip files > 2MB). `.bak` is the only reliable "before" source for `node_modules/`, build outputs, `.opencode/data/`, gitignored configs, and any other excluded paths. Neither user nor agent can recover these from git — but `.bak` has them.

## Current Systems

| System | What it captures | When | Granularity |
|--------|-----------------|------|-------------|
| `.bak` files | Pre-edit file content | Every `edit`/`write`/`multiedit` tool call | Per-file, per-tool-call |
| `snap.track()` | Git tree hash of working dir | At revert time | Whole directory |
| `snap.restore()` | Overwrites working files from tree | During undo | Whole directory |

## Approach: Hybrid .bak + snapshot

### .bak for edit-tool files (precise)
- Compare current file content vs `.bak` content
- If different → user edited manually → warn
- Restore from `.bak` instead of git tree (more precise, no snapshot overhead)

### Git snapshot for non-edit files (bash, apply_patch, etc.)
- Some tools (bash, apply_patch) edit files without creating `.bak`
- For these, use existing `snap.track()` comparison
- Less precise but covers the gap

## Minimal Implementation

### 1. Add conflict check to `revert.ts`

Before restoring, check each affected file:

```ts
// For files with .bak backups:
const bakContent = await readBakFile(sessionID, filePath)
if (bakContent !== null) {
  const currentContent = await readFile(filePath)
  if (currentContent !== bakContent) {
    conflicts.push({ file: filePath, source: "bak" })
  }
}

// For files without .bak (edited by bash/apply_patch):
// Use existing snapshot comparison (already have snap.track())
```

### 2. Emit conflict info to TUI

Add to the revert response (not a separate event — simpler):

```ts
// In Session.Info.revert:
revert: {
  messageID, snapshot, diff,
  conflicts?: { file: string; source: "bak" | "snapshot" }[]
}
```

### 3. TUI warning banner

In `session/index.tsx`, when `session()?.revert?.conflicts?.length > 0`:

> "N file(s) modified since assistant's changes. Undo will overwrite manual edits."

Non-blocking. User can still proceed with undo.

### 4. Restore from .bak when available

For conflicted files with `.bak` backups, restore from `.bak` instead of git tree. More precise — restores the exact pre-edit state, not a directory-wide snapshot.

## Files to Modify

| File | Change |
|------|--------|
| `packages/opencode/src/session/revert.ts` | Add conflict detection before restore |
| `packages/opencode/src/session/session.sql.ts` | Add `conflicts` to revert type |
| `packages/opencode/src/tool/edit-backup.ts` | Expose `readBakFile()` helper |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | Show conflict banner |

## What This Does NOT Do

- No DAG redo — adm handles file-level versioning
- No transaction system
- No new snapshot frequency — use existing systems
- No conflict resolution UI — just a warning

## Verification

1. `bun typecheck` from `packages/opencode`
2. Undo with no manual edits: no warning, works as before
3. Edit a file manually after assistant, then undo: shows warning
4. Old revert records (no conflicts field) still work
5. .bak restore is more precise than git tree restore for single files
