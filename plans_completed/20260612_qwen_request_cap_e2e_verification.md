# Qwen Request Cap End-To-End Verification

Date: 2026-06-12
Status: Completed
Priority: High

## Goal

Verify the qwen/openai-compatible LLM request path sends a capped `max_tokens` value when model metadata reports native output equal to context.

## Abstract Definition

Let:

```text
C = resolved qwen model context limit
O = resolved qwen model output limit after test override
M = outgoing request max_tokens
```

For this verification:

```text
O = C
M = ProviderTransform.maxOutputTokens(model)
M < C
```

## Structural Diagram

```text
qwen fixture -> in-memory output=context override -> LLM.stream -> mock HTTP server -> captured max_tokens
```

## Inputs And Outputs

`LLM.stream(input)`

```text
input:  qwen-like resolved model and a user message
output: provider-compatible HTTP request body captured by local mock server
```

## Tasks

- [x] Add qwen-like request-body regression test in `session/llm.test.ts`.
- [x] Run focused LLM stream test from `packages/opencode`.
- [x] Run `bun typecheck` from `packages/opencode`.

## Test Cases

- Qwen/openai-compatible request with `output == context` sends capped `max_tokens`.
- Captured `max_tokens` is less than the context window.

## Verification

- [x] `bun test --timeout 30000 test/session/llm.test.ts -t "caps max_tokens for qwen-like"` from `packages/opencode` passed: 3 tests, 178 filtered, 0 failures (`cmd_runner` run `20260612T075720Z_e5b7a91e`).
- [x] `bun typecheck` from `packages/opencode` passed with exit code 0 (`cmd_runner` run `20260612T075744Z_64d9ca27`).
