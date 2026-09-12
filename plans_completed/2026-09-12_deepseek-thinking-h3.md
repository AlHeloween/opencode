# DeepSeek thinking-mode controls + h3/h2 transport for `deepseek-flash`

state: COMPLETE (T4 open — TUI labels only)
scope: packages/opencode/src/provider (transform.ts, provider.ts) + TUI variant dialog + tests
evidence: experiments/20260912_deepseek-h3/REPORT.md

## Context / goal

User: "https://api-docs.deepseek.com/guides/thinking_mode — глянь что у нас и
что на счёт h3, давай сделаем смок тест и предложи план по реализации."

Two independent results, both measured live [Exact]:

1. **`h3` (HTTP/3) is unavailable for DeepSeek, and h2 gains nothing.** The client
   can do h3 (`cloudflare-quic.com` control pinned `http3` → 200), but
   `api.deepseek.com` answers `HTTP3HandshakeFailed` with no `alt-svc`
   (`server: elb`). Pinned `h2` does return 200, but interleaved h1.1-vs-h2
   streaming on `deepseek-flash` came out within noise (732ms vs 726ms median,
   6/6 each; TTFB 0–1ms both arms). **No transport change is justified.**
2. **The thinking control surface has a name-drift defect, and the documented
   tool-turn 400 is misattributed.** The 400 is caused by a `tool_call` **id the
   server never issued**, not by a missing `reasoning_content`.

The deliverable is (2). `deepseek-flash` (DeepSeek-V4.1-Flash, released
2026-09-10, already in our catalog) lost the `v4` substring that every DeepSeek
predicate was written against, so it silently falls off the DeepSeek code path.

## Prior art (REUSE.BEFORE)

- `docs/reasoning-round-trip-contract.md` — existing vendor matrix. Its DeepSeek
  row attributes the 400 to `reasoning_content`; **T5 corrects that row**.
- `docs/deepseek-thinking-cache.md` — the 2026-08-14 DeepSeek measurements.
- `experiments/20260829T000000Z_kv-cache-parity/2026-08-28_deepseek_direct_dialect_probe.py`
  — the probe whose variant C "proved" the 400. Re-ran 2026-09-12: it reproduced
  the 400 because it uses a **synthetic** `call_probe_1` id.
- `experiments/20260912_deepseek-h3/` — the new probes (9 scripts + REPORT.md),
  rewritten from `experiments/20260908T000000Z_novita-h3-session-probes/`.
- `plans_completed/2026-09-08_novita-h3-transport-headers.md` — the h3 transport
  pattern for any future provider.
- `plans/README.md` — plan structure + the cmd_runner `tail` convention.

## Findings that bind the implementation

All verified in source + live probes. The root cause is **one naming assumption
copied across five sites**; the `v4.1` rename broke it in one place, and the
`deepseek-flash` rename exposed it in all of them.

| # | Surface | Symptom for `deepseek-flash` |
|---|---|---|
| S1 | `provider.ts:37-43` `resolveNpm` (`id.includes("v4")`) | falls back to `@ai-sdk/openai-compatible` instead of `@ai-sdk/deepseek` (used at `:1027`, `:1193`) |
| S2 | `transform.ts:588-589` `@ai-sdk/deepseek` case (`includes("deepseek-v4")`) | returns `{}` — the branch that *already* ships `off/low/high/max` is unreachable |
| S3 | `transform.ts:696-704` openai-compatible effort map (`includes("deepseek-v4")`) | generic `low/medium/high`; no `off`, no `max` |
| S4 | `transform.ts:1028-1033` `thinking` injection (`includes("deepseek-v4")`) | `thinking:{type:"enabled"}` never injected |
| S5 | `dialog-variant.tsx:73` `isDeepSeekV4` (`includes("deepseek-v4")`) | dialog titled "Select variant" instead of "Select thinking mode"; the label map at `:8-29` goes unused |
| S6 | `.opencode/data/cache/models.json` `reasoning_options` (declared contract, not a predicate site) | catalog declares `[toggle, effort: low\|high\|max]` while `variants()` emits `low/medium/high` — `max` is advertised but unreachable, and `medium` is reachable but not advertised |

**REUSE — the target shape already exists on THREE sides.** The catalog itself
already advertises `reasoning_options: [toggle, effort: low|high|max]` for
`deepseek-flash`, i.e. the declared contract matches the engine branch (S2), not
the generic openai-compatible map (S3). So T2 restores the catalog's own
promise; it does not invent a new surface. The UI already declares
`deepseekThinkingVariant = { default, off, low, high, max }`
(`dialog-variant.tsx:8-29`), and the engine branch already emits exactly
`{ off, low, high, max }` with `off: {thinking:{type:"disabled"}}`
(`transform.ts:588-595`). The selected variant reaches the request body verbatim
via `llm.ts:554-571` (`input.model.variants[name]` → `mergeDeep`). **The missing
piece is name matching, not new variants** — do not author a new payload table.

### Live oracle captured by the user (2026-09-12 04:21 UTC)

