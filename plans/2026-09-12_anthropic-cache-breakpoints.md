# Anthropic: cache-breakpoint placement + thinking-variant payloads

state: DRAFT
scope: `packages/opencode/src/provider/transform.ts`, `packages/opencode/src/session/llm.ts` + tests
evidence: `experiments/20260912_anthropic-cache/REPORT.md`

## Context / goal

User: «мне кажется что в opencode мы могли бы работать в разы эффективнее» —
after the decision to leave subscription auth alone, the remaining lever on
Anthropic cost is not paying twice for the same bytes.

opencode's load shape is close to ideal for prompt caching: a ~15k-token static
prefix (tools + kernel + rules + skills + AGENTS.md) and a thin moving tail.
The probes show we are anchoring the wrong half of it, and that a second,
unrelated defect makes every `high`/`max` thinking variant invalid on almost
the whole Anthropic catalog.

Two independent deliverables, both narrow:

1. **Cache breakpoint placement** — 55.1% of the static prefix is behind no
   static breakpoint (R2).
2. **Thinking variants** — 13 of 14 catalog models emit an invalid or removed
   thinking payload (R5, R6).

## Prior art (REUSE.BEFORE)

- `plans_completed/2026-09-07_cache-markers-anthropic-only.md` — the change that
  made markers anthropic-only. This plan does not revisit that decision; it
  fixes the placement the same commit left in place.
- `plans_completed/2026-08-10-cache-friendly-system-prompt.md`,
  `2026-08-14-cache-alignment.md`, `2026-08-14-cache-miss-tail.md` — the slot
  model in `system-compose.ts` (one system message per cache tier). The layout
  change below is what makes those slots actually payable.
- `packages/opencode/test/provider/transform.test.ts:2311` — existing
  `cache control on gateway` describe. New assertions extend it, no new file.
- `experiments/20260912_anthropic-cache/` — the probes this plan is built on.
- `docs/reasoning-round-trip-contract.md` — the "never assume vendor reasoning
  behaviour, probe it" rule that T1 follows.

## Findings that bind the implementation

Tags map to `experiments/20260912_anthropic-cache/REPORT.md`.

| # | Finding | Status | Code surface |
|---|---------|--------|--------------|
| R1 | All 4 SDK breakpoints are consumed; no room for a fifth anywhere | Exact | `transform.ts:308-333` |
| R2 | 55.1% of the static prefix (33,890 chars: rules, skills, env, AGENTS.md) is anchored by no static breakpoint | Exact | `transform.ts:308` `slice(0,2)` |
| R3 | Both tail markers land in the **same** wire message — Anthropic merges `tool_result` with the next user message, so the 2nd tail breakpoint is nearly redundant | Exact | `transform.ts:309` `slice(-2)` |
| R4 | No `ttl` is ever set → every breakpoint is the 5-minute tier | Exact | `transform.ts:321-325` |
| R5 | `budget_tokens` emitted for 4 models whose catalog entry offers only `effort` | Exact (emit side) | `transform.ts:491-499, 789-802` |
| R6 | Every emitted `budgetTokens` is `>= limit.output` — invalid even where the parameter is supported (10 of 14 models) | Exact | `transform.ts:793, 799` |
| R7 | `display:"summarized"` only for opus-4.7; the rest default to `omitted` (no visible reasoning) | Exact | `transform.ts:779-781` |
| R8 | The catalog already carries `reasoning_options`; `variants()` ignores it and substring-matches ids | Exact | `provider-sync.ts:35`, `transform.ts:491` |
| R9 | Message-level `cacheControl` is honoured by the SDK for system/user/assistant/tool_result — the mechanism is sound, only placement is wrong | Exact | `@ai-sdk/anthropic@4.0.7` |
| R10 | A 5th breakpoint is dropped with a warning opencode never reads | Exact | SDK `CacheControlValidator` |
| R11 | The static `anthropic-beta` header is merged, not clobbered, by SDK betas | Exact | `provider.ts:167` |
| R12 | The `cache marker check` diagnostic reads `providerOptions.openaiCompatible.cache_control` — a dialect removed 2026-09-07; always logs `false` for Anthropic | Exact | `llm.ts:964-974` |

