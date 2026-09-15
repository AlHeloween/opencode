# DeepSeek thinking-mode + HTTP/3 transport probes (2026-09-12)

Key: `DEEPSEEK_API_KEY` from env (never printed; only `len=` shown).
Refs read before writing: <https://api-docs.deepseek.com/guides/thinking_mode>,
<https://api-docs.deepseek.com/quick_start/pricing>,
<https://api-docs.deepseek.com/news/news260910>.

## Why

User pointed at the DeepSeek thinking-mode guide and asked (1) what we already
have, (2) what about "h3", (3) a smoke test, (4) an implementation plan.
In this repo **`h3` = the HTTP/3 transport** (`GatewayProtocol` in
`packages/opencode/src/provider/gateway/adaptive-client.ts`), not a model.

## Scripts

| Script | Purpose |
|---|---|
| `probe-h3-deepseek.mjs` | HTTP/3 availability on `api.deepseek.com` (control: `cloudflare-quic.com`) |
| `bench-h1-vs-h2.mjs` | interleaved h1.1 vs h2 streaming benchmark |
| `probe-thinking-deepseek.mjs` | thinking contract matrix (toggle, effort, tool replay) |
| `probe-thinking-deepseek2.mjs` | follow-ups: `effort:none`, disabled+tools, non-empty CoT replay |
| `probe-thinking-off-switch.mjs` | full-`usage` confirmation of the off switches |
| `probe-400-bisect.mjs` | bisect the documented tool-turn 400 (system/thinking/effort/pck/content) |
| `probe-400-discriminator.mjs` | real vs synthetic `tool_call` id |
| `probe-400-narrow.mjs` | server id + mutated args; fabricated id with the real prefix |
| `probe-400-idmech.mjs` | id-verbatim vs 1-char-flip / truncation / uppercase |

Run: `cmd_runner start -- bun experiments/2026-09-12_deepseek-h3/<script>.mjs`

## Results [Exact] — HTTP/3

```
bun 1.4.2
--- cloudflare-quic (control) ---
http2 : status=200  65ms alt-svc="h3=":443"; ma=86400" server="cloudflare"
http3 : status=200  27ms alt-svc="h3=":443"; ma=86400" server="cloudflare"
--- deepseek-root ---
http2 : status=404 139ms alt-svc="-" server="elb"
http3 : ERROR(25ms) TypeError: HTTP3HandshakeFailed
--- deepseek-models /v1/models ---
http2 : status=200 104ms alt-svc="-" server="elb"
http3 : ERROR(22ms) TypeError: HTTP3HandshakeFailed
```

- The **client** can do h3 (control passes) → the probe is decisive about the server.
- `api.deepseek.com` does **not** serve h3: `HTTP3HandshakeFailed`, no `alt-svc`, `server: elb`.
- **h2 works** (`status=200` on a pinned `http2` fetch), while
  `resolveGatewayProtocol("deepseek")` currently returns `"http/1.1"`.

### h1.1 vs h2 (6 interleaved pairs, `deepseek-flash`, streaming)

| arm | ok | total median | min | max |
|---|---|---|---|---|
| http1.1 | 6/6 | 732ms | 553 | 836 |
| http2 | 6/6 | 726ms | 389 | 1274 |

TTFB was 0–1ms in both arms (buffered first chunk), so total is the only usable
signal — and the medians are within noise. **No measured reason to move the
deepseek default to h2**; h3 is impossible until DeepSeek enables QUIC.

## Results [Exact] — thinking mode

### Official doc says

- OpenAI format: `{"thinking":{"type":"enabled"|"disabled"}}` + `reasoning_effort: low|high|max`.
- Anthropic format: `{"reasoning":{"effort":"none|low|high|max"}}` (`none` = thinking off).
- Effort aliases: `minimal→low`, `medium→high`, `xhigh→high`, `ultra→max`.
- Default: thinking **enabled**, effort **high**. `temperature` ignored; `top_p` floored at 0.95.
- With `tools`, `reasoning_content` **must be passed back** or HTTP 400.

