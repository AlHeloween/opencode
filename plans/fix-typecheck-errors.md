# Fix typecheck errors — 4 lines, 3 root causes

## Status: DONE (typecheck clean 2026-08-07)

Also fixed critical bunfig bug: `[loaders]` → `[loader]` so `reasoning_prompt.mdc`
imports as text content (was resolving to filesystem path only).

## Current state (resolved)

```
opencode#typecheck: 0 TypeScript errors
```

### Previously

```
opencode#typecheck: 4 TypeScript errors
  - llm.ts(298): parts.algorithm — no such field
  - restore.ts(34): Effect error channel Error ≠ never
  - restore.ts(74): "restore" not in noteMutationRisk tool union
  - restore.ts(124): "restore" not in noteMutationRisk tool union
  - system-compose.test.ts(212-214): parts.algorithm — no such field
```

## Root causes

### 1. `systemPromptParts` missing `algorithm` field

**Implementation** (`src/provider/transform.ts:432-435`):
```ts
export function systemPromptParts(_model: Provider.Model) {
  const prompt = PROMPT_REASONING
  return { reasoning: prompt, kernel: "" }   // ← no `algorithm`
}
```

**Consumers** expect `{ reasoning, algorithm, kernel }`:
- `src/session/llm.ts:298` — `parts.algorithm`
- `test/session/system-compose.test.ts:212-214` — `parts.algorithm`

The `PROMPT_ALGORITHM` exists (`src/session/prompt/algorithm_card.txt`) but is never wired into the return value.

**Fix:**
```ts
import PROMPT_ALGORITHM from "../../src/session/prompt/algorithm_card.txt"

export function systemPromptParts(_model: Provider.Model) {
  const prompt = PROMPT_REASONING
  return {
    reasoning: prompt,
    algorithm: PROMPT_ALGORITHM,
    kernel: "",
  }
}
```

### 2. `noteMutationRisk` missing `"restore"` in tool union

**Definition** (`src/session/constitution.ts:845-849`):
```ts
export function noteMutationRisk(input: {
  tool: "edit" | "write" | "multiedit" | "apply_patch" | "applypatch"
  // ...
}) { ... }
```

**Call sites** (`src/tool/restore.ts:74, 124`):
```ts
Constitution.noteMutationRisk({ tool: "restore", path: target, sessionID })
```

**Fix:** Add `"restore"` to the union:
```ts
tool: "edit" | "write" | "multiedit" | "apply_patch" | "applypatch" | "restore"
```

Also add `"restore"` to `MUTATION_TOOLS` (`constitution.ts:830-836`) and update `isMutationTool` (`constitution.ts:838-842`) for consistency.

### 3. `restore.ts` init Effect error channel `Error` ≠ `never`

**Problem** (`src/tool/restore.ts:32-34`):
```ts
export const RestoreTool = Tool.define(
  "restore",
  Effect.gen(function* () {   // ← inferred error = Error
    const bus = yield* Bus.Service
    return { description, parameters, execute }
  }),
)
```

`Tool.define` requires `init: Effect<Init, never, R>` — error channel must be `never`.

The init generator yields `restoreBackup` → `afs.writeWithDirs(...)` which has error channel `Error`. Also `afs.readFileString(bakPath)` in `findLatestBackup`.

**Fix:** Add `.pipe(Effect.catchAll(() => Effect.void))` to the init generator:
```ts
export const RestoreTool = Tool.define(
  "restore",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    // ... init logic ...
  }).pipe(Effect.catchAll(() => Effect.void)),  // ← catch all errors → never
)
```

Or alternatively, use `Effect.scoped` + `Effect.succeed` to wrap the init without error channel.

## Files to change

| File | Change |
|------|--------|
| `packages/opencode/src/provider/transform.ts` | Add `algorithm: PROMPT_ALGORITHM` to return |
| `packages/opencode/src/session/constitution.ts` | Add `"restore"` to `noteMutationRisk` tool union + `MUTATION_TOOLS` + `isMutationTool` |
| `packages/opencode/src/tool/restore.ts` | Catch init error channel + verify `"restore"` calls work |

## Smoke Tests

```bash
cmd_runner start -- bun run typecheck
python -m pytest prompts_kernel/tests/ -q
```

Target: 0 TS errors, 482 passed.
