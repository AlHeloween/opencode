# t71 — keyless cost-0 models answer 401/429/hang: measurement + diagnosis (no product edits)

Date: 2026-10-16. Task: re-run the 10-07 instrument exactly, separate the layers,
name the layer that answered, propose a fix (not applied).

## 1. Method (receipts)

- Instrument: `experiments/2026-10-07_free-model-smoke/run.ps1`, UNMODIFIED, launched
  detached (`Start-Process pwsh … -WindowStyle Hidden`, NOT under cmd_runner — its
  README: a cmd_runner-launched harness dies after the first full `opencode run`).
  Launch receipt: hidden pwsh spawn, run id `20261016T082703Z`.
- Candidate: `dist/bin/opencode.exe`, version **10.0.1393** (from the runs' own
  session logs, `version` field — no `bin/` touched, no version probe launched).
- Keyless stand: harness removed every key-shaped name from its process env
  (children inherit the clean env). Removed NAMES only (11):
  `BASETEN_API_KEY, DEEPSEEK_API_KEY, GITHUB_PAT_TOKEN, HF_TOKEN, NOVITA_API_KEY,`
  `OPENCODE_API_KEY, OPENCODE_PID, OPENCODE_PROCESS_ROLE, OPENCODE_RUN_ID,`
  `OPENROUTER_API_KEY, STREAMLAKE_API_KEY`. Catalog env names known: **228**
  (10-07: 223). No values read or printed. No paid calls (all models cost-0).
- Supplementary probe (same keyless shape, ONE model, old client):
  `experiments/2026-10-16_keyless-401/oldbuild-probe.ps1` against
  `.temp/dist-backup-20260918/opencode.exe` (mtime 2026-09-18, pre-10-07;
  self-reports version **10.0.1007**), ws `.temp/test/t71-oldbuild/space-bunny-free/`.
- Service-side docs: delegated to `researcher_agent` (web only, no shell):
  `https://opencode.ai/v2/docs/console/api/inference/` (keyless rule),
  `https://opencode.ai/v2/docs/console/models/`, `https://opencode.ai/changelog`
  (v2.0.30 Oct 15 protocol-specific endpoints), plus secondary gating reports.
  Full stamps in §4.

## 2. Re-run results (run `20261016T082703Z`, exact 10-07 instrument)

| model | 10-07 baseline | 10-16 re-run | delta |
|---|---|---|---|
| deepseek-v4-flash-free | Model not found, 3.8 s | `ProviderModelNotFoundError`, 10.2 s | SAME class (local) |
| nemotron-3-ultra-free | ANSWERED 15.8 s | **TIMEOUT 180 s, zero bytes** (stdout+stderr empty; session log: request out on h2, no error, no token; killed by harness) | REGRESSED |
| space-bunny-free | ANSWERED 15.8 s | **TIMEOUT 180 s at harness level**; session log: `stream error` at +6.4 s → `429 FreeUsageLimitError` (body §3), client retries to kill | REGRESSED |
| kimi-k2.5-free | Model not found 3.5 s | Model not found 3.6 s | SAME |
| glm-5-free | Model not found 3.6 s | `ProviderModelNotFoundError` 17.7 s | SAME class |
| minimax-m3-free | Model not found 3.4 s | `ProviderModelNotFoundError` 8.8 s | SAME class |
| qwen3.6-plus-free | Model not found 3.3 s | `ProviderModelNotFoundError` 8.8 s | SAME class |
| control gpt-5.4 (paid) | not answered (valid) | not answered, `ProviderModelNotFoundError` 7.6 s | VALID — no key leaked |

Answered 10-07: 2/7. Answered 10-16: **0/7**. Both 10-07 answerers regressed.
Raw: `experiments/2026-10-07_free-model-smoke/results.json` + `results.jsonl` (new run).

## 3. Layer separation

### (a) The request our client sends (code pins, no live header bytes)

- Credential: `packages/opencode/src/provider/provider.ts:174-195` — keyless
  (`!ok`: no env key, no auth record, no config apiKey) keeps only
  `cost.input === 0` models and returns `options: { apiKey: "public" }`.
  UNCHANGED since before 10-07 (last touch 2026-10-05, DeepSeek tariff only — §5).
- SDK path: `@ai-sdk/openai-compatible` (pinned live in both runs'
  `reasoning census` log lines, `apiNpm` field). Per SDK contract the apiKey
  rides as `Authorization: Bearer <apiKey>` — corroborated in-tree by
  `packages/opencode/src/provider/files-api.ts:69`
  (`Authorization: Bearer ${apiKey}`) and by the official inference docs
  (`Authorization: Bearer <token>`). Live header bytes were NOT captured
  (TLS to opencode.ai; gateway per-request debug off) — the value `Bearer public`
  is Inferred from code, not wire-observed.
