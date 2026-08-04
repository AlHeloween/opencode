# Fix: Build (pytest) + Typecheck Failures

**Date:** 2026-08-04
**Status:** plan
**Branch:** `Local_Development`
**HEAD:** `3215ac0a35`

## Problem Summary

Two independent failures block CI/CD:

| # | Type | Failing artifact | Root cause |
|---|------|------------------|------------|
| 1 | pytest (1/481) | `prompts_kernel/tests/test_prompt_schema.py::test_build_has_no_agent_prompt_system_bind` | `agent.ts` binds `PROMPT_BUILD` (import + `prompt:` field) — violates invariant: build/plan/reasoning mode text = one-shot `session/prompt/*.txt` synthetic, never `agent.prompt` |
| 2 | `bun turbo typecheck` (4 errors) | `src/tool/shell-constitution.ts:38`, `test/session/constitution.test.ts:45,51,57` | `CommandGuardResult` type (constitution.ts:384-391) missing `kind` field; consumed by shell-constitution + tests |

Both are static, deterministic, no runtime needed for verification.

---

## Fix 1: Remove `PROMPT_BUILD` from build agent

### File: `packages/opencode/src/agent/agent.ts`

**Change A — Remove import (line 19):**
```diff
-import PROMPT_BUILD from "./prompt/build.txt"
```

**Change B — Remove `prompt:` from build block (line 130):**
```diff
 build: {
   name: "build",
   description: "The default agent. Executes tools based on configured permissions.",
   options: {},
-  prompt: PROMPT_BUILD,
   permission: Permission.merge(
```

### No other changes needed
- `agent/prompt/build.txt` stays (excluded from orphan-prompt test via `EXCLUDED_FILES` filter). Optional deletion — not required by any test.
- `session/prompt/build.txt` remains the sole build-mode text source (already routed via `modeInstructionForTransition` in `src/session/prompt.ts`).
- `roleInstructionForAgent` already skips build/plan/reasoning from `agent.prompt` (prompt.ts:102-104).

### Verification
```bash
cd D:\zPython\opencode && python -m pytest prompts_kernel/tests/test_prompt_schema.py::test_build_has_no_agent_prompt_system_bind -xvs
```

---

## Fix 2: Add `kind` to `CommandGuardResult`

### File: `packages/opencode/src/session/constitution.ts`

**Change A — Add `kind` to the type (after line 390):**
```diff
 export type CommandGuardResult = {
   risk: Risk
   family: CommandFamily
   permission?: PermissionBucket
   needsDestructivePermission: boolean
   blocked: boolean
   message?: string
+  kind?: "file" | "db" | "git" | "fossil"
 }
```

**Change B — Populate `kind` in permission-required destructive return (lines 472-482):**

The `classifyDestructiveKind` helper (deprecated, lines 912-919) already maps family→kind. Extract the mapping logic and apply it inline, or call the existing function. Since `classifyDestructiveKind` takes a command string, and inside `guardCommand` we already have `classification.family`, a cleaner approach is a small helper:

```diff
   // Permission-required destructive
   if (classification.risk === "DESTRUCTIVE" && !allow) {
     const perm = classification.permission ?? PermissionBucket.FILE
     return {
       risk: classification.risk,
       family: classification.family,
       permission: perm,
+      kind: destructiveFamilyKind(classification.family),
       needsDestructivePermission: true,
       blocked: false,
       message:
         `constitution: DESTRUCTIVE (${perm}) requires explicit approval ` +
         `(rm -rf → destructive-file; DROP TABLE → destructive-db; force-push → destructive-git). ` +
         "Or set OPENCODE_ALLOW_DESTRUCTIVE=1 / bypass_constitution.",
     }
   }
```

**Change C — Add the helper function (before `guardCommand` or after, module-private):**

```ts
/** Map CommandFamily → destructive kind string. */
function destructiveFamilyKind(family: CommandFamily): "file" | "db" | "git" | "fossil" | undefined {
  if (family === CommandFamily.FILE_DESTRUCTIVE) return "file"
  if (family === CommandFamily.DB_DESTRUCTIVE) return "db"
  if (family === CommandFamily.GIT_HISTORY_REWRITE || family === CommandFamily.GIT_ASKABLE_DESTRUCTIVE) return "git"
  if (family === CommandFamily.FOSSIL_MUTATE) return "fossil"
  return undefined
}
```

### Why optional (`kind?`)
- `kind` is only consumed when `needsDestructivePermission === true` (shell-constitution.ts:29 guards the `.kind` access; test assertions at 45/51/57 are all on askable destructive paths).
- Non-destructive returns (LOW, ELEVATED, ALLOWED) have no meaningful kind — forcing a value would be misleading.
- Tests don't access `.kind` on non-destructive guards → no missing coverage.

### Blast radius — bash.test.ts runtime assertions
`test/tool/bash.test.ts:1452` and `:1494` assert `metadata?.kind` on `ctx.ask` payloads (flow: `guard.kind` → `metadata.kind`). These are **not** TypeScript errors (metadata is typed loosely), but would fail at runtime if `kind` is `undefined`. With the fix populating `kind` on the permission-required path, these pass.

### Verification
```bash
cd D:\zPython\opencode\packages\opencode && bun typecheck
cd D:\zPython\opencode\packages\opencode && bun test test/session/constitution.test.ts
cd D:\zPython\opencode\packages\opencode && bun test test/tool/bash.test.ts
```

---

## Execution Order

1. Fix 2 first (typecheck blocks everything)
2. Fix 1 second (pytest is separate)

Both are independent — no cross-contamination.

---

## Smoke Tests

### PRE_FLIGHT (before changes)
```bash
# Capture baseline — these should FAIL now
cd D:\zPython\opencode\packages\opencode && bun typecheck 2>&1 | head -20
cd D:\zPython\opencode && python -m pytest prompts_kernel/tests/test_prompt_schema.py::test_build_has_no_agent_prompt_system_bind -xvs 2>&1 | tail -10
```

### POST_FLIGHT (after changes)
```bash
# Fix 2 verification
cd D:\zPython\opencode\packages\opencode && bun typecheck
# Expect: 0 errors, all packages pass

cd D:\zPython\opencode\packages\opencode && bun test test/session/constitution.test.ts
# Expect: all tests pass

cd D:\zPython\opencode\packages\opencode && bun test test/tool/bash.test.ts
# Expect: all tests pass (especially .kind assertions at :1452, :1494)

# Fix 1 verification
cd D:\zPython\opencode && python -m pytest prompts_kernel/tests/test_prompt_schema.py::test_build_has_no_agent_prompt_system_bind -xvs
# Expect: PASS

# Full regression
cd D:\zPython\opencode && python -m pytest prompts_kernel/tests/test_prompt_schema.py -x
# Expect: 481 passed
```

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `kind: undefined` reaches bash.test.ts metadata assertion | Low | Fix populates `kind` on the exact return path those tests exercise. Verified by bash.test.ts smoke. |
| Removing `PROMPT_BUILD` breaks build agent prompt routing | None | `session/prompt.ts` already routes build text via `modeInstructionForTransition`; `roleInstructionForAgent` skips build from agent.prompt. Architecture is dual-path; we're removing the dead path. |
| `agent/prompt/build.txt` becomes orphan | None | Excluded from `test_no_orphaned_agent_prompts` via `EXCLUDED_FILES`. File stays as reference — optional cleanup. |
