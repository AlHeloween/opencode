# Fix Compaction Usage Semantics and Preserve Latest Turn

Date: 2026-06-12
Status: Completed
Priority: High

## Goal

Stop treating `maxOutputTokens` as used or reserved context during compaction decisions. `maxOutputTokens` is the output limit only. Compaction should use actual token/content usage, and every compaction must preserve the latest real turn verbatim.

## Abstract Definition

Let:

```text
C = model.limit.context
I = model.limit.input when defined, otherwise C
R = configured compaction reserved value, otherwise fixed safety buffer
U = max(0, I - R)
T = actual accumulated token/content estimate
```

Overflow predicate:

```text
overflow(T) = T >= U
```

`model.limit.output` and `ProviderTransform.maxOutputTokens()` are not inputs to `overflow(T)`.

## Structural Diagram

```text
LLM request generation:
  model.limit.output -> maxOutputTokens -> provider request cap

Compaction decision:
  actual tokens/content -> usable(context/input - reserved) -> overflow?

Compaction selection:
  [older history..., latest turn]
       | summarized       | preserved verbatim
       v                  v
  [summary, latest turn]
```

## Inputs And Outputs

`usable(input)`

```text
input:  cfg, model
output: positive actual-usage threshold when context/input limit is positive
```

`isOverflow(input)`

```text
input:  cfg, actual assistant token usage, model
output: true when actual usage reaches usable threshold
```

`select(input)`

```text
input:  ordered messages, cfg, model
output: head messages for summary, tail messages preserved verbatim
rule:   newest real turn is always in tail
```

## Tasks

- [x] Remove `maxOutputTokens` from `session/overflow.ts` usage calculations.
- [x] Use explicit input limit or context limit minus a fixed safety buffer for `usable()`.
- [x] Force the newest real turn into compaction `tail` in `session/compaction.ts`.
- [x] Update regression tests for qwen-like `output == context` metadata.
- [x] Update tests that previously expected oversized latest turns to be summarized.
- [x] Run targeted compaction tests from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

## Test Cases

- qwen-like model with `context == output` and no `input` must not overflow on small usage.
- qwen-like model must overflow only on actual large usage near context.
- Equivalent models with and without explicit input limit should use symmetric headroom.
- Latest large text turn must be absent from summary input and present after filtering.
- Latest media turn must be absent from summary input and present after filtering.
- Latest multi-message turn must not be split into summary input.

## Verification

- [x] `bun test --timeout 30000 test/session/compaction.test.ts` from `packages/opencode` passed: 50 tests, 0 failures (`cmd_runner` run `20260612T073305Z_bdaa0dad`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260612T073424Z_a1f79784`).
