# Plan: Pasha/StreamLake tool-replay cache — exact reproduction before repair

- plan_id: b4e7d1a9-2c5f-4a8e-9b3d-7e6f5d4c3b2a
- revision: 17
- created_by: build_mode
- state: **EXECUTING** (2026-08-17: P10 reduced to the null-classification bug; sidebar calculations are retained)
- date: 2026-08-16

## Status: F1–F5 PLANNED — repair is scoped by observed provider behavior

The official [Conversation API](https://www.streamlake.ai/document/DOC/mj9z6fh8lxn87i86jrp)
defines `usage: null` for ordinary streaming chunks. Its final streaming example contains
`prompt_tokens` and `completion_tokens`, but not `prompt_tokens_details.cached_tokens`.
It supplies `cached_tokens` only in the non-streaming response example. Therefore `null` or
missing cache detail on the OpenCode streaming route is expected accounting behavior, not a
cache miss and not a failed oracle.

In a live control-run without `preserve_thinking`, after tool-result there were numeric cache reads
`69,440` and `69,632`; in a repeated live preserve-run — `69,376` and `69,440`.
The first interrupted preserve-run returned `cached=null` at t2–t4. This does not establish
a collapse.

Существующие Python smoke допускают fallback на синтетический tool call и используют
`write_file`, а не обязательный реальный OpenCode `edit`. Они не являются oracle для заявленного
Pasha-Coder failure.

## Claim ledger

| ID | Claim | Status | Evidence / falsifier |
|---|---|---|---|
| C1 | Pasha route is OpenAI-compatible at the configured StreamLake endpoint. | Exact | `bin/opencode.jsonc` and successful live calls. |
| C2 | StreamLake documents `usage:null` for streaming chunks and may omit cache details in final streaming usage. | Exact | Official Conversation API. |
| C3 | A numeric terminal `cached_tokens=0` occurs specifically after an actual OpenCode `edit` replay. | Unknown | Must be reproduced without fallback. |
| C4 | `preserve_thinking` prevents C3 on that same terminal metric. | Unknown | Cannot drive implementation before C3 is Exact. |
| C5 | URL detection is an appropriate scope for KAT behavior. | Rejected | Custom endpoint semantics must be configuration-declared. |
| C6 | Current database aggregates cannot distinguish provider-reported cache miss from unknown cache accounting. | Exact | Processor classifies raw state, then DB stores collapsed `tokens_cache_read`; sidebar derives `cacheMiss` from all input tokens. |
| C7 | Gateway logs retain raw bodies and create generic text patches, but do not emit a correlated semantic request/response envelope or classify provider cache usage. | Exact | `adaptive-client.ts` captures independently named raw request/response files and passes bodies to `createPatch`. |
| C8 | StreamLake's `event: "model_thought"` with `delta.content` is currently treated as visible text, not reasoning. | Exact | The compatibility adapter recognizes only `reasoning_content` / `reasoning_text`; its stream chunk schema discards `event`. |
| C9 | Global gateway debug from `.opencode/gateway.jsonc` is working; model-level exceptions are not applied to a request, and `bin/opencode.jsonc` is not a gateway config source. | Exact | `loadGatewayConfig()` reads global/local `gateway.jsonc`; startup calls `resolveDebugConfig(config, null)` once although `getModelConfig()` and `resolveDebugConfig(config, modelConfig)` exist. |
| C10 | A provider-specific setting must be declarative by model identity, not endpoint/name regex. | Exact | C5 is rejected; custom inference endpoints cannot be reliably inferred from URL spelling. |
| C11 | The initial F1 sidebar edit replaced the previous cache-token display with unlabeled cache-step counts, so `56%` means 5 of 9 classified steps rather than a cache-token rate; child sessions are rendered as peers of `current`. | Exact | `git diff -- packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx`; live TUI evidence on 2026-08-17. |

## Provider request settings — only after endpoint contract evidence

```ts
// providerOptions() в transform.ts (~1213):
"models": {
  "<model-id>": {
    "request_options": {
      "chat_template_kwargs": { "preserve_thinking": true }
    }
  }
}
```

The final field name and schema are intentionally not fixed yet. It must be separate from
current model `options`, which are used at SDK-model construction time. A repair must route
per-model request settings into the request body, with no URL/provider-name heuristic.

If introduced, `request_options` is a model-operator contract: it is deep-merged last over
base, model, agent, variant, and plugin request parameters. It wins on conflicts and never
reaches SDK-model construction. A future variant-specific override must be an explicit typed
`request_options` field, not an accidental collision in the generic variant object.

## Fractal repair plan — five independent medoids

### F1 — tri-state cache accounting

Persist raw cache state at `finish-step`: `hit` only for a positive numeric value, `miss` only for explicit numeric zero, and `unknown` for absent or null detail. Carry it through both session aggregate write paths, public SDK schema/decoder, database migration, and sidebar. Token math may use zero where needed, but must not become cache-state provenance. Historical rows have no witness and remain `unknown`.

Oracle: a null/absent usage fixture increments only `unknown`; numeric zero increments only `miss`; positive numeric increments only `hit`; historical migrated rows remain unknown rather than reclassified. The sidebar retains its existing calculations, selection, compact formatting, colours, and orchestrator/main/child rows; only its label says `hit` rather than `read`.

### F2 — correlated semantic gateway trace and diff

Replace adjacent raw byte/text comparison as the diagnostic product with one redacted envelope per request id. Add an internal `gatewaySession` correlation value before wrapper selection; it is never sent as an HTTP header or body field. It must correlate request, response/SSE terminal frame, tool calls and matching tool results, provider usage shape, and a JSON-pointer semantic diff against the preceding request in the same route and `gatewaySession` bucket. Diff meaningful fields and report ignored volatile fields explicitly; redact body secrets as well as authorization headers.

Oracle: two interleaved fixture sessions produce no cross-session diff; each captured pair has one shared request id, an explicit `usage_state` (`absent`, `null`, `detail_absent`, `numeric`), a structured message/tool/replay delta, and no secret in any raw or derived artifact.

### F3 — StreamLake thinking event semantics

Extend the OpenAI-compatible stream schema and parser to retain `event`. For `event: "model_thought"`, route `delta.content` to a reasoning part rather than visible text. Keep normal OpenAI `delta.content` unchanged. Preserve numeric accounting: `completion_tokens_details.reasoning_tokens` is reasoning, and visible output is completion minus reasoning.

Oracle: a documented `model_thought → normal content/tool` fixture emits a reasoning delta and no text delta for the thought frame, then closes reasoning before normal text/tool; terminal usage `1470/454` becomes output `1016`, reasoning `454`.

### F4 — declarative model gateway exception in `opencode.jsonc`

Keep the working global debug in `.opencode/gateway.jsonc`, then make a typed model-level `gateway` setting in the normal `bin/opencode.jsonc` provider config effective at request time. At minimum, `gateway.enabled: false` bypasses the adaptive wrapper for that exact configured provider/model, while `gateway.debug` and `gateway.logging` become model-scoped overrides. Resolve by provider and model identity, never URL/name matching. Define leaf-level precedence: `opencode.jsonc model.gateway` > local `.opencode/gateway.jsonc model.gateway` > executable-adjacent `gateway.jsonc model.gateway` > merged gateway global > default. Deep-merge each gateway leaf so one local field cannot erase the others.

Oracle: config tests prove the selected model receives its declared bypass/debug decision, a different model retains global behavior, and the decision contains no credentials.

### F5 — configuration provenance debug

When a model-level gateway setting participates in a request, emit one redacted diagnostic event: provider id, model id, resolved gateway enabled/debug/logging values, the internal correlation id, and whether the wrapper was bypassed. Record provenance per resolved leaf (for example `sources.enabled`, `sources.debug`, and `sources.logging.logBodies`) rather than one ambiguous config layer. A bypass has no F2 capture envelope by design; it must declare `envelope_id: null`, not pretend that transport capture occurred. Do not add undocumented provider request fields (`cache_control`, `preserve_thinking`, or `request_options`) in this task.

Oracle: a targeted gateway test verifies an applied override and fallback-to-global decision; the captured event never contains API keys, Authorization, or full unredacted config.

## Historical investigation tasks

| Task | Что | Oracle |
|---|---|---|
| P1 | [~] Strict provider protocol runner executed: it emitted real `edit` and replay, but terminal cache detail was absent. | Missing terminal detail is `unknown`, never miss; the metric oracle was inconclusive. |
| P2 | [ ] Create and run a strict live OpenCode-route smoke: edit a disposable pre-existing file; require the real `edit` call, changed file witness, and matched tool-result replay on the next request. | Captured raw wire proves `edit` + changed file + matching tool-result; no named-tool forcing or synthetic replacement. |
| P3 | [ ] Classify raw streaming SSE before SDK normalization: `usage_absent`, `usage_null`, `cache_detail_absent`, `cache_numeric`. | Classification is observational only; `null`/absent are expected and never a miss. |
| P4 | [ ] Run control/preserve A/B through P2 with fresh per-run buckets and at least three repetitions. | C3/C4 become Exact only if terminal numeric usage establishes the effect. |
| P5 | [ ] Compare P1 and P2 envelopes: stable prefix, tools, assistant replay, tool result, and terminal accounting state. | A diff explains every material difference or P1 is revised. |
| P6 | [ ] Obtain endpoint-specific documentation or provider confirmation for any nonstandard cache field before adding it. | Evidence names the exact coding endpoint and accepted request field. |
| P7 | [ ] If P4 and P6 support C4, add a schema-validated per-model request setting in `opencode.jsonc`; remove URL detection. | `request_options` wins over base/model/agent/variant/plugin parameters; targeted config and fake-wire tests, precedence test, SDK-constructor exclusion test, then P4 against the actual OpenCode route. |
| P8 | [ ] If P4 rejects C4 or P6 cannot establish the field contract, discard the preserve hypothesis and investigate the P5 delta. | No provider-specific product change. |
| P9 | [ ] Persist tri-state cache accounting for database statistics: store `cacheState` per `step-finish`, then aggregate `hit`/`miss`/`unknown`; count a miss only from raw explicit numeric zero. | Nullable provenance migration (not `DEFAULT 0` counters), processor/session/public-SDK/sidebar tests prove `null`/absent increment only unknown; historical rows remain unknown rather than being reclassified. |
| P10 | [x] Keep the existing sidebar calculations, colours, compact formatter, and current/orchestrator/main/child selection unchanged; rename the cache-read label to `hit`. | Code comparison proves the original cache aggregation and `output > 0` selection remain in all four rows; focused cache classification suite proves null/absent contribute `hit=0`, `miss=0` only. |

## Smoke Tests (PRE_FLIGHT)

- baseline actual: `cd packages/opencode; bun test --timeout 30000 test/provider/copilot/copilot-chat-model.test.ts` → 14 pass, 0 fail (2026-08-17).
- baseline: the official API defines numeric `usage.prompt_tokens_details.cached_tokens`; numeric `0` is a provider-reported zero cache read. Intermediate streaming `usage:null` is ignored.
- failure oracle: P1 fails if the model does not return a declared `edit` tool call; it never substitutes one. A missing terminal cache field yields `unknown`, not a miss. P2 fails unless the disposable-file witness and a matching call id prove actual OpenCode dispatch and replay.
- capture oracle: P1/P2 install an isolated `globalThis.__gatewayFetch` wrapper around the selected real provider path and retain a redacted raw request/SSE envelope. `diff_requests` is not a wire capture.
- post-P3 oracle: each streaming frame records the raw accounting state before SDK normalization. Only terminal numeric `cached_tokens`, including `0`, is a cache result; all other states are `unknown`.
- post-P7 oracle: `cd packages/opencode; bun test --timeout 30000 test/provider/provider.test.ts test/provider/transform-reasoning.test.ts` → exit 0, plus the strict protocol A/B and OpenCode-route behavioral smoke.
- F1 baseline: `cd packages/opencode; bun test --timeout 30000 test/session/cache-classification.test.ts`.
- F2/F4/F5 baseline: focused gateway/config tests run from `packages/opencode`; captures use redacted fixture traffic, not a production credential.
- F3 baseline: `cd packages/opencode; bun test --timeout 30000 test/provider/copilot/copilot-chat-model.test.ts`.

## P1 live attempt — inconclusive

- `smoke_streamlake_edit_protocol.py --stream`: provider emitted exactly one `edit` call and the second request replayed the same call id, but both terminal frames had `prompt_tokens_details: null`.
- `smoke_streamlake_edit_protocol.py` (non-streaming): the same strict `edit` and matching replay succeeded; both terminal JSON responses again had `prompt_tokens_details: null`.
- Result: `cache_state=unknown`, not `miss`; C3/C4 remain Unknown. The artifacts are local redacted experiment output and are not committed.

## Historical local checks — not provider acceptance

- The `baseURL` regression and fake-fetch serialization test only prove local code paths.
- They are not evidence for C3 or C4 and do not authorize a StreamLake-specific repair.

## Outcome contract

- OC1: C3 is either proven by strict terminal provider evidence on the OpenCode route or explicitly rejected by reproducible evidence.
- OC2: A chosen product repair has a live oracle proving it changes OC1 as intended.
- OC3: No URL/name heuristic selects provider semantics.
- OC4: `null` and absent accounting never count as a cache miss.
- OC5: Database and UI cache statistics expose `unknown` separately from provider-reported misses.
- OC6: Gateway diagnostics correlate an actual request with its response and explain semantic cache/tool/thinking changes without byte-only diffs.
- OC7: A StreamLake `model_thought` frame cannot become visible assistant text.
- OC8: Gateway exceptions and debug controls are declarative in `opencode.jsonc`, model-scoped, and have observable redacted provenance.
- coverage_threshold: 1.0.

## Risks

- R1: Provider streaming telemetry can be null/absent by documented contract; only terminal numeric `cached_tokens` can measure C3/C4.
- R2: Direct smoke can differ from OpenCode serialization; P3 is mandatory before attribution.
- R3: `cache_control: "auto"` remains an unverified field and is excluded from this plan.
- R4: `request_options` must have defined precedence over model, agent, and variant options and must not enter the SDK-model constructor.
- R5: Historical aggregate rows have no raw cache-state witness and must not be backfilled as misses.
