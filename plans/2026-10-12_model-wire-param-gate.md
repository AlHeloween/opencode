# Model wire facts — gate rejected fields, learn them once, persist limits

<!-- intention: our runtime merged `repetition_penalty` into EVERY request body and opencode-go/glm-5.3-flash rejects the unknown field with a 400 -> only fields the target actually accepts ride the wire; the rejection is the descent signal, recorded once per model (never hand-coded), and provider-stated context limits survive restarts -->

sv:
  Keywords: wire_param_gate 0.30, learned_facts 0.25, repetition_penalty_rejection 0.20, descend_record_rung 0.15, context_limit_persistence 0.10
  Semantic dominant: Provider rejections and stated limits become recorded per-model facts, learned at runtime, applied at one packaging point.
  md5: b7e2f1a4c9d05e63718f20ab44e9c3d5
  prev-md5: 00000000000000000000000000000000
  parent-goal-md5: 00000000000000000000000000000000

**Status:** COMPLETE 2026-10-12 — RED→GREEN focused, regressions green, stub E2E + live GLM smoke exit 0; closing commit names this plan.

## Context — measured evidence (2026-10-12)

- Failure (owner report, verbatim): `Upstream request failed: [unknown_parameter] invalid request body: json: unknown field "repetition_penalty"` — model `glm-5.3-flash`, provider `opencode-go`. All main agents are pinned to it in `bin/opencode.jsonc:30-50`.
- The exact failed call is captured: `.opencode/data/gateway/raw-wire/2026-10-12T04-30-16-488Z-…-attempt1.json` line 21 — top-level body field `"repetition_penalty":1.1` → `https://opencode.ai/zen/go/v1/chat/completions`. ✓ CONFIRMED (wire capture).
- Granularity is PER MODEL: same provider/session, `mimo-v2.6-flash` finished 11 assistant messages with the field in its bodies. ✓ CONFIRMED (message matrix `ses_ed1a7d890ffetT4R4GhfDoE1pP` + raw-wire).
- Field source: `src/session/llm.ts:629` merges it into every request; default 1.1 (`src/session/model-sampling.ts:31`); per-agent overrides in `src/agent/agent.ts`. ✓ CONFIRMED (read).
- Packaging: `@ai-sdk/openai-compatible@3.0.52` spreads unknown `providerOptions[providerName]` keys into the top-level body (dist/index.js:592-601); `ProviderTransform.providerOptions` (transform.ts:1339) is the single choke point for every merge source (sampling, agent, variant, plugin). ✓ CONFIRMED (read).
- No a-priori schema exists: OpenAI-compatible endpoints publish no request schema; Zen Go docs declare no per-model parameters (fetched 2026-10-12). Acceptance is NOT advertised — the provider's rejection NAMES the field. That is the descent signal.
- Precedents for learning at runtime already in-tree: `TokenCalibration` learns observed context limits from provider overflow messages (`src/session/token-calibration.ts`, in-memory only) and `provider/error.ts` already extracts `contextLimit` numbers. The gap was persistence — and every correction that had to survive a restart was hand-coded.

## Decision

1. **One store** — `provider_fact` table (relational plane until LMDB; shape of `session_epistemic`), keyed `provider/model`, `data` JSON: `{ unsupportedParams: string[], contextLimit?: number }`. New table ⇒ `CORE_SCHEMA_SQL` entry (the `session_epistemic`/`provider_file` pattern; no ALTER, no migration file). Module `src/provider/learned-facts.ts`.
2. **The gate** — `stripUnsupportedWireParams` inside `ProviderTransform.providerOptions` drops `seed ∪ learned` fields before the body is built. The static seed (`wire-params.ts`) stays as the compiled rung for the measured case and as the fallback when no DB is available.
3. **Learning on rejection** — `ProviderError.parseAPICallError` gains `unknown_parameter` (4xx + `unknown field "X"`, protected fields excluded); `MessageV2.fromError` (ctx gains `modelID`) records the fact and marks the error retryable ONLY when the record was NEW and PERSISTED → the existing retry spine re-issues, packaging now strips, the turn survives; a repeat rejection of an already-recorded field is NOT retried (bounded once, no loop).
4. **Limits persist** — `TokenCalibration.update/getObservedLimit` write through / read back `provider_fact.contextLimit`, so a provider-stated true limit (the space-bunny class: published 1M, actual 450k) survives restarts instead of being hand-added.
5. Rejected alternatives: dropping `repetition_penalty` everywhere (regresses accepting models); provider-wide strip (refuted by mimo); a-priori schema fetch (does not exist).

## Tasks