### Wire actually does (deepseek-flash, and the same on deepseek-v4-pro)

| Probe | Result |
|---|---|
| `thinking:{type:"disabled"}` | 200, no `completion_tokens_details`, no `reasoning_content` → **off** |
| `reasoning_effort:"none"` | same → **off** (the only off value the wire accepts) |
| `reasoning_effort` ∈ `minimal,low,medium,high,xhigh,max` | 200, thinking on |
| `reasoning_effort:"ultra"` | **400** `unknown variant 'ultra', expected one of none, minimal, low, medium, high, xhigh, max` |
| default (no field) | thinking on, effort high (76 reasoning tokens on the control question) |
| `{"reasoning":{"effort":"none"}}` on `/chat/completions` | thinking **stays on** (40 reasoning tokens) → Anthropic-format field is ignored here |

**Divergence 1 [Exact]:** the doc advertises `ultra`, the wire rejects it with 400.
**Divergence 2 [Exact]:** the Anthropic-format off switch documented for the
Anthropic endpoint has no effect on the OpenAI-format `/chat/completions`.

### The documented tool-turn 400 is misattributed

```
D0 real tool_call, reasoning_content ABSENT        -> 200
D1  same, max_tokens 32                            -> 200
D3  same, content:null                             -> 200
E0  server-issued id + MUTATED arguments           -> 200
D2  SYNTHETIC id ("call_probe_1")                  -> 400 "reasoning_content must be passed back"
E1  fabricated id WITH the real "call_00_" prefix  -> 400
E2  fabricated id without prefix                   -> 400
B0..B6 bisect (system/thinking/effort/pck/content) -> 400 (all synthetic ids)
G1  real id, 1 char flipped                        -> 400
G2  real id, last char truncated                   -> 400
G3  real id, uppercased                            -> 400
G4  real id verbatim (control)                     -> 200
```

**Cause [Exact]:** HTTP 400 is triggered by a `tool_call` **id the server did not
issue**, not by a missing `reasoning_content`. The error text is misleading.
The legacy 2026-08-28 dialect probe (variant C) re-ran and reproduced the 400 —
its body used a synthetic `call_probe_1`, which is exactly this case.

## Consequences for opencode

`deepseek-flash` (DeepSeek-V4.1-Flash, current name, release 2026-09-10, already
in our catalog) does **not** contain the substring `v4`, so:

1. `resolveNpm` (`provider.ts:37-43`) gives no override → the model runs through
   `@ai-sdk/openai-compatible` instead of `@ai-sdk/deepseek`.
2. `variants()` (`transform.ts:501`) falls into the shared openai-compatible
   branch → `low/medium/high`; **no `off`** (thinking cannot be disabled from the
   UI) and **no `max`**. `medium` is silently re-mapped by the vendor to `high`.
3. `thinking:{type:"enabled"}` (`transform.ts:1028-1033`) is not injected for it.

`deepseek-v4-flash` (legacy alias, same backend) takes the other path and gets
`off/low/high/max`. Same model, two different control surfaces.

### Live visual oracle (2026-09-12, user screenshot)

The footer rendered while this very analysis was running:

```
Build · DeepSeek V4.1 Flash  DeepSeek ↓0.15 ↑0.6 ↺0.003 [..] · high
```

Identity is exact: the catalog entry for `deepseek-flash` is
`name="DeepSeek V4.1 Flash"`, `cost={input:0.15, output:0.6, cache_read:0.003}`.
So the running model **is** the affected one, and the variant shown is one of the
`low/medium/high` set — a live render of F2, produced by the same binary whose
control surface is wrong.

A fourth code surface carries the same `v4`-substring assumption:

| surface | predicate | effect when the model is `deepseek-flash` |
|---|---|---|
| `dialog-variant.tsx:73` | `modelID.includes("deepseek-v4")` | falls back to the generic `"Select variant"` title and no `off/low/high/max` descriptions |
