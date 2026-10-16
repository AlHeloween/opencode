<!-- intention: aicall calling a router as free -> aicall never silently calls a router -->
<!-- goal_sv: Keywords: aicall-router 0.35, cost-unknown 0.25, chain-fallback 0.20, paid-refusal 0.12, free-first 0.08; Semantic dominant: Stop aicall from ever billing a router as free. -->

# t72 — `aicall` must not call a router «free»

## Goal

`aicall` with no model (or a router id) must never silently run a paid
router while printing «cost: free». A router bills the ROUTED model, so its
price is UNKNOWN, not free. Owner rule: never a paid «auto» router.

## Ground (G1, read 2026-10-16)

- Cost line: `packages/opencode/src/tool/aicall.ts:20-30` —
  `paid = cost.input>0 || cost.output>0`, else prints `cost: free`.
  `requestEnvelope(model, userText)` is pure and unit-tested in
  `packages/opencode/test/tool/aicall.test.ts`.
- Omitted-model branch: `aicall.ts:105-136` — free 0/0 sorted by
  `limit.context` desc, then `big-pickle`, then `provider.defaultModel()`.
  The catalog lists `openrouter/auto-beta` (Auto Router Beta,
  `packages/opencode/src/provider/models/openrouter.json`) at
  `cost 0/0`, `limit.context 2000000` — the LARGEST context among free
  entries — so `free[0]` IS the router. The task text says «fell back to
  `provider.defaultModel()`»; the mechanism on current code is the
  free-select picking the router first (defaultModel at
  `packages/opencode/src/provider/provider.ts:1895-1937` is the second
  way to land on it: `cfg.model` → `model.json:recent[]` → first-provider
  `sort()[0]` → free-scan; `sort()` prefers free + `big-pickle`, so a host
  without `big-pickle` in its connected set can still sort a router first
  by `id desc`). Owner config layers NOT changed — report only.
- Explicit branch: `aicall.ts:97-104` — `params.model ?? defaultModel.modelID`
  with no router check.
- Router marking: the catalog has NO `router` flag. Routers are marked by
  NAME (`Auto Router`, `Free Models Router`, `Pareto Code Router`,
  `Jev Router`) or by known router ids (`openrouter/auto`,
  `openrouter/auto-beta`, `openrouter/free`, `openrouter/fusion`,
  `openrouter/pareto-code`, `nvidia/switchyard`). Detection is therefore a
  helper over `providerID + id + name`, not a catalog field.
- Chain (t68): `resolveChainAgentModel(agent, sessionID, health, {chain})`
  in `packages/opencode/src/session/session-settings.ts:291-306` reads ONE
  session-layer key + `firstUp(chain, health)` (`chain.ts:106-112`).
  Store: `loadChain(scope, agent)` (`store.ts:44-63`), health:
  `chainHealthState()` (`health-registry.ts:21-23`). Tool ctx carries both:
  `ctx.sessionID`, `ctx.agent` (`tool.ts:16-27`); canonicalize via
  `canonicalIdentity` (`mode-identity.ts:21-23`).
- Incident: `docs/robot-protocol-log.md:69` (2026-10-16, t70, 6 calls, real
  spend UNKNOWN).

## Tasks

- [x] S1 — RED tests in `packages/opencode/test/tool/aicall.test.ts`:
  RED 20261016T093538Z_ceac04c1 (exit 1, 2 pass / 2 fail, router printed
  `cost: free`); GREEN 20261016T094215Z_682b8430 (exit 0, 4 pass / 0 fail).
  `isRouterModel` true for `openrouter/auto`, `openrouter/auto-beta`,
  name-contains-`Router`, explicit `openrouter/free`, false for a real free
  model (`z-ai/glm-5.2:free`) and a paid model; `requestEnvelope` prints
  `cost: UNKNOWN (router)` for a router and never `cost: free`.
  <!-- sv: Keywords: router-detect 0.40, envelope-unknown 0.30, red-test 0.20, no-free-router 0.10; Semantic dominant: Prove a router never prints free. -->
- [x] S2 — Implemented in `packages/opencode/src/tool/aicall.ts` (+ `aicall.txt`):
  `isRouterModel` export; envelope `UNKNOWN (router)`; new optional
  `allow_paid` param; explicit router without `allow_paid:true` → REFUSED;
  omitted model → session chain first UP (`loadChain(session:ctx.sessionID)`
  + `resolveChainAgentModel` + `chainHealthState()`), chain model still
  router-checked; no chain / no UP → REFUSED naming the missing model
  (the old silent free-scan is REMOVED, so no fallback can land on a router).
  Typecheck 20261016T094321Z_a89b4f49 exit 0.
  <!-- sv: Keywords: allow-paid 0.35, chain-first 0.30, refuse-router 0.20, envelope-fix 0.15; Semantic dominant: Refuse routers unless explicitly allowed. -->
- [x] S3 — Typecheck exit 0, test GREEN via `cmd_runner`, `_build.ps1` exit 0
  (smoke 10.0.1402, lock released), commits 9c0466f76f (5 paths) +
  55425c34a7 (svm render), `_progress_log.md` entry.
  <!-- sv: Keywords: typecheck-build 0.40, commit-own 0.30, progress-log 0.20, render 0.10; Semantic dominant: Prove and land the router fix. -->

## Smoke Tests

- `requestEnvelope(routerModel, "x")` contains `UNKNOWN (router)` and NOT
  `cost: free` (S1, RED before S2, GREEN after).
- `requestEnvelope(freeModel, "x")` still contains `cost: free` (no overblock).
- Typecheck exit 0; `bun test test/tool/aicall.test.ts` GREEN via cmd_runner.
- `_build.ps1` exit 0 (lock honoured, shared tree).

## Risks

- Overblocking real `:free` models whose name contains no `Router`:
  contained by exact-id allowlist (only `openrouter/auto*`, `openrouter/free`,
  `fusion`, `pareto-code`, `switchyard`, `*-router` + name-contains-Router).
- Omitted-model REFUSED breaks callers relying on silent free default:
  intended per brief (chain or explicit model); envelope names the missing
  model so the caller can retry explicitly.
- No `provider.ts`, no `bin/`, no kernel, no paid calls in this task.