Unproven and explicitly **not** assumed by this plan: that layout C raises
`cache_read_input_tokens` on the wire (probe 10), that `ttl:"1h"` works and
which beta it needs (probe 11), that today's payload 400s (probe 12).

## Tasks

### T1 — `variants()` derives from the catalog, not from substrings

Claim: for every model in `provider/models/anthropic.json`, the emitted
thinking payload is accepted by the API.

- Replace `anthropicAdaptiveEfforts()` substring matching with a read of the
  model's own `reasoning_options` (`effort` → adaptive + effort list,
  `budget_tokens` only when the catalog lists it).
- `Model` currently drops `reasoning_options` during parse — carry it through
  `provider.ts`'s model assembly (it is already in the JSON and in
  `provider-sync.ts:35`).
- When a budget path is genuinely supported, clamp:
  `budgetTokens = min(catalogMax, floor(limit.output * 0.8))`, never
  `context/2`.
- Attach `display:"summarized"` to every adaptive payload, not only opus-4.7.
- Fallback when a model carries no `reasoning_options`: adaptive +
  `low/medium/high`, never a budget.

Oracle: `03_variants_matrix.mts` exits 0 with zero flagged models; probe 12
returns `200 OK` on the `proposed` arm for Opus 5 / 4.8 / Fable.

### T2 — breakpoint placement: anchor the deep end of the static prefix

Claim: after the change, 100% of the static prefix sits behind a breakpoint
that survives a tail reset, with the same 4-breakpoint budget.

- `transform.ts:308`: `msgs.filter(system).slice(0, 2)` → `.slice(-2)`.
  That alone moves both static anchors from `[universalEnv, kernel]` to
  `[last path slot, mutable tail]`, which covers everything before them.
- Keep the 2 tail markers for now (same count, no behavioural risk). Dropping
  to one (layout B, freeing a breakpoint) is gated on probe 10 — see T5.
- Add a hard guard: `applyCaching` must never mark more than 4 messages;
  assert in code, not in a comment (R1/R10).

Oracle: `01_wire_shape.mts` reports `left OUTSIDE any static breakpoint: 0`;
`04_sdk_contract.mts` still PASS; unit test below.

### T3 — make the diagnostic tell the truth

Claim: the `cache marker check` log reflects what is actually on the wire.

- `llm.ts:964-974`: read `providerOptions.anthropic.cacheControl`, count marked
  messages, and log the count + roles. Delete the `openaiCompatible` lookup.
- Surface the SDK's breakpoint warning: if a `doStream`/`doGenerate` result
  carries a `cacheControl breakpoint limit` warning, `log.warn("bug: …")` per
  the silent-catch rule.

Oracle: run a session against any anthropic-dialect model and read the log line;
it must report 4 marked messages, not `hasCacheControl: false`.

### T4 — 1h TTL as an opt-in (blocked on probe 11)

Claim: for sessions with >5 min gaps, `ttl:"1h"` lowers total cost.

- Config surface: `provider.anthropic.options.cacheTtl: "5m" | "1h"`, default
  `"5m"`. The SDK already accepts `ttl` in `cacheControl`
  (`anthropicProviderOptions`, dist:1032) — no wire plumbing needed.
- Requires the beta header; the name is **not** established. Probe 11 prints it.
- Do **not** default to `1h`: writes cost 2x, and the win only exists for gappy
  sessions. Ship the knob, measure, then decide the default.

Oracle: probe 11 `--phase=read` shows `cacheRead > 0` for the 1h arm and `0`
for the 5m arm after a >5 min gap.

### T5 — decide the tail-marker count (blocked on probe 10)

Claim: R3 means the second tail marker buys nothing, so it can be freed.

- Run probe 10. If arm B (1 tail marker) matches arm C on warm-turn
  `cacheRead`, drop to one tail marker and leave one breakpoint spare.
- If it does not match, keep two and record why in this plan.

Oracle: probe 10 output pasted into `REPORT.md`.

## Smoke Tests

Baseline (before any edit) — all four must run green **today**, on this machine,
without a key:

```bash
bun run experiments/20260912_anthropic-cache/01_wire_shape.mts
bun run experiments/20260912_anthropic-cache/02_breakpoint_ab.mts
bun run experiments/20260912_anthropic-cache/03_variants_matrix.mts
bun run experiments/20260912_anthropic-cache/04_sdk_contract.mts
```

Recorded baseline (2026-09-12): `01` → 4 breakpoints, 55.1% of the static
prefix unanchored. `03` → exit 1, 13/14 models flagged. `04` → 5/5 PASS.

Post-change oracles:

| Task | Oracle | Expected delta |
|------|--------|----------------|
| T1 | `03_variants_matrix.mts` | exit 0, `0/14 models flagged` |
| T1 | `12_live_variants_400.mts` | `proposed` arm 200 OK on Opus 5 / 4.8 / Fable |
| T2 | `01_wire_shape.mts` | `left OUTSIDE any static breakpoint: 0 chars (0.0%)`, still 4 breakpoints |
| T2 | `04_sdk_contract.mts` | still 5/5 PASS (guards the SDK assumptions the layout rests on) |
| T2 | `bun test test/provider/transform.test.ts` (from `packages/opencode`) | new cases green, existing `cache control on gateway` cases unchanged |
| T3 | live session log | `cache marker check` reports 4 marked messages |
| T4 | `11_live_ttl_1h.mts --phase=read` | 1h arm `cacheRead > 0`, 5m arm `0` |
| T5 | `10_live_cache_ab.mts` | warm-turn `cacheRead` B vs C decides the tail count |

New unit tests in `packages/opencode/test/provider/transform.test.ts`
(extending the existing `cache control on gateway` describe, per REUSE):

1. with 7 system messages, the marked ones are indices 5 and 6 — not 0 and 1;
2. `applyCaching` never marks more than 4 messages, whatever the input length;
3. for every model in the real catalog, `variants()` emits no `budgetTokens`
   unless `reasoning_options` lists `budget_tokens`, and never
   `budgetTokens >= limit.output` (table-driven over the JSON — this is the
   regression that R6 would otherwise re-introduce silently);
4. every adaptive payload carries `display:"summarized"`.

Full suite before push, from `packages/opencode`: `bun test`, plus
`bun typecheck`.

## Risks

| # | Risk | Containment |
|---|------|-------------|
| 1 | T2 changes the cached prefix shape → one cold turn for every live session on upgrade | One-time, self-healing on the next turn. Land T2 and T1 together so there is a single reset. |
| 2 | `slice(-2)` marks a *mutable* system slot; an agent switch invalidates that breakpoint | The slot below it (last path slot) still anchors the whole static prefix — that is precisely the arrangement the layout buys. Covered by unit test 1. |
| 3 | T1 changes visible TUI variants (`high`/`max` → `low..max`) for some models | Expected and desired; `dialog-variant.tsx` renders whatever `variants()` returns. Note in `_progress_log.md`. |
| 4 | The catalog's `reasoning_options` is wrong for some model | Probe 12 is the falsifier; a mismatch there means the catalog entry is the bug, not `variants()`. |
| 5 | An `@ai-sdk/anthropic` bump silently changes marker semantics | `04_sdk_contract.mts` exits non-zero — run it after every bump. |
| 6 | KV-cache continuity | None of this touches the system prompt bytes; only `providerOptions` markers. No `[KV-CACHE RISK]`. |

## Rollback

Each task is one commit, independently revertible. T2 is a one-line change in
`applyCaching`; T1 is contained in `variants()` + the `reasoning_options`
carry-through; T3 is a log line. No migrations, no persisted state.

## Out of scope

- Anthropic OAuth / subscription auth — implemented by `plans_completed/2026-09-12_anthropic-oauth-claude-pro-max.md`; it remains independent of cache-breakpoint placement.
- Claude on Bedrock (`providerOptions.bedrock.cachePoint` is still unset) —
  separate plan if that route is ever used.
- `@ai-sdk/gateway` and openai-compatible routers — deliberately marker-free
  since 2026-09-07.
