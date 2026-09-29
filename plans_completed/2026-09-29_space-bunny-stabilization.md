<!-- intention: OpenRouter stream flakiness for stealth/space-bunny-alpha -> remove the price-sort routing and lower the reasoning variant to high for that model, so the transient upstream 502/504s are provoked less often -->
# Space Bunny stabilization: routing + reasoning variant

**Status:** COMPLETE — owner approved 2026-09-29T04:13Z («Да, согласен»); changes applied and read back same day. Config-only; all touched files are gitignored (`bin/`, `.opencode/data/`), so no product commit — this plan is the record.

## Prior art (measured earlier this session)

- ✓ 502 `provider_unavailable` / 504 `idle-timeout` SSE chunks from OpenRouter upstream `Stealth`, `.opencode/data/gateway/per-response/2026-09-29T03-59-26-149Z-3ca76490-…-attempt1.raw.txt`.
- ✓ Retry classification bug fixed separately: commit `f2589a1b16`, plan `plans_completed/2026-09-29_retry-stream-provider-error.md`.
- ✓ Global routing `{"sort":"price","allow_fallbacks":true}` shipped to EVERY OpenRouter request — source: `bin/opencode.jsonc` → `provider.openrouter.options.routing` (read this session).
- ✓ variant `"max"` for the model: `.opencode/data/state/model.json` (`variant`, `agentVariant`) and session settings `.opencode/data/sessions/ses_f14ad6393ffe10c7GOy3KKh4.jsonc` (`agent.<name>.variant` ×8, `variant`, `agentVariant`). Resolution priority: session agentVariant → session agent[name].variant → session variant → worktree model.json agentVariant → worktree variant (`src/session/session-settings.ts:261-313`).

## Change

- [x] ✓ TASK-1 `bin/opencode.jsonc`: `"sort": "price"` dropped from `provider.openrouter.options.routing` (`allow_fallbacks: true` kept) — read back: lines 6-8 now `"routing": { "allow_fallbacks": true }`.
- [x] ✓ TASK-2 `.opencode/data/state/model.json`: space-bunny-alpha `max → high` in `variant` and `agentVariant` — grep `space-bunny-alpha": "max"` → No matches.
- [x] ✓ TASK-3 session `ses_f14ad639…jsonc`: space-bunny `max → high` in 8 `agent.<name>.variant`, `variant`, `agentVariant` (11 replacements) — grep `space-bunny-alpha": "max"` → No matches; the change is live for this session.
- [x] ✓ TASK-4 read artifacts back (see above).

## Smoke Tests

- Baseline before edit (recorded): `bin/opencode.jsonc` contains `"sort": "price"`; model.json + session carry `"max"` for `openrouter/stealth/space-bunny-alpha`.
- Post-change oracle: ✓ CONFIRMED (read-back): no `"sort": "price"` in bin config; `grep 'space-bunny-alpha": "max"'` → No matches in state and session. Falsifier (both strings remaining) did not fire.
- Behavioural (observation, not a gate here): the next live request to space-bunny should show `reasoning.effort: "high"` and a `provider` block without `sort` — check `gateway/raw-wire/*-attempt1.json`.

## Out of scope

- Protocol pinning for deepseek (`h3` fails `tls_error`, probed once per 30 min) — separate owner decision.
- `parseStreamError` OR plain-object `{error:{code}}` shape — separate residual from the retry plan.
