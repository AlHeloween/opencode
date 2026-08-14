# OpenCode-only session-affinity header

description: Restore `x-session-affinity` routing so external providers do not receive a session-specific transport header.

plan_id: 44f70f2f-72f0-4e3f-8e11-548ae020cdac
revision: 1
created_by: build_mode
state: COMPLETED

## Premises

- [Exact] The external OpenAI-compatible transport test currently fails because it receives `x-session-affinity: session-test-1`.
- [Exact] The current header branch sends the affinity header in the external-provider arm.
- [Exact] A captured StreamLake request includes the same external session-affinity header.

## Tasks

- [x] `RESTORE_OPEN_CODE_AFFINITY` — added `x-session-affinity` to the OpenCode header arm and removed it from the external arm in `packages/opencode/src/session/llm.ts`.
- [x] `VERIFY_EXTERNAL_HEADER` — the existing external OpenAI-compatible transport test passes and asserts that `x-session-affinity` is absent.

## Smoke Tests

Baseline [Exact]:

```powershell
cd D:\zPython\opencode\packages\opencode
bun test test/session/llm.test.ts --test-name-pattern "sends temperature, tokens, and reasoning options for openai-compatible models" --timeout 30000
```

Observed before edit: FAIL — expected no external affinity header; received `session-test-1`.

Post-change oracle:

```powershell
cd D:\zPython\opencode\packages\opencode
bun test test/session/llm.test.ts --test-name-pattern "sends temperature, tokens, and reasoning options for openai-compatible models" --timeout 30000
```

Pass criterion: external provider receives no `x-session-affinity` header.

Blast radius: request headers for OpenCode and external chat-completions transports. System prompt and request body are unchanged.
