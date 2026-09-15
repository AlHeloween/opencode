# Hugging Face live model sync (provider-sync source)

<!-- intention: HF models served only from the stale models.dev snapshot (77 ids, no GLM-5.3-Flash-BF16) -> HF rebuilt from router.huggingface.co/v1/models at build/refresh time (138 live ids + retained curated, curated metadata preserved, quantisation variants inheritable) -->

Status: COMPLETED (2026-09-15)
Created: 2026-09-15
Owner: build_mode session
Closed: 2026-09-15 — all gates passed (see Results below)

## Context / goal

User request: "мы дергаем списки моделей из openrouter и novita.ai, но не дергаем из huggingface. Можем тоже сделать?" — plus "интересны обновления, там часто много новых бесплатных моделей" and "я хочу тестануть GLM-5.3-Flash-16bit" (`zai-org/GLM-5.3-Flash-BF16`).

Current state [Exact]:
- `packages/opencode/src/provider/provider-sync.ts` / `PROVIDER_SOURCES` has `novita-ai`, `openrouter` (live rebuild) and `streamlake-vanchin` (static). Hugging Face is NOT a source → its models come only from the models.dev snapshot: 77 ids, stale.
- Live router `https://router.huggingface.co/v1/models` serves 138 ids (probed 2026-09-15, anonymous 200; with HF_TOKEN identical id set). Diff: 67 live-only (incl. `zai-org/GLM-5.3-Flash-BF16`, CohereLabs, Qwen2.5/3, Nemotron), 6 snapshot-only (Qwen3-Embedding-4B/8B, Qwen3-Next-80B-A3B-Thinking, MiMo-V2-Flash, Kimi-K2-Thinking, GLM-4.5).
- The router discloses LESS metadata than the curated registry: no `reasoning`, no `reasoning_options`, no `interleaved`, no `description`, no output limit, no `knowledge`/`family`. A full rebuild (novita-style) would regress all curated fields → merge mode required.

## Prior art (REUSE.BEFORE)

- Canonical sync source: `sst/models.dev` @ `dev` — `packages/core/src/sync/providers/huggingface.ts` (fetched 2026-09-15). Adopt its aggregation rule verbatim:
  - live providers only; `routed` = highest `throughput`;
  - cost = routed's `pricing` if present, else fastest provider WITH pricing; round to 6 decimals; both input+output required;
  - context = `routed.context_length ?? max(contexts)`;
  - tools / structured_output = union across live providers.
- models.dev keeps curated fields (`existing?.cost ?? aggregate.cost` etc.), `deleteMissing: false` (retains absent local entries), and inherits from a `base_model` for variants. We mirror these three semantics in `mergeModels`.
- HF docs (huggingface.co/docs/inference-providers): default routing = `:fastest` (highest throughput) → routed-provider pricing is "the route a request would actually take".
- Local precedents: Novita mapper ("include everything the endpoint serves"; missing limits → 0, truthful), OpenRouter mapper (per-token→per-million conversion note — HF is ALREADY $/M, no conversion), `deriveParameters`, `toISODate`, `KNOWN_MODALITIES`.

Deliberate divergence from models.dev [documented]:
1. models.dev skips new ids without a priced provider or canonical base; we include them (user's BF16 has no pricing) with cost omitted and variant inheritance filling capability metadata.
2. models.dev leaves existing entries untouched; we refresh live-grounded fields (cost, context, modalities, tools/structured) while curated-only fields survive. Rationale: this file's stated contract — configured sources are rebuilt from their live source; freshness is the point ("интересны обновления").

## Implementation steps

- [x] 1. `provider-sync.ts`: HF section — types, `mapHuggingFaceModel` (fastest-route collapse; rounded $/M; no cost when unpriced), `HF_VARIANT_SUFFIX` + `inheritHuggingFaceVariant`.
- [x] 2. `provider-sync.ts`: `mergeHuggingFaceModels(upstream, live)` — curated survives, live wins (cost/context/modalities/tools), upstream-only retained, new ids added, variants inherit base (cost NOT inherited).
- [x] 3. `provider-sync.ts`: `mergeModels` hook wired in `applyProviderOverrides`; `huggingface` source registered (endpoint, HF_TOKEN optional, shell).
- [x] 4. Tests: 19 pass / 0 fail (13 new) [Exact].
- [x] 5. Refresh: `bun run script/provider-sync.ts` exit 0 → huggingface 144 models; BF16 inherited (reasoning/options/1M ctx, no cost); curated kept; live prices landed (DeepSeek-V3 0.32/0.89) [Exact].
- [x] 6. Build: `pwsh _build.ps1` exit 0 (cmd_runner `20260915T124007Z_175a0c9d`); `dist/bin/opencode.exe models huggingface` lists `huggingface/zai-org/GLM-5.3-Flash-BF16` (144 ids) [Exact].
- [x] 7. Router smoke: `zai-org/GLM-5.3-Flash-BF16` → HTTP 200, `x-inference-provider: zai-org`, `finish=stop`, content `OK`; opencode E2E run → session completed with reasoning + text `OK` [Exact via DB].
- [x] 8. G9: progress log + plans README + docs section; plan moved to `plans_completed/`. Finding filed: `opencode run` stdout prints only the session header (no response text) — reproduced on HF BF16 AND untouched `deepseek/deepseek-flash` (4 runs), responses complete in DB; unrelated to this change, needs its own investigation.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)
| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/provider/provider-sync.test.ts` (packages/opencode) | pass (6 tests) | pass — 6 pass / 0 fail, 14 expect() calls, 1.55s [Exact] |

### Post-implementation oracles
| # | Command (cwd) | Pass criteria | Actual [Exact] |
|---|---------------|---------------|----------------|
| 1 | `bun test test/provider/provider-sync.test.ts` (packages/opencode) | all pass (baseline + new) | 19 pass / 0 fail, 53 expect() calls |
| 2 | `bun typecheck` (packages/opencode) | exit 0 | exit 0 (cmd_runner `20260915T123821Z_17fb814a`) |
| 3 | `bun run script/provider-sync.ts` (packages/opencode) | exit 0; BF16 present with inherited metadata; count ≥ 138 | exit 0; 144 models; BF16: reasoning + effort low/high/max + ctx 1M/output 131072 inherited, cost omitted |
| 4 | `pwsh _build.ps1` (repo root, cmd_runner) | build exit 0; dist artifacts refreshed | exit 0 (`20260915T124007Z_175a0c9d`) |
| 5 | `dist/bin/opencode.exe models huggingface` | output contains `huggingface/zai-org/GLM-5.3-Flash-BF16` | present (144 ids listed) |
| 6 | minimal router chat completion for BF16 (python) | HTTP 200 with content | 200 via `zai-org`, content `OK`; plus opencode E2E run session completed (`ses_f5ae8eb68ffeRrtOMHVabqgr0z`) |

### Gate
- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]

## Risks / notes
- Merge keeps upstream-only ids forever (models.dev `deleteMissing: false` semantics; Kimi-K2-Thinking is still routable via the single-model endpoint even though absent from the list).
- Live-wins pricing changes some existing entries (e.g. GLM-4.7-Flash 0/0 → live priced). This is intended freshness; curated-only fields are unaffected.
- Variant inheritance is naming-based (same family, quantisation suffix) — low risk, documented in code.
- Finding (unrelated, 2026-09-15): `opencode run` prints only the session header; response text missing from stdout — reproduced on HF BF16 and `deepseek/deepseek-flash`; responses complete correctly (DB). Needs its own investigation.
- `bun test`/`typecheck`/build run from `packages/opencode` / repo root per README; heavy build via cmd_runner.
