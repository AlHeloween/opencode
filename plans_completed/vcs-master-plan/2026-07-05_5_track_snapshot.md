# Plan 5: Track & Snapshot

## Problem

The `track()` function chains multiple fossil operations but has never been tested end-to-end. Unknown issues:
1. `fossil add` on already-tracked files
2. `fossil commit` when nothing changed (returns non-zero?)
3. File path normalization (Windows `\` vs `/`)
4. New files created by agent not auto-tracked

## Current Flow

```
track(files?)
  ├─ ensureInit()
  ├─ if files: fossil add <files>  ← explicit tracking
  ├─ fossil info current           ← get before hash
  ├─ (implicit: fossil commit)     ← snapshot
  ├─ fossil commit -m "auto-snapshot" --no-warnings
  └─ return afterHash
```

## Issues to Verify

### 1. `fossil add` on existing files
`fossil add` on a file already tracked returns an error. Need to handle gracefully.

### 2. `fossil commit` with no changes
When nothing changed, `fossil commit` returns non-zero and prints something like "nothing to commit". Need to parse this correctly and return the current hash.

### 3. File path normalization
Fossil uses `/` internally. Windows paths with `\` need conversion everywhere.

### 4. New file tracking
With `auto-track=none()` equivalent (ignore-glob), new files aren't tracked. The `files` parameter from `track(files?)` handles this. But:
- Where does the file list come from?
- Currently processor.ts calls `track()` without files
- Need to pass changed files from the tool execution context

## Integration with processor.ts

Current processor.ts flow:
```
1. snapshot.track()         ← before LLM stream (no files)
2. ... LLM runs, tools execute ...
3. snapshot.track()         ← at finish-step (no files)
```

Need to change to:
```
1. snapshot.track()                           ← before LLM stream
2. ... LLM runs, tools execute ...
3. snapshot.track(ctx.changedFiles)           ← at finish-step WITH file list
```

`ctx.changedFiles` = files modified by edit/write/apply_patch/bash tools during this step.

## Acceptance Criteria

- [ ] `track()` with no changes returns current hash without error
- [ ] `track(["file.txt"])` adds and commits new file
- [ ] `track(["existing.txt"])` doesn't error on already-tracked file
- [ ] Windows paths normalized correctly
- [ ] Hash returned is valid for `restore()` and `revert()`
