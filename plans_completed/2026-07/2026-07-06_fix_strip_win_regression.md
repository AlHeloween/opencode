# Fix: stripCommand() type regression in bash tool cmd() function

## Bug

`mkdir D:\zPython\opencode\experiments\tui_rendering` fails on Windows through the bash tool.

## Root Cause

Commit `209fb051d` changed `stripCommand()` return type from `string` → `StripResult` object `{ command, converted, message }`, but did NOT update the caller in `bash.ts:303`.

Current broken code (`bash.ts:302-304`):
```ts
function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const stripped = stripCommand(command, shell)  // Returns StripResult object, not string!
  const normalized = process.platform === "win32" ? normalizeCommandPaths(stripped) : stripped
```

`normalizeCommandPaths()` expects `string` and calls `.replace()` — passing a `StripResult` object causes TypeError at runtime.

**Affects ALL Windows shells** (cmd, bash, pwsh) because `normalizeCommandPaths` runs unconditionally for `process.platform === "win32"`.

Confirmed by `bun typecheck`:
```
src/tool/bash.ts(304,75): error TS2345: Argument of type 'StripResult' is not assignable to parameter of type 'string'.
src/tool/bash.ts(306,30): error TS2769: No overload matches this call.
src/tool/bash.ts(314,28): error TS2769: No overload matches this call.
```

## Fix

**File:** `packages/opencode/src/tool/bash.ts` — lines 302-304

Change:
```ts
function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const stripped = stripCommand(command, shell)
  const normalized = process.platform === "win32" ? normalizeCommandPaths(stripped) : stripped
```

To:
```ts
function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv) {
  const result = stripCommand(command, shell)
  const stripped = result.command
  const normalized = process.platform === "win32" ? normalizeCommandPaths(stripped) : stripped
```

The `converted` and `message` fields from `StripResult` are unused in `cmd()` — they exist for metadata surfacing elsewhere.

## Verification

1. `bun typecheck` from `packages/opencode` — should produce 0 errors
2. `bun test packages/opencode/test/tool/strip-win.test.ts` — should pass
3. Manual: `mkdir D:\zPython\opencode\experiments\tui_rendering` via bash tool should succeed
