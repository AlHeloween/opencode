# Fix: Windows Path Backslash Normalization Breaking Native Commands

## Abstract

`normalizeCommandPaths()` in `bash.ts` unconditionally converts drive-letter backslashes to forward slashes (`C:\` → `C:/`) on Windows before passing the command to the shell. While `cmd.exe` and `pwsh` handle forward slashes for *most* commands, native Windows utilities (`attrib`, `icacls`, `takeown`, `robocopy`) require native backslash paths. The conversion breaks these commands.

## Root Cause

**File**: `packages/opencode/src/tool/bash.ts`, **lines 296-305**

```typescript
function normalizeCommandPaths(command: string): string {
  // Replace \ with / in Windows paths (D:\path → D:/path)
  // Works in cmd.exe, PowerShell, and bash — universal fix  ← FALSE CLAIM
  return command.replace(/([A-Za-z]:)[\\/]/g, (_, drive) => drive + "/")
}

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const result = stripCommand(command, shell)
  const stripped = result.command
  const normalized = process.platform === "win32" ? normalizeCommandPaths(stripped) : stripped  // ← BUG
  ...
}
```

Two problems:
1. **Unconditional**: Normalization runs for ALL Windows shells (cmd.exe, pwsh, Git Bash) — but cmd.exe and pwsh don't need it.
2. **Incomplete**: The regex only converts the first separator after a drive letter (`C:\foo\bar` → `C:/foo\bar`), not all separators. Even for POSIX shells, this is insufficient (they need all `\` → `/` or, better, `cygpath` conversion).

## Commands Broken

| Command | Example | Failure Mode |
|---------|---------|-------------|
| `attrib` | `attrib -r "C:\path\file"` | `File not found - C:/path\file` |
| `icacls` | `icacls "C:\path" /grant ...` | Path not found |
| `takeown` | `takeown /f "C:\path"` | Path not found |
| `robocopy` | `robocopy C:\src C:\dst` | Invalid path |
| `copy`/`move`/`del` | Native cmd built-ins | May fail with forward slashes |

## Fix

**One-line change** in `bash.ts:305` — gate normalization on POSIX shell check:

```typescript
// Before:
const normalized = process.platform === "win32" ? normalizeCommandPaths(stripped) : stripped

// After:
const normalized = process.platform === "win32" && Shell.posix(shell) 
  ? normalizeCommandPaths(stripped) 
  : stripped
```

`Shell.posix()` returns `true` only for `bash`, `dash`, `ksh`, `sh`, `zsh` — shells that expect POSIX path separators. For `cmd.exe`, `pwsh`, and `powershell`, the command passes through unmodified, preserving native backslash paths.

### Why This Is Safe

- **cmd.exe**: Already handles both `\` and `/` for most path arguments. Native commands that require `\` (like `attrib`) now work again.
- **PowerShell/pwsh**: Natively handles both `\` and `/` in all path contexts.
- **Git Bash / WSL bash**: Still receives normalized paths (forward slashes). The `resolvePath()` function (line 370-376) additionally converts POSIX paths via `cygpath()` for actual file operations.

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `packages/opencode/src/tool/bash.ts` | 305 | Add `Shell.posix(shell)` guard |

## Verification

### Manual Test

From within an opencode session with `cmd.exe` as the shell:

```cmd
attrib "C:\Windows\win.ini"
```

Before fix: path becomes `C:/Windows/win.ini` → may fail  
After fix: path stays `C:\Windows\win.ini` → works correctly

### Unit Test

Add a test case in `test/tool/bash.test.ts` under the `stripCommand` describe block:

```typescript
test("preserves Windows backslash paths for cmd.exe", () => {
  const cmd = shellPath("cmd")
  // This verifies the command passes through without \ → / conversion
  // when the shell is cmd.exe (non-posix)
})
```

### Regression Check

Existing tests in `bash.test.ts` test across `cmd`, `pwsh`, `powershell`, and `bash` (lines 112-119, `each()` helper). The fix should:
- Pass all existing tests unchanged (they don't exercise win32-native commands with paths)
- Not break Git Bash path resolution (permission tests still find external paths)

## SV

`sv=[["bash.ts","normalizeCommandPaths","Shell.posix","cmd.exe","attrib","backslash","Windows","native"],[0.2,0.18,0.15,0.12,0.1,0.1,0.08,0.07]]`
