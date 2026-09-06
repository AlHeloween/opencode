---
title: Summary sidecar cost and cache repair
status: completed
date: 2026-09-06
reproduce:
  files:
    - packages/opencode/src/session/prompt.ts
    - packages/opencode/src/session/sidecar-policy.ts
    - packages/opencode/src/session/processor.ts
    - packages/opencode/src/provider/balance-storage.ts
  commands:
    - bun test test/session/summary-sidecar.test.ts test/session/summary-cadence.test.ts test/session/cache-injection.test.ts test/session/finish-step.test.ts test/session/llm.test.ts
    - bun test test/provider/balance-storage.test.ts test/session/summary-sidecar.test.ts test/session/finish-step.test.ts
    - bun typecheck
  inputs: A clean turn whose open-window content reaches the 65,536-token Layer-1 cadence.
  expected_outputs: One bounded summary cycle with observable finish-step cache and cost usage; no repeated cycle on the immediately following turn.
---

# Summary sidecar cost and cache repair

Goal: stop the 64K Layer-1 sidecar from inheriting a reasoning-model output budget above 120K tokens and from hiding its provider usage, while preserving the exact trunk cache identity, full tool catalog, and Constitution summary-mode execution denial.

## Claims and risks

- [Inferred] `captureSidecar` consumed only `text-delta`; its `finish-step` usage and cache metadata never reached session accounting or diagnostics.
- [Inferred] Omitting `outputTokenMax` let `LLM.stream` use the reasoning-model multiplier, observed in logs as request limits above 120K tokens.
- [Inferred] Cooldown started only after a valid checkpoint; a three-attempt invalid cycle could repeat on the next clean turn.
- [KV-CACHE RISK] Changing system, tools, provider cache key, or checkpoint message prefix would invalidate the intended prefix hit. None of these surfaces changed.

## Tasks

- [x] T1 Add an explicit 8,192-token sidecar output cap and reduce one capture cycle to two attempts.
- [x] T2 Consume `finish-step`, classify/log cache usage, and add every sidecar attempt to session token/cost totals through the same accounting function as normal turns.
- [x] T3 Start cooldown for failed as well as successful capture cycles.
- [x] T4 Add focused regression coverage and update compaction/runtime documentation.
- [x] T5 Baseline cumulative session cost in balance snapshots so detached sidecar usage is included in validation deltas without a schema migration.

## Smoke Tests

- Baseline: 52 pass, 0 fail (`20260905T171339Z_645004b1`).
- Focused post-change suite: 72 pass, 0 fail (`20260905T192318Z_e6fdc418`).
- Summary/Exact documentation reproduce suite: 46 pass, 0 fail (`20260905T192445Z_98eaeb8e`).
- Detached balance-accounting write path: 9 pass, 0 fail (`20260905T192828Z_4735c203`).
- `bun typecheck`: exit 0 (`20260905T192934Z_effd4217`).
- `git diff --check`: clean; Constitution, tool resolution, provider cache key, system, and checkpoint message-prefix assembly unchanged.

Residual: actual provider cache classification for the next live 64K capture is deliberately not guessed; the new `sidecar finish-step` telemetry makes that result directly observable after rebuild.
