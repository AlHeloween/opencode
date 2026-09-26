# OpenRouter reasoning variants — the data was right, the menu was not (2026-09-26)

Owner: «мы вычитываем модели из openrouter почему твои настройки reasoning не отображаются?
Или их нет?» — followed by «при сборке работает алгоритм, который вычитывает все модели из
openrouter у разных моделями свои списки. Но для твоей модели, алгоритм не правильно отработал».

**Answer: the settings were there, and the build algorithm was right. They were dropped afterwards,
by a whitelist of model NAME substrings.**

## The reported symptom

`stealth/space-bunny-alpha` renders no `±` glyph and ctrl+t does nothing, although the model is
marked reasoning.

## The two ends, measured separately

### End 1 — the build (`mapOpenRouterModel`, `provider-sync.ts:222`)

It does not COMPUTE efforts; it copies `raw.reasoning.supported_efforts` from `GET /v1/models`.
`probe-catalog-source.mjs` compared the raw API object against the committed catalog on five
models: **`agree: YES` on all five**, this one included.

```json
// GET https://openrouter.ai/api/v1/models
"reasoning": { "mandatory": true,
               "supported_efforts": ["max","xhigh","high","medium","low"],
               "default_effort": "max" }
// src/provider/models/openrouter.json after the build
[ "max", "xhigh", "high", "medium", "low" ]        ← identical
```

The per-model lists are real, and they differ because the models differ: `solar-mini4` declares
seven values including `none` (`mandatory: false`), `glm-5.3-prime` declares three
(`max|high|low`), this one declares five and NO `none` because it is `mandatory: true`. Across the
catalog: 111 models are `mandatory`, 186 carry `supported_efforts`.

**The owner's second hypothesis (the build algorithm misfired) is refuted by this measurement.**

### End 2 — the wire (`probe-effort.mjs`, `stealth/space-bunny-alpha`)

| arm | status | note |
|---|---|---|
| (no field) | 200 | |
| `none` | **400** | `Reasoning is mandatory for this endpoint and cannot be disabled.` |
| `minimal` | 200 | |
| `low` / `medium` / `high` / `xhigh` | 200 | |
| `max` | 200 | |
| `ultra` | **400** | `reasoning.effort: Invalid option: expected one of "max"\|"xhigh"\|"high"\|"medium"\|"low"\|"minimal"\|"none"` |

`ultra` is the control that makes this decisive: the gateway VALIDATES the field and names its own
vocabulary in the rejection, so the 200s are not a field being silently dropped.

**Caveat, recorded because it looks like a contradiction:** `reasoning_tokens` came back **0 for
every accepted arm**, so this probe cannot prove that a deeper effort spends more thinking. The
400 is the only trustworthy signal about what the gateway validates. Claiming "max thinks deeper"
would be vendor's claim, not a measured one.

## The defect

`transform.ts:699-701` decided the menu by NAME:

```ts
if (!model.id.includes("gpt") && !model.id.includes("gemini-3") && !model.id.includes("claude")) return {}
return Object.fromEntries(OPENAI_EFFORTS.map((effort) => [effort, { reasoning: { effort } }]))
```

Measured over the whole catalog: **122 of the 326** reasoning models got a control surface; **204
got none**, including every model whose name is not one of those three substrings.

## The fix

Read the effort set the gateway DECLARED, filtered by the vocabulary it demonstrably accepts:

- `OPENROUTER_EFFORTS = [...OPENAI_EFFORTS, "max"]` — `max` is absent from `OPENAI_EFFORTS`
  entirely, which is why this model's top grade could not have appeared even on the whitelist path.
- declared ∩ `OPENROUTER_EFFORTS`; a value the gateway would 400 on is never offered.
- a model that declares nothing keeps the previous full set — silence must not read as «no knob»,
  which was the symptom.

**After: 262 of 326 have a control surface (was 122). 64 remain silent, and not because of this
branch** — they are caught earlier by the FAMILY list (`qwen`, `kimi`, `grok` other than
grok-3-mini, `big-pickle`, the retired DeepSeek aliases) at `transform.ts:613-639`, which runs
before the `switch`.

**Owner ruling, 2026-09-26: those 64 are correct as they are.** «У этих все окей просто мы вычитывали
обновления openrouter, huggingface и novita чтобы быть в тренде» — the families arrive from the
provider sync, and a per-model effort menu is not owed to them. So the FAMILY list is a decision,
not an oversight, and this is NOT an open residual. Read it as a rule, not a bug list.

Note on the scope of what was verified: the sync was measured for **OpenRouter only**
(`agree: YES` on five models, this work). The HuggingFace and Novita sync paths were not examined
here — the owner's statement covers all three, the evidence covers one.

## Oracle

- `test/provider/transform.test.ts` — 170 pass / 0 fail / 348 expect.
  - the real catalog entry is read and the menu is asserted to EQUAL the declared list — so a
    break at either end (code or a future sync) is visible;
  - a declared value outside the gateway vocabulary is dropped, not offered;
  - a declared set that filters to nothing falls back instead of muting the model;
  - the old test `returns empty object for non-qualifying models` ENCODED the defect and was
    rewritten, not deleted: silence is no longer an empty menu.
- `test/tui/` — 179 pass / 0 fail. `test/provider/` — 516 pass, 1 timeout, and with
  `--timeout 60000` the file is 79/79: `test/provider/provider.test.ts` needs a FILE-level
  `setDefaultTimeout` (AGENTS already requires it for heavy files) — a real debt, not recorded
  here as a fix.
- `bun typecheck` — exit 0.

## Instruments

- `probe.mjs` v1 **transcribed** the `variants()` predicate — a second copy of the rule, which
  therefore agreed with whatever the rule was, bug included. Rewritten to import the real
  `ProviderTransform.variants`. A probe that re-implements what it measures measures itself.
- `grep "space-bunny" --include *.json` matched 176 hits, 175 of them this session's own wire logs
  under `.opencode/data/gateway/`. An extension filter with no `include` is not a filter.
