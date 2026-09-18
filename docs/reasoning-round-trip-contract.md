# Reasoning round-trip contract (thinking models): DeepSeek / Z.AI / OpenRouter

**Status:** measured 2026-08-28 on `z-ai/glm-5.3-flash` (via OpenRouter) and
`deepseek-v4-flash` (direct `api.deepseek.com`); capture dialects, boundary
census, and the SDK tail-rule patch added 2026-09-14
**Probes:** `experiments/2026-08-29_kv-cache-parity/2026-08-28_dialect_reach_probe.py`,
`experiments/2026-08-29_kv-cache-parity/2026-08-28_deepseek_direct_dialect_probe.py`,
`experiments/2026-08-29_kv-cache-parity/2026-08-28_chain_cache_probe.py`
**Siblings:** `docs/deepseek-thinking-cache.md`, `docs/streamlake-kat-thinking-cache.md`

## ⚠️ Governing rule — read before touching reasoning fields

**Never assume how a vendor handles reasoning fields. Read the official model docs
AND run a wire smoke-test (400/200 + `prompt_tokens` A/B) before shipping.**
The same field name behaves differently per vendor; some strip silently, some 400.
This rule exists because the SDK dialect (`reasoning` + `reasoning_details`) is NOT
what vendors document — and the failure mode is silent data loss or a hard 400 on
every tool-call turn.

**OpenRouter is opaque in both directions.** It silently rewrites fields (proven
above) and it relays upstream errors / rate rhythms without normalization — case:
MIMO 2.5 Pro (Alibaba) gateway failures came from a different request rhythm and
OpenRouter simply forwarded the errors, making them undiagnosable through the OR
layer. Corollary: the same model **direct** vs **via OpenRouter** is NOT the same
wire — when something misbehaves through OR, verify against the vendor-direct API
before blaming your own pipeline.

Official references (checked 2026-08-28):

- DeepSeek Thinking Mode: <https://api-docs.deepseek.com/guides/thinking_mode>
- DeepSeek Context Caching: <https://api-docs.deepseek.com/guides/kv_cache/>
- Z.AI Deep Thinking: <https://docs.z.ai/guides/capabilities/thinking>

## The contract (Exact, live-probed 2026-08-28)

| Vendor / route | Extra fields (`reasoning`, `reasoning_details`) | `reasoning_content` on tool turns | Model sees CoT? |
|---|---|---|---|
| **DeepSeek direct** (`api.deepseek.com`) | **silently stripped** (D==B: 1403==1403 tokens) | **echo required when `tools` present** — see the correction below: the 400 is triggered by a `tool_call` **id the server never issued**, not by a missing field | **yes** — concatenated into context |
| **OpenRouter → Z.AI** | **stripped before upstream** (A==B==C: 1247==1247==1247 tokens) | not required (200 without) | **never** — reasoning is client↔OpenRouter only |
| **OpenRouter → Z.AI** | **stripped before upstream** (A==B==C: 1247==1247==1247 tokens) | accepted at the OpenRouter layer (200), but stripped pre-upstream | **never** — reasoning is client↔OpenRouter only |
| **Z.AI direct** (`api.z.ai`, per docs) | not part of the documented API | **untested** (no direct key; docs document the field as response-only) | undocumented |
| **StreamLake/KAT** (see sibling doc) | no-echo verified live | — | no (echo changed model behavior: 50 vs 142 reasoning tokens) |

DeepSeek rules (official, confirmed live):

- With `tools`: `reasoning_content` must be passed back **for all turns**, even
  turns without tool calls, and even when the CoT was **empty** — otherwise HTTP 400.
- Without `tools`: input `reasoning_content` is **ignored** — echoing costs wire bytes only.
- Single native field name: **`reasoning_content`**. There is no `reasoning` (string)
  or `reasoning_details` (array) in either vendor's documented API — those are
  OpenRouter client-dialect fields.

### Correction 2026-09-12 — the tool-turn 400 is misattributed [Exact]

Re-probed against `api.deepseek.com` (`deepseek-flash` **and** `deepseek-v4-pro`;
`experiments_history/2026-09-12_deepseek-h3/REPORT.md`). The 400 message names
`reasoning_content`, but the field is **not** what triggers it:

| replay shape | `reasoning_content` | result |
|---|---|---|
| server-issued `tool_call` id, verbatim | absent | **200** |
| server-issued id, arguments mutated | absent | **200** |
| server-issued id, 1 char flipped / truncated / uppercased | absent | **400** |
| synthetic id (even with the real `call_00_` prefix) | absent | **400** |

The discriminator is whether the `tool_call` id was **issued by the server** in the
same conversation — a replayed id it never produced fails regardless of the CoT
field. The legacy 2026-08-28 probe (variant C) reproduced the 400 because its body
used a synthetic `call_probe_1`, which is exactly this case.

Consequences: (1) keep the echo — the CoT is still concatenated into context when
`tools` is present, so dropping it changes what the model sees; (2) never *synthesise*
a `tool_call` id when replaying (fixtures included) — the error text will point at
`reasoning_content` and mislead the diagnosis.

Also measured the same day: `reasoning_effort` accepts
`none,minimal,low,medium,high,xhigh,max` — the documented `ultra` returns **400**;
`thinking:{type:"disabled"}` and `reasoning_effort:"none"` both stop thinking; the
Anthropic-format `{"reasoning":{"effort":"none"}}` is **ignored** on `/chat/completions`.

## Where the dual-field noise comes from

