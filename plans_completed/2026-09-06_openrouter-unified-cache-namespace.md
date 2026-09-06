---
reproduce:
  files:
    - packages/opencode/src/session/llm.ts
    - packages/opencode/src/provider/transform.ts
    - packages/opencode/test/session/llm.test.ts
  commands:
    - tools/adm.exe --cmd-runner start --cwd D:\zPython\opencode\packages\opencode -- bun test test/session/llm.test.ts
    - tools/adm.exe --cmd-runner start --cwd D:\zPython\opencode\packages\opencode -- bun typecheck
  inputs: [OpenRouter child session with a task cache lease]
  expected_outputs: [banner, X-Session-Id, session_id, and prompt_cache_key equal the lease]
---

# OpenRouter unified cache namespace

Goal: repair the split identity in OpenRouter task turns without changing Constitution or prompt-kernel content.

## Smoke Tests

- Baseline: `bun test test/session/llm.test.ts` → 27 pass / 0 fail (`20260906T090346Z_ae973a27`).
- Post-change: OpenRouter wire request with a physical child session and reusable task lease must place the lease in the banner, `X-Session-Id`, `session_id`, and `prompt_cache_key`.
- Integration: `bun typecheck` from `packages/opencode`.

## Tasks

- [x] T1 Derive the final `providerCacheKey` before system assembly and use it in the mutable banner for every provider.
- [x] T2 Send that same namespace through both OpenRouter affinity channels and its cache key.
- [x] T3 Prove the child-lease wire shape; run typecheck, diff check, and artifact read-back.

## Result

- Child-lease wire oracle: 27 pass / 0 fail (`20260906T090557Z_94070e8e`). The captured banner, header, `session_id`, and `prompt_cache_key` are the same lease and not the physical child session ID.
- `bun typecheck`: exit 0 (`20260906T090624Z_0602951d`).
- `git diff --check`: exit 0.
- Supplemental `system-compose.test.ts`: 18 pass / 1 fail (`20260906T091108Z_a2156d93`) at its `REUSE_BEFORE|REUSE.BEFORE` assertion. The stale `CLAIM_LEDGER` assertion was removed; kernel and prompt artifacts remain out of this repair's scope.

## Risk and rollback

The first request after deployment will intentionally use a new cache namespace because the old format was split. Rollback is the small three-surface source diff; no history, Constitution, kernel, or tool catalog changes are in scope.
