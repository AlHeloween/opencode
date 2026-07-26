# Plan 2: Command Validation

## Problem

Fossil commands were coded based on git/jj assumptions, not actual fossil behavior:
- `--name-only` doesn't exist (should be `--brief`)
- `--rev` doesn't exist (should be `-r` or `--revision`)
- `--stat` doesn't exist (should be `--numstat`)
- Output parsed as `uuid:` instead of `hash:`
- `fossil open` fails on non-empty directory (needs `--keep`)

## Root Cause

No integration testing. Commands were assumed based on git similarity.

## Solution: Validated Command Reference

Every fossil command used in `fossil.ts` must be tested on the actual binary and output format documented:

| Command | Validated | Output Format |
|---|---|---|
| `fossil init <path>` | YES | `project-id: <hash>` |
| `fossil open <path> --keep` | YES | `checkout: <hash> ...` |
| `fossil add <file>` | YES | `ADDED <file>` |
| `fossil commit -m "..." --no-warnings` | YES | `New_Version: <hash>` (success) / empty (nothing to commit) |
| `fossil info current` | YES | `hash: <40-char-hex> <date> UTC` |
| `fossil diff --brief` | YES | `CHANGED <file>` / `ADDED <file>` / `DELETED <file>` |
| `fossil diff --numstat` | YES | `  <inserted>  <deleted>  <file>` + TOTAL line |
| `fossil diff --from <v> --brief` | YES | Same as diff --brief |
| `fossil diff --from <v> --to <v> --numstat` | YES | Same as diff --numstat |
| `fossil revert <file> -r <version>` | YES | `REVERT <file>` |
| `fossil update <version>` | YES | `updated-to: <hash> ...` |
| `fossil undo` | NOT TESTED | Need to verify |
| `fossil timeline` | YES | `date [hash] comment (user: X tags: Y)` |

## Implementation

Create `packages/opencode/test/snapshot/fossil.test.ts` that:
1. Creates a temp fossil repo
2. Exercises every command
3. Validates output parsing
4. Tests error cases (nothing to commit, file not found, etc.)

## Acceptance Criteria

- [ ] Every command in fossil.ts has a matching test
- [ ] Output regex patterns verified against actual fossil output
- [ ] Error handling tested (fossil not found, repo corrupted, etc.)
