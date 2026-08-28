# Reasoning round-trip contract (thinking models): DeepSeek / Z.AI / OpenRouter

**Status:** measured 2026-08-28 on `z-ai/glm-5.3-flash` (via OpenRouter) and
`deepseek-v4-flash` (direct `api.deepseek.com`)
**Probes:** `experiments/kv-cache-parity/2026-08-28_dialect_reach_probe.py`,
`experiments/kv-cache-parity/2026-08-28_deepseek_direct_dialect_probe.py`,
`experiments/kv-cache-parity/2026-08-28_chain_cache_probe.py`
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
| **DeepSeek direct** (`api.deepseek.com`) | **silently stripped** (D==B: 1403==1403 tokens) | **MANDATORY — HTTP 400 without it** (`"The reasoning_content in the thinking mode must be passed back"`); must exist **even when empty** | **yes** — concatenated into context |
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
  reasoning (KAT/StreamLake, Qwen docs, zen-proxied Kimi/GLM verified no-echo).
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