The running session IS `deepseek-flash` (`ses_f6c4405acffevaivEhhwIxOz0F:deepseek-flash`).
Its prompt footer renders `local.model.variant.current()` (`prompt/index.tsx:1407`):

```
Build · DeepSeek V4.1 Flash  DeepSeek ↓0.15 ↑0.6 ⇢0.003 [👁🧠🔧] · high
```

- The price triple `↓0.15 ↑0.6 0.003` is byte-equal to the catalog entry for
  `deepseek-flash` (`cost: {input: 0.15, output: 0.6, cache_read: 0.003}`).
- `· high` is a member of the `low/medium/high` set from S3. `off` and `max` are
  not in the list, so neither is selectable. The 🧠 badge is on.
- **The defect renders on the very session that diagnosed it.**

### Corrections to earlier drafts of this plan

- **Refuted:** a prior draft claimed `transform.ts`'s `includes("deepseek-v4")`
  fails on `deepseek-v4.1-flash` ("the `.1` breaks the literal"). Checked:
  `"deepseek-v4" in "deepseek/deepseek-v4.1-flash"` → `true`. Both `v4` and
  `deepseek-v4` predicates match the `.1` family. **`deepseek-flash` is the only
  id that matches neither**, and that is the whole defect.
- **Separate, OpenRouter-only:** `OPENROUTER_ROUTING_DEFAULTS` matches the literal
  `"deepseek-v4-flash"`, which does **not** occur in `deepseek/deepseek-v4.1-flash`
  (`.` where the pattern has `-`). Verified: `false`. This is a distinct cosmetic
  routing-default miss, tracked as an open question below — **not** part of T1.

### Naming matrix (checked against `.opencode/data/cache/models.json`)

| id | `includes("v4")` | `includes("deepseek-v4")` | today |
|---|---|---|---|
| `deepseek-flash` (direct, V4.1-Flash) | **no** | **no** | **broken — S1–S5** |
| `deepseek-v4-flash` / `-pro` / `-flash-vision-exp` | yes | yes | OK |
| `deepseek/deepseek-v4.1-flash` (OpenRouter) | yes | yes | OK |

### Catalog vs engine — the declared contract and the code disagree [Exact]

The bundled catalog advertises `deepseek-flash` as
`reasoning_options: [{type:"toggle"}, {type:"effort", values:["low","high","max"]}]`
(verified against `.opencode/data/cache/models.json`), while `variants()` emits only
`low/medium/high` for it (S3). So:

- the UI cannot offer `max` — which the catalog *does* declare, and which the wire
  accepts (probe `T2 effort=max` → 200);
- the UI cannot offer `off` at all, though `reasoning_effort:"none"` and
  `thinking:{type:"disabled"}` both switch thinking off on the wire (probe F1/F4);
- `medium` is offered but the vendor silently maps it to `high` — a menu entry for
  identical behaviour.

This matters for T2: the target set is not an invention, it is **what the catalog
already advertises**. T2 makes `variants()` agree with it.

## Tasks

- [x] T1 `transform.ts` — one name-driven predicate (`isDeepSeekThinkingId`), used at
      all four `deepseek-v4` call sites + the anthropic case. Retired aliases
      (`deepseek-chat|reasoner|r1|v3|ocr`) excluded.
- [x] T2 `transform.ts` — the variant set is derived from the model's own
      `reasoning_options` (`deepSeekEfforts` + `deepSeekThinkingVariants`), so
      `deepseek-flash` gets `off/low/high/max` while `deepseek-v4-pro` keeps
      `off/high/max` and does NOT gain `low`. `minimal`/`medium`/`xhigh` are never
      surfaced (vendor maps them onto low/high); unknown/aliased efforts are filtered.
- [x] T3 `provider.ts` — `resolveNpm` uses the shared predicate; `Model` carries
      `reasoning_options` and `fromModelsDevModel` threads it from the registry.
- [ ] T4 `dialog-variant.tsx:73` — replace `isDeepSeekV4` with the same shared
      predicate so the dialog title and descriptions apply to `deepseek-flash`.
      **Still open** — cosmetic (labels/title only); the engine now emits the keys.
- [x] T5 docs — `reasoning-round-trip-contract.md` (table row + a correction section)
      and `deepseek-thinking-cache.md` now state the misattribution: the tool-turn 400
      fires on a non-server-issued `tool_call` id, not a missing `reasoning_content`.
      Also recorded: `ultra`→400, the ignored Anthropic-format off switch, h3 unavailable.
- [x] T6 tests — new cases: `deepseek-flash` → `off/low/high/max`, `deepseek-v4-pro`
      → `off/high/max`. Legacy aliases still excluded.
- [x] T7 `test/provider/transform.test.ts:134` — stale `KERNEL_MAP` expectation fixed
      to `WORKFLOW` (renamed in `84fd876f13`).

### Result (2026-09-12)

- `bun run typecheck` → exit 0, 0 errors (run `20260912T121509Z_ddc17bf6`).
- `bun test test/provider/transform.test.ts` → **167 pass / 0 fail**
  (run `20260912T121833Z_c0a5a3f0`; baseline 164 pass / 1 fail).
