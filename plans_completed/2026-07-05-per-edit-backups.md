# Per-Edit File Backups

## Problem

opencode's `edit.ts` has zero backup mechanism. If an LLM makes a destructive edit, the only recovery is git — which is poor for individual file revisions and can lose hours of work.

## Architecture

### Storage

`Global.Path.data/backups/<sessionID>/` → `~/.local/share/opencode/backups/<sessionID>/`

Avoids `.opencode/` directory (not git-ignored — would commit). Follows opencode XDG path conventions.

### Hook point

In `edit.ts`, between `contentOld` read (line 121) and `replace()` call (line 128):
- Write `contentOld` → `.bak` file
- Replace happens after backup is saved

### File naming

```
<YYYYMMDD-HHmmss>_<callID>_<filename>.bak
```

Timestamp-sorted, `callID` links to triggering message.

### Behavior matrix

| Scenario | Backups |
|---|---|
| Single `edit` call | 1 |
| `multiedit` N edits | N (per-step undo chain) |
| Empty `oldString` (existing file) | 1 |
| Empty `oldString` (new file) | 0 |
| Edit fails (no match) | 0 |

### Cleanup

Configurable limit per session (default 50). Oldest deleted first.

### Restore

Manual: browse backups directory, copy `.bak` over original.

## Implementation

### edit.ts

Add `writeBackup(content, sessionID, callID, filePath, afs)` function:
1. Resolve backup dir: `path.join(Global.Path.data, "backups", sessionID)`
2. Ensure directory exists
3. Sanitize filename from filePath (replace path separators)
4. Write `content` to `<timestamp>_<callID>_<filename>.bak`
5. Cleanup old backups if count exceeds limit

Call before `replace()` at line 128.

### edit.txt

Add to tool description: "Each edit creates a backup in `~/.local/share/opencode/backups/<sessionID>/` that can be used to restore the file to its pre-edit state."

### Tests

- Single edit creates backup with correct content
- multiedit creates 2 backups for 2 edits
- Backup filename contains sessionID
- Empty oldString on existing file creates backup
- Empty oldString on new file: no backup
- Failed edit: no backup