OpenRouter rewrites both directions into its own dialect. Z.AI streams
`delta.reasoning_content` (per their docs); OpenRouter re-emits **two copies** per
delta — legacy `reasoning` (string) + canonical `reasoning_details` (array with
`format: "unknown"`) — plus its own `provider`, `gen-*` ids, `native_finish_reason`.
The `@openrouter/ai-sdk-provider` (v2.10 ≡ v3.0, tarball-verified — no local patch)
accumulates both and mirrors them on the round-trip. Fingerprints that the fields
are OpenRouter constructs, not vendor API: `format: "unknown"`, `provider: "Z.AI"`
inside SSE, `native_finish_reason`.

Consequence: through OpenRouter the duplicate **never reaches the model** (stripped
pre-tokenization) — it costs client↔OR wire bytes only. Through **direct vendor
APIs** every field you add is your own problem: contract field mandatory, extras
either stripped (DeepSeek) or undocumented (assume hostile).

## What opencode does (implementation)

- `packages/opencode/src/provider/gateway/adaptive-client.ts` — `rewriteReasoningContent()`:
  for models matching `z-ai/|glm|deepseek` the gateway rewrites the outgoing body
  before dispatch: assistant `reasoning` + `reasoning_details` → single native
  `reasoning_content`; tool-call turns with empty CoT get `reasoning_content: ""`
  (400-guard). Non-target providers pass through untouched (anthropic encrypted
  signatures etc.).
- `packages/opencode/src/provider/transform.ts` — per-vendor branches for the
  non-gateway routes: DeepSeek/MIMO tool-call turns keep full CoT echo; no-tool
  turns drop it (vendor-ignored); openai-compatible routes drop historical
  reasoning (KAT/StreamLake live-verified, Qwen opt-in, zen-proxied Kimi/GLM
  live-verified). Qwen's rationale was corrected 2026-09-18: its current docs
  describe `preserve_thinking`, an opt-in that feeds historical
  `reasoning_content` back as billed input, and a missing field is NOT an error —
  so no-echo matches the documented default, but the old "do not add the
  reasoning_content field" citation is not what the docs say.
- **Vendor replay matrix (2026-09-18)** —
  `plans/futures/2026-09-16_reasoning-roundtrip-vendor-matrix/MATRIX.md`: primary-source
  answers per vendor. **Anthropic (`signature`) and Gemini (`thought_signature`)
  REQUIRE replay**; OpenAI, xAI, Qwen and OpenRouter treat it as
  optional-but-used; Z.AI GLM and Mistral document nothing request-side. Anthropic
  and Gemini ride their own SDKs, so they sit outside the openai-compatible strip
  branch above.
- `packages/opencode/src/provider/gateway/raw-diff.ts` — the capture assembler
  reads the native dialects too (`reasoning_content`, `reasoning_text`) next to
  the OpenRouter pair, dispatching by FIELD: incremental native fragments are
  concatenated, cumulative OpenRouter text keeps suffix-growth dedup. Measured
  2026-09-14: 836 recorded chunks rendered as "Reasoning (0 chars)" because only
  the OpenRouter fields were read.
- `@ai-sdk/deepseek` (3.0.48, unpatched) — the SDK's own converter owns the
  family contract now: `isDeepSeekV4Model` matches `deepseek-v4*`,
  `deepseek-flash*` and `deepseek-pro*`; V4 assistant turns keep their full
  CoT (`reasoning_content` = concatenated reasoning parts, regardless of
  position), and an empty `reasoning_content` is backfilled when a V4 turn
  produced none. The fork-side patch on 3.0.26 (`/deepseek-(?:v4|flash)/`
  predicate) was retired 2026-09-18 — upstream absorbed the predicate. Matches
  the measured dumps (81% of tail turns carry CoT vs 12% of history) and the
  KAT no-echo result above.
- `packages/opencode/src/provider/transform.ts` / `reasoningCensus` — logs
  `assistant/toolCall/cotText/cotEmpty/cotAbsent` before and after
  `normalizeMessages` on every request, and warns loudly when the 400-guard
  fills empty `reasoning_content` on tool-call turns (262k such turns across
  1976 raw-wire dumps shipped silently; live read 2026-09-14: `cotAbsent 11` of
  42 tool-call turns in, `cotEmpty 11` out, warn `turns: 9`).
- Measured effect on a live 1.73 MB body: **−334k chars (−19.4%)** wire bytes,
  ~91k tokens of reasoning carried once instead of twice.

## Smoke-test recipe (any vendor, ~5 calls)

1. Take the vendor's official docs for the thinking/reasoning field name and rules.
2. Probe the assistant-turn variants against the SAME conversation (cold, distinct
   cache keys): A = SDK dialect dual, B = documented native field, C = field absent.
3. Interpret: `prompt_tokens` equal → vendor strips extras (fields are cosmetic);
   A/B/C differ → fields are tokenized context (contract is real); HTTP 400 → the
   field is mandatory; note which spelling the 400 message names.
4. Re-run the chain probe (`..._chain_cache_probe.py`) to confirm cache behavior
   with the winning variant (expect monotonic cached growth, uncached = new suffix).

Known probe results are recorded above; re-run after any vendor-side change.

## Family note (Chinese providers)

DeepSeek and Z.AI/GLM documented and verified. Expected same family behavior for
MIMO, Qwen, Kimi, MiniMax and other CN thinking models — **but verify per vendor**:
the existing transform notes already record divergence inside this family
(KAT/StreamLake ignores the thinking toggle; Qwen officially forbids echoing
`reasoning_content`; zen-proxied Kimi/GLM surfaced no reasoning at all).
