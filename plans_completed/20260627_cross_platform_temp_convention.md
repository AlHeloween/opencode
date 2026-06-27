---
status: completed
owner: Local_Development
created: 2026-06-27
completed: 2026-06-27
reproduce:
  - cd packages/opencode
  - bun typecheck
  - Check .gitignore for .temp/ entry
---

# Cross-Platform Temp File Convention

## Goal

Establish `.temp/` as the standard trash bin across Windows/Linux/macOS, preventing `/tmp/` usage that fails on Windows.

## Problem

Bash commands using `/tmp/` fail on Windows — the directory doesn't exist. This caused bugs when agents generated Unix-style temp paths.

## Solution

### 1. `.temp/` as Primary Trash Bin

- **Location:** `{worktree}/.temp/`
- **Gitignored:** Yes — auto-added to .gitignore
- **Cross-platform:** Works on Windows, Linux, macOS
- **Convention:** Primary temp location for all file operations

### 2. Secondary Temp Locations

- `.tmp1/` through `.tmp10/` — allowed for special cases
- Not the main trash bin — use only when `.temp/` is insufficient

## Changes

### agi-mode.tsx (Fresh Project Template)
**File:** `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`

Added `.temp/` to the fresh project gitignore template:
```ts
[
  "node_modules/",
  ".opencode/data/",
  ".temp/",        // NEW — cross-platform temp
  "dist/",
  "build/",
  "*.log",
  ".env",
  ".env.local",
]
```

### gitignore.ts (Guardrails)
**File:** `packages/opencode/src/project/gitignore.ts`

- Added `tempIgnore = ".temp"` constant
- Extended `acceptedRuntimeDataIgnores` to include `.temp/` variants
- Updated `isRuntimeDataPath()` to recognize `.temp/` paths
- Updated `ensureRuntimeDataIgnored()` to add both `.opencode/data` and `.temp` if missing

### reasoning.txt (Documentation)
**File:** `packages/opencode/src/session/prompt/reasoning.txt`

Added "Temp File Convention (Cross-Platform)" section:
- `.temp/` = primary trash bin (all platforms)
- NEVER use `/tmp/` (doesn't exist on Windows)
- `.tmp1-10/` = secondary, special cases only
- Guardrails auto-add `.temp/` to .gitignore

## Shell Command Compatibility

Added to reasoning.txt:
- Shell is pwsh on Windows, bash on Linux/macOS
- Unix commands (`ls -la`, `cat`, `head`, `tail`, `grep`, `find`, `diff`) fail on Windows
- Prefer cross-platform tools: `rg`, `fd`, `git`, `bun`, `node`
- PowerShell equivalents documented for Unix utils

## Verification

1. Fresh project init creates .gitignore with `.temp/`
2. Existing projects get `.temp/` added via `ensureRuntimeDataIgnored`
3. No `/tmp/` usage in codebase
4. `isRuntimeDataPath()` returns true for `.temp/` paths
5. Shell commands use cross-platform tools or platform checks

## Related

- Platform detection: `worktree/index.ts:308` (win32 path case)
- Shell selection: `worktree/index.ts:428` (cmd vs bash)
- Protected paths: `file/protected.ts:42-55` (per-OS home dirs)

## Commits

- `a3e10eda34` — fix: add .temp/ to gitignore guardrails + cross-platform temp convention