- [x] S1 red-first test `test/provider/wire-params.test.ts` — ✓ run `20261012T044706Z_2906edb6`: exit 1, `Cannot find module '../../src/provider/wire-params'` (the missing behavior, not a broken harness).
- [x] S2 seed gate in `ProviderTransform.providerOptions` + `wire-params.ts` — ✓ green run `20261012T044739Z_396e42f1` (4 pass / 0 fail).
- [x] S3 focused suites + typecheck — ✓ run `20261012T044749Z_fa9c5b12`: 178/178 (model-sampling, subagent-sampling, transform) + `tsgo --noEmit` exit 0.
- [x] S4 learned-facts store (`facts.sql.ts`, `db.ts` DDL, `learned-facts.ts`, gate union) — ✓ roundtrip + union tests in `test/provider/learned-facts.test.ts`, run `20261012T045638Z_c9a2f201` (9 pass / 0 fail).
- [x] S5 learning on rejection (`provider/error.ts` classification + `fromError` record/retry + processor modelID) — ✓ same run: fromError retry-once true/false asserted; regex hardened for JSON-escaped quotes after the first RED caught it (run `20261012T045558Z_0756d7d3`, 1 fail → fix → green).
- [x] S6 context-limit persistence via `TokenCalibration` — ✓ test asserts the durable row (`provider_fact.contextLimit = 450000`), same green run.
- [x] S7 regression on touched surfaces — ✓ runs `20261012T045710Z_2473acf6` (retry 78/78 incl. message-v2 + token-calibration) and `20261012T051630Z_7a57dd9d` (processor-effect + processor-tool-identity 21/21).
- [x] S8 E2E stub oracle — ✓ run `20261012T050006Z_eab16811` exit 0, `PONG`: stub log `04:59:25`-style pair — request WITH field → 400, request WITHOUT field (2.06 s later) → 200; raw-wire `05-00-12-attempt1` (with field) + `05-00-14-attempt1` (without); `provider_fact` row `{"unsupportedParams":["repetition_penalty"]}`. Second run `20261012T050028Z_2eed673d`: first and only request already WITHOUT the field (durable across processes) → `PONG`.
- [x] S9 GLM live smoke (seed path) — ✓ run `20261012T050048Z_baac8c56` exit 0, `PONG`; wire body `…"prompt_cache_key":"…","reasoning_effort":"max",…` — no `repetition_penalty`; no `unknown_parameter` anywhere.
- [x] S10 hygiene — `_build.ps1` run; `_progress_log.md` entry; commit naming this plan; `svm render`; plan move.

## Smoke Tests

| # | oracle | how | result |
|---|--------|-----|--------|
| B | new test fails on the missing behavior | `bun test test/provider/wire-params.test.ts` pre-S2 | FAIL (module absent) ✓ `20261012T044706Z_2906edb6` |
| 1 | seed gate | same test post-S2 | PASS ✓ `20261012T044739Z_396e42f1` |
| 2 | regressions | model-sampling + subagent-sampling + transform + typecheck | PASS ✓ `20261012T044749Z_fa9c5b12` |
| 3 | learned roundtrip | `bun test test/provider/learned-facts.test.ts` | PASS ✓ `20261012T045638Z_c9a2f201` |
| 4 | learning E2E | stub server → `run` | PASS ✓ one retry; attempt1 field→400, attempt2 clean→PONG `20261012T050006Z_eab16811` |
| 5 | persistence across runs | second `run` | PASS ✓ first attempt already clean `20261012T050028Z_2eed673d` |
| 6 | live GLM | source-run `-m opencode-go/glm-5.3-flash` | PASS ✓ `PONG`, clean wire `20261012T050048Z_baac8c56` |
| 7 | fallibility of the gate | pre-implementation RED is the disarm proof | PASS ✓ test #B failed before the gate existed |

## Risks

- R1 registry rot: learned facts may outlive an upstream fix → rows carry `time_updated`; revisit if a provider announces parameter support. Default-permissive: a stale fact drops one field.
- R2 over-stripping: protected set (`model`, `messages`, `stream`, `tools`, `tool_choice`) can never be learned; only identifier-shaped field names are recorded.
- R3 retry loop: bounded once per (model, field) by the persistence check — a repeat rejection is not retryable.
- R4 blast radius: `providerOptions` serves every provider; the gate no-ops without a fact. Suites + stub E2E cover it.

## Claims

- C1: glm-5.3-flash/opencode-go rejects a body carrying `repetition_penalty`; mimo-v2.6-flash same provider accepts it. Falsifier: 200 for GLM with the field (or 400 for mimo). ✓ stamped by S9 (GLM answers once stripped) + message matrix.
- C2: after the change, a rejected field is stripped for that model on the NEXT attempt automatically, without a code edit — and the fact survives a restart. Falsifier: stub E2E attempt2 still carries the field, or no `provider_fact` row. ✓ stamped by S8 (both runs).
- C3: no other model loses a field. Falsifier: any other pair stripped in tests. ✓ control tests green (mimo/deepseek untouched).
- C4: provider-stated context limits persist (space-bunny class). Falsifier: `getObservedLimit` returns undefined after `update` or no DB row. ✓ `provider_fact.contextLimit = 450000` asserted from the DB.

## Residual (named, not silently dropped)

- The owner's TUI session on `opencode-go/glm-5.3-flash` was not re-run from the old executable — the binary in `bin/` predates this change; the live proof is the source-run (S9), which is the repo's own live oracle for source changes. Promotion into `bin/` is the owner's act.
- h3 → h2 rungs cannot deliver to a plain-http loopback (measured: `HTTP3Unsupported` → h2 silent-empty); the stub config pins `protocol: "http/1.1"`. No product change made — a localhost-only artifact of the instrument.
- `provider/error.ts` message extraction prefers `body.message || body.error || body.error?.message`, so an object-shaped `body.error` shadows its `.message`; the gate searches `responseBody` too, which made it a non-issue here. Left as found.