- Live proof `experiments/20260912_deepseek-h3/verify-deepseek-variants.ts`:
  predicate true for `deepseek-flash`/`deepseek-v4-pro`, false for retired aliases;
  flash → `off,low,high,max`; pro → `off,high,max`; `ultra` filtered out.
- One live literal remains by design: the NVIDIA `chat_template_kwargs` site
  (`transform.ts`, different mechanism, documented hang workaround).
- **T4 is the only open item** (TUI predicate/labels; no behaviour change now that
  the engine emits the right keys).

### Ordering constraint (blocking — read before T1/T3)

`variants()` selects its branch by `model.api.npm`, and `resolveNpm` is what sets
`npm`. Applying **T3 without T1** leaves `deepseek-flash` inside the
`@ai-sdk/deepseek` case, whose first line is
`if (!model.api.id.includes("deepseek-v4")) return {}` — the variant list would
become **empty** instead of gaining `off`/`max`. T1 + T3 are one atomic change;
the post-impl oracle must assert `off` AND `max` are present, not merely that the
npm changed (risk R1).

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)
| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|---|
| 1 | `cmd_runner start --cwd packages/opencode -- bun test test/provider/transform.test.ts` then `cmd_runner tail <run_id>` | 164 pass / 1 fail (stale `KERNEL_MAP`) | 164 pass / 1 fail — run `20260912T041206Z_54ba1480` |
| 2 | `cmd_runner start --cwd packages/opencode -- bun test test/provider/provider.test.ts` then tail | pass | (record) |
| 3 | `cmd_runner start --cwd packages/opencode -- bun run typecheck` then tail | exit 0 | (record) |
| 4 | live wire: `cmd_runner start -- bun experiments/20260912_deepseek-h3/probe-thinking-off-switch.mjs` | off-switches work | F1 `effort:none` off, F2 `minimal` on (41 rtok), F3 default on (76 rtok), F4 `disabled` off — run `20260912T041020Z_41f8d254` |

### Post-implementation oracles
| # | Command (cwd) | Pass criteria |
|---|---|---|
| 1 | `bun test test/provider/transform.test.ts` (tail) | ≥165 pass / **0 fail** — new DeepSeek cases pass AND the stale kernel test is fixed |
| 2 | `bun test test/provider/provider.test.ts` (tail) | no new failures |
| 3 | `bun run typecheck` (tail) | exit 0 |
| 4 | TUI render proof (cmd_runner inbox, per G8): open the variant dialog on `deepseek-flash` | title reads "Select thinking mode"; list shows **Off / Low / High / Max** with descriptions; picking `Off` removes the footer variant chip and drops `reasoning_tokens` to 0 next turn |
| 5 | live wire on the SDK route: `probe-thinking-deepseek.mjs` | `effort=max` → 200; tool replay with the server-issued id → 200 (no 400) |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## Risks

| id | trigger | severity | containment / rollback |
|---|---|---|---|
| R1 | applying T3 without T1 empties the variant list (see Ordering constraint) | **high** | one atomic commit for T1+T3; oracle asserts `off` AND `max` exist |
| R2 | routing `deepseek-flash` to `@ai-sdk/deepseek` changes the request body shape and breaks a working path | high | separate commit; single-hunk revert; `probe-thinking-deepseek.mjs` is the oracle |
| R3 | exposing `off` lets a turn silently disable thinking, changing cost/latency | medium | `off` is opt-in per turn only; the default stays the vendor's `high` |
| R4 | users lose `medium`, which they can select today on `deepseek-flash` | low | intended — vendor maps `medium→high`; `high` remains. State it in the commit message |
| R5 | the SDK route may not accept `reasoning_effort` at all | medium | verify with the probe on the SDK path before marking T3 `[x]`; fall back to a body-level option injection |
| R6 | flipping the transport default on a noisy benchmark degrades streaming under load | medium | **no transport change in this plan** (h3 impossible; h2 gain unproven) |

## Rollback

- T1–T4 are separate hunks across three files; each reverts alone.
- T5–T7 are test/doc-only.
- No data migration, no schema change, no config default flipped.

## Out of scope

- Enabling h3 — server-side refusal by DeepSeek, not ours to fix.
- The Anthropic-format `/anthropic` endpoint (noted only: its documented off
  switch does not apply to `/chat/completions`).
- `deepseek-v4-pro` retirement handling (2026-09-14 routing to V4.1).

## Open question (not a task)

`OPENROUTER_ROUTING_DEFAULTS` (`provider.ts:1846-1852`, hand-mirrored at
`prompt/index.tsx:1009-1011`) matches `"deepseek-v4-flash"`, which does not occur
in `deepseek/deepseek-v4.1-flash`, so the StreamLake-fp8 pin silently misses that
slug. Same substring fragility, but a **routing-default decision**, not the
thinking-control defect. Needs its own evidence (which OpenRouter slug is
authoritative for V4.1) before anyone edits it.
