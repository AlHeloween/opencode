# Transport options leak into the request body — zen/go 400 unknown_parameter

<!-- intention: from_state = every request to opencode-go/glm-5.3-flash carries `protocol: "h2"` (and for openrouter/novita models `streaming: true`) inside the JSON BODY, so strict upstreams answer 400 [unknown_parameter] and the user sees an error before the auto-heal retry; to_state = transport knobs are stripped at the single packaging point, the body never carries them, the transport still reads them from model.options -->

## Diagnosis (measured 2026-10-12)

- User-visible: `unknown parameter` errors on requests to glm-5.3-flash (session ses_ecf8c7b11ffeFJX5RqxJPQSql9, 14:10:41).
- Wire evidence: payload dump `log/1791814241594_payload_glm-5.3-flash_..._141041.594.md` — body carries `"protocol": "h2"` between `prompt_cache_key` and `reasoning_effort`; answer 400 `[unknown_parameter] invalid request body: json: unknown field "protocol"`, `x-opencode-endpoint-id: perplexity-glm5.3flash` (strict Go parser, DisallowUnknownFields).
- Source chain:
  1. TUI protocol dialog (worktree scope) wrote the transport rung into `D:\zPython\opencode\config.json` → `provider.opencode-go.models["glm-5.3-flash"].options.protocol = "h2"` (7 models carry it: deepseek/deepseek-flash, opencode/*5, opencode-go/mimo-v2.6-flash + glm-5.3-flash).
  2. `getModel` merges config model options over the catalog (`provider.ts:1394`) → `input.model.options = {protocol: "h2"}`.
  3. `LLM.run` merges `input.model.options` into call options (`llm.ts:622`); the merged record is 162 chars WITH protocol (arithmetic vs the logged `request shape` hash/length, both attempts identical).
  4. `ProviderTransform.providerOptions` wraps it under `opencode-go`; the wire-params gate strips only LEARNED fields (repetition_penalty, thinking) — `protocol` survives.
  5. `@ai-sdk/openai-compatible` v3.0.52 spreads UNKNOWN providerOptions keys into the body (`dist/index.js:592-601`).
  6. Strict upstream 400s. Auto-heal: `message-v2.ts:2092-2109` records the field as a learned fact (`provider_fact` row `opencode-go/glm-5.3-flash` = `["thinking","protocol"]`, 14:10:41.598) and retries — so every NEW unknown field costs one visible error.
- Transport itself is CORRECT and stays: the gateway fetch reads `model.options.protocol`/`.streaming` directly (`provider.ts:1693-1694`); the user confirmed «h2 работает как часики».

## Fix

One predicate at the single packaging point (`ProviderTransform.providerOptions`): transport controls (`protocol`, `streaming`) are OUR knobs, never wire parameters — strip them deterministically, not learned-by-rejection. Plus: pin today's measured `thinking` rung into the compiled seed (fresh installs re-learn it otherwise).

## Tasks

- [x] S1: red test first — transport keys survive packaging today (`test/provider/wire-params.test.ts`), run proves FAIL on the missing behavior.
  ✓ run 20261012T144708Z_f8e84739: 4 pass / 2 fail — exactly the two new tests, `Received: "h2"`.
- [x] S2: strip `protocol`/`streaming` in `providerOptions` (transform.ts) + seed `thinking` for opencode-go/glm-5.3-flash (wire-params.ts); tests green.
  ✓ run 20261012T145055Z_f6c47df3: 191 pass / 0 fail across wire-params + learned-facts + transform + transform-anthropic-adaptive.
- [x] S3: typecheck (packages/opencode) + `_build.ps1` (mandatory) + commit naming this plan.
  ✓ typecheck run 20261012T145119Z_64b7b8f6 exit 0; `_build.ps1` "[OK] Build complete - artifacts in dist/" (dist/bin/opencode.exe staged).

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/provider/wire-params.test.ts` — before S2: new tests FAIL (protocol/streaming present); after S2: ALL PASS.
- `bun typecheck` from packages/opencode — no new errors.
- `_build.ps1` from repo root — candidate builds into dist/ (never bin/).

## Risks

- A provider that legitimately accepts a body field named `protocol`/`streaming` would lose it — none known: the standard wire field is `stream` (set by the SDK itself), and `streaming`/`protocol` are opencode-internal knob names (gateway fetch + transport chain). The strip is global by design; the learned-facts gate stays for everything else.