- Endpoint: the catalog base URL is LIVE (file gitignored since 2026-07-23,
  `340d181f45`; provider-sync refetches at startup). Observed flip DURING this
  run: `packages/opencode/src/provider/models/opencode.json:1` read
  `https://opencode.ai/inference/v1` at ~16:14+08, and
  `https://opencode.ai/inference/openai/v1` with mtime **2026-10-16T16:23:36+08**
  (sync rewrite during the space-bunny run). Effective URL in BOTH runs'
  error payloads: `https://opencode.ai/inference/openai/v1/chat/completions`
  — the protocol-specific endpoint from service changelog v2.0.30 (Oct 15).
- Transport: new client probes `h3` (5 s bound, `H3_PROBE_TIMEOUT_MS`,
  `adaptive-client.ts:99,823`) then pins `h2`
  (`gateway-adjustments.json: resolvedProtocol: h2`, nemotron ws); old client
  (10.0.1007) uses configured `h2` directly. Both reach the service.

### (b) The service's answer body (wire receipts)

space-bunny-free keyless, NEW client (10.0.1393), 08:23:28Z —
payload `.temp/test/client-ws/space-bunny-free/.opencode/data/log/1792139008279_…082328.279.md:2081-2099`:
- `statusCode: 429`, `server: cloudflare`, `cf-placement: remote-IAD`,
  `retry-after: 56192` (~15.6 h), `x-opencode-log-id: ea0a9b6e-03ac-489c-acdd-3f1b0070eaac`
- `responseBody: {"type":"error","error":{"type":"FreeUsageLimitError",
  "message":"Rate limit exceeded. Please try again later."}}`, `isRetryable: true`
- client retries the retryable 429 until the harness kills it at 180 s
  (harness-level timeout masks the real error — residual §7).

space-bunny-free keyless, OLD client (10.0.1007, Sept 18), 08:28:21Z —
payload `.temp/test/t71-oldbuild/space-bunny-free/.opencode/data/log/1792139301178_…082821.178.md:1760-1776`:
- SAME `url`, SAME `statusCode: 429`, SAME `FreeUsageLimitError` body,
  `retry-after: 55899`, `x-opencode-log-id: fb369d3f-43cc-4ccb-8bb7-ac82b5577ffd`.

nemotron-3-ultra-free keyless, new client: NO answer at all — no status, no body,
no error in any ws log; stream open 180 s on pinned h2, killed by harness.

t59 W5 (testimony, not my measurement): 4 models × 5 turns → `APIError 401
Invalid credential, isRetryable:false` on stand `.temp/t59-stand/opencode.exe`
@ 10.0.1374 (`plans/2026-10-15_web-tui-parity.md:92`).

### (c) What changed 10-07 → 10-16: our side vs service side

OUR side (git, `Local_Development`):
- `git log --since=2026-10-07 -- packages/opencode/src/provider/provider.ts`
  → EMPTY. Same empty for `gateway/adaptive-client.ts`, `provider-sync.ts`,
  `auth.ts`. Last provider.ts change: **2026-10-05** `8a9e9c2163` (DeepSeek
  peak tariff; stat: config/provider.ts, provider.ts, tariff.ts, session.ts,
  tests — no keyless path).
- 40 commits in the window, none in the credential path. Nearest neighbor:
  t65 `0bb8113f53` message-v2 reasoning shaping — message CONTENT, not auth.
- Catalog is not ours to diff (gitignored, live-synced).

SERVICE side:
- Changelog v2.0.30 (Oct 15): "Use protocol-specific inference endpoints for
  OpenCode providers" — matches the live `/inference/openai/v1` base.
- No announced keyless retirement (researcher: changelog has none) and docs
  STILL bless headerless free calls — but secondary reports (Oct 13–15)
  corroborate tightened free-tier gating ("only … within OpenCode",
  `MissingSessionID` since Sept 12). The free pool now answers keyless with
  `429 FreeUsageLimitError` (15.6 h retry-after), per-model `401 Invalid
  credential` (t59), or silence (nemotron) — all server-chosen responses.

## 4. Verdict: the layer that answered is SERVICE

Same request shape (Bearer public → protocol-specific endpoint) gets:
- on a PRE-10-07 client (10.0.1007): the SAME 429 body as today's client;
- on today's client (10.0.1393): 429 / hang / local-not-found by model;
- on t59's stand (10.0.1374): fast 401s on its 4 models.
No client change in the window can explain same-answer-on-old-build. The 10-07
keyless path regressed SERVER-side: free-pool rate limiting
(`FreeUsageLimitError`, retry-after ~15.6 h) plus per-model rejection
(`401 Invalid credential`) and at least one stalled stream (nemotron, zero
bytes 180 s on a healthy pinned h2). Transport (h3-probe→h2) and credential
wiring (`apiKey: "public"`, cost-0 filter, control valid) behave as designed.

