# Fix typecheck errors + unify system prefix on reasoning_prompt.mdc

## Status: DONE (typecheck clean 2026-08-07; identity unified)

Also fixed critical bunfig bug: `[loaders]` → `[loader]` so `reasoning_prompt.mdc`
imports as text content (was resolving to filesystem path only).

## Solution (landed — trust this, not the early ALGORITHM_CARD guess)

**One identity file.** System slot [1] loads only `reasoning_prompt.mdc`.
`algorithm_card.txt` assembly is **removed**; kernel slot is empty at runtime
(content merged into the mdc by `write_reasoning()`).

```
system[0]  UNIVERSAL_ENV
system[1]  reasoning_prompt.mdc   (+ optional empty kernel)
system[2]  tool schemas
system[3]  path (rules → skills → env → instructions)
system[4]  mutable tail
```

| Surface | Role |
|---------|------|
| `reasoning_prompt.mdc` | Steady-state GATED identity (built by `write_reasoning()`) |
| `plan.txt` / `build.txt` / `reasoning-mode.txt` | One-shot **conversation tail** on mode transition only |
| `algorithm_card.txt` | **Deleted** — do not re-wire |

Runtime:

```ts
// provider/transform.ts
export function systemPromptParts(_model: Provider.Model) {
  const prompt = PROMPT_REASONING  // reasoning_prompt.mdc
  return { reasoning: prompt, kernel: "" }
}
```

`assembleSystemMessages` no longer has `algorithmCard`. Order validators look for
`GATED_WORKFLOW` then `PROMPT_ABI`, not reasoning → ALGORITHM_CARD → kernel.

**Do not** re-add `algorithm: PROMPT_ALGORITHM` — that was an early typecheck-era
guess and was inverted by the unify commit.

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

## Root causes (and what actually landed)

### 1. `systemPromptParts` had no `algorithm` field — **slot removed, not re-filled**

Callers expected `{ reasoning, algorithm, kernel }` after ALGORITHM_CARD was
dropped from the return value.

**Landed fix (not re-wiring the card):**
- Drop `parts.algorithm` from all consumers (`llm.ts`, system-compose tests).
- Load only `reasoning_prompt.mdc` as `reasoning`; `kernel: ""`.
- Build scripts only `write_reasoning()` (no algorithm-card assembly).
- Fix bunfig `[loader]` so `.mdc` imports as text.

### 2. `noteMutationRisk` missing `"restore"` in tool union

**Definition** (`src/session/constitution.ts`):
```ts
export function noteMutationRisk(input: {
  tool: "edit" | "write" | "multiedit" | "apply_patch" | "applypatch" | "restore"
  // ...
}) { ... }
```

**Call sites** (`src/tool/restore.ts`):
```ts
Constitution.noteMutationRisk({ tool: "restore", path: target, sessionID })
```

**Fix:** Add `"restore"` to the union, `MUTATION_TOOLS`, and `isMutationTool`.

### 3. `restore.ts` init Effect error channel `Error` ≠ `never`

`Tool.define` requires `init: Effect<Init, never, R>`. Wrap init with
`.pipe(Effect.catchAll(() => Effect.void))` so the error channel is `never`.

## Files changed (landed)

| File | Change |
|------|--------|
| `packages/opencode/src/provider/transform.ts` | `systemPromptParts` → `{ reasoning: mdc, kernel: "" }` |
| `packages/opencode/src/session/system-compose.ts` | Drop `algorithmCard`; markers GATED / PROMPT_ABI |
| `packages/opencode/src/session/llm.ts` | Stop reading `parts.algorithm` |
| `packages/opencode/bunfig.toml` | `[loaders]` → `[loader]` for `.mdc` text import |
| `packages/opencode/src/session/constitution.ts` | `"restore"` in mutation tool union |
| `packages/opencode/src/tool/restore.ts` | Catch init error channel |
| `packages/opencode/src/session/prompt/build.txt` | Mode-switch tail only (no ALGORITHM_CARD spine) |
| `build.py` / `_build.sh` | Kernel step only `write_reasoning()` |

## Smoke Tests

```bash
cmd_runner start -- bun run typecheck
python -m pytest prompts_kernel/tests/ -q
```

Target: 0 TS errors, kernel suite green (incl. pocket markers without ALGORITHM_CARD).
