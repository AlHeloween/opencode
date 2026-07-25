# Cap Pathological Provider Max Output Tokens

Date: 2026-06-12
Status: Completed
Priority: High

## Goal

Prevent provider requests from sending a native output cap equal to or larger than the full context window when model metadata reports `output >= context`.

## Abstract Definition

Let:

```text
C = model.limit.context
O = model.limit.output
E = explicit output token override
R = min(20000, floor(C * 0.15)) when C > 0
```

Request output cap:

```text
cap(E, O, C) = E                         when E is defined
cap(E, O, C) = min(O, OUTPUT_TOKEN_MAX, max(1, R)) when O >= C and C > 0
cap(E, O, C) = O                         when O > 0
cap(E, O, C) = OUTPUT_TOKEN_MAX          otherwise
```

## Structural Diagram

```text
model metadata -> ProviderTransform.maxOutputTokens -> LLM request max_tokens
explicit override --------------------------^ always wins
```

## Inputs And Outputs

`maxOutputTokens(model, outputTokenMax?)`

```text
input:  provider model limits and optional explicit override
output: safe provider request output cap
```

## Tasks

- [x] Cap pathological `output >= context` native limits in `provider/transform.ts`.
- [x] Add provider transform regression tests.
- [x] Run focused provider transform tests from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

## Test Cases

- Normal model with `output < context` returns native output.
- Qwen-like model with `output == context` returns the reserved cap.
- Model with `output > context` returns the reserved cap.
- Zero context preserves native output behavior.
- Explicit output override wins over metadata.

## Verification

- [x] `bun test --timeout 30000 test/provider/transform.test.ts` from `packages/opencode` passed: 148 tests, 0 failures (`cmd_runner` run `20260612T074312Z_c0e85514`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260612T074327Z_7d464663`).