Research stamps (researcher_agent, 2026-10-16):
- inference auth doc: official_docs,
  `https://opencode.ai/v2/docs/console/api/inference`,
  "free chat models can be called without it" — Inferred.
  (`content_hash: 52b1f3e2…`; full hashes in sub-agent receipt.)
- models/pricing page: official_docs,
  `https://opencode.ai/v2/docs/console/models` — free = $0 tier behind
  sign-in flow; no `"public"` anywhere — Inferred (negative for public-key).
- changelog Oct 8–15: official_docs, `https://opencode.ai/changelog` —
  no keyless retirement announced — Inferred (negative).
- zen-proxy#10 (Oct 13–15), gist NeiP4n (Sept 12): secondary, session-gating
  corroboration — Hypothetical.
- `"public"` as ever-supported: NOT FOUND anywhere — Unknown (do not treat
  our `apiKey: "public"` as ever-official; it is a client convention).

## 5. Pins

- `packages/opencode/src/provider/provider.ts:174-195` (keyless cost-0 + public)
- `packages/opencode/src/provider/models/opencode.json:1` (live base URL)
- `packages/opencode/src/provider/gateway/adaptive-client.ts:99,785-800,823`
  (h3 probe 5 s, decision log, chain)
- `packages/opencode/src/provider/files-api.ts:69` (Bearer pattern)
- `plans/2026-10-15_web-tui-parity.md:92` (t59 401 testimony)
- `plans/2026-10-16_model-chain-failover.md:66` (terminal=auth/401/403…,
  transient=429/5xx/timeout/no-first-token classifier — existing doctrine)

## 6. Proposed fix (NOT applied — bin promotion pending from clean tree)

Hypothesis: the service no longer accepts the undocumented `Bearer public`
convention on (some) free pools — headerless is the documented keyless form,
and an unknown credential value plausibly converts pool-exhaustion into
`401 Invalid credential` instead of the documented anonymous path.
1. Keyless free calls OMIT `Authorization` (docs-blessed) instead of sending
   `Bearer public` (provider.ts opencode loader: `options: {}` + a
   header-suppression for the compatible SDK; paid/keyed path untouched).
2. Classify `FreeUsageLimitError` keyless as TERMINAL-for-keyless with the
   message + `retry-after` surfaced (no blind retry into a 15.6 h wall).
3. TTFT guard: no-first-token within N s → transient + abort (t68 classifier
   already names it; wire it to the keyless path so a nemotron-style stall
   surfaces instead of burning 180 s).
Test (not written): `test/provider/keyless-free.test.ts` — unit: keyless
resolves to NO apiKey + cost-0-only filter intact; live (keyless, ONE free
model): ANSWER or classified `FreeUsageLimitError`/401-with-log-id,
FAIL on hang past the TTFT bound and FAIL on control answering.
Discriminator for the hypothesis: same model, headerless vs `Bearer public`
→ 401-vs-429 split decides it.

## 7. Residuals (bounded, routed)

- R1: nemotron silent hang root cause (service stall vs client stream bug) —
  no bytes either way; needs a TTFT-instrumented probe (route: new leaf).
- R2: t59's 4×401 models unidentified here (different set from 10-07's);
  reconcile against t59's stand logs before claiming "401 for model X".
- R3: live `Authorization` header bytes never captured (TLS) — (a) rests on
  code + SDK contract; a debug-gateway capture (`OPENCODE_GATEWAY_LOG_DIR`
  per-request, secrets masked) would close it.
- R4: harness masks retryable errors as timeouts (space-bunny 429 → 180 s
  TIMEOUT line); harness should record first terminal body. Not my path to fix.
- R5: old-build probe exceeded no bounds (100 s cap, killed on timeout);
  its stdout line unread here — payload receipt stands alone (sufficient).

## 8. Method notes / tool states

- Detached-hidden launch worked around the documented cmd_runner harness
  death; receipts read from the harness's own `results.jsonl/json`.
- `read` on the 60 KB+ payload dump paid once; `grep`+offset reads after.
- Contamination watch: `.temp/test/client-ws/deepseek-…` ws vanished mid-run
  (another robot's `_build.ps1` cleans `.temp/test/`); dirs created after
  that point persisted. No `bin/` touched. No keys handled.
- Archive: this dir → `experiments_history/2026-10-16_keyless-401/` + inputs.
