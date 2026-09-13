<!-- intention: CUA application launch can appear over the user's active window -> every OpenCode-mediated CUA app launch starts minimized and never receives focus -->
---
title: Enforce minimized inactive CUA application launches
status: COMPLETED
owner: OpenCode team
reproduce:
  files:
    - packages/opencode/src/tool/cua.ts
    - packages/opencode/test/tool/cua.test.ts
  commands:
    - cd packages/opencode && bun test test/tool/cua.test.ts
    - cd packages/opencode && bun typecheck
  inputs: cua call launch_app with omitted or false start_minimized
  expected_outputs: forwarded launch_app JSON contains start_minimized:true; unrelated CUA calls preserve their original JSON.
---

# Enforce minimized inactive CUA application launches

## Goal
Force every `launch_app` call routed by OpenCode's CUA wrapper to request CUA driver's Windows `SW_SHOWMINNOACTIVE` path. CUA's existing background UIA/PostMessage dispatch can continue working, while the user's active window remains foreground and the launched app is minimized.

## Grounded facts
- The Windows CUA driver already accepts `launch_app.start_minimized`; `true` selects `SW_SHOWMINNOACTIVE`, acquires its foreground lock, and keeps UIA/PostMessage delivery available for minimized windows.
- The OpenCode CUA wrapper forwards `params.args` unchanged, so omitted `start_minimized` reaches the driver's default `false` and uses restored-but-nonactivated `SW_SHOWNOACTIVATE`.
- This is an OpenCode wrapper policy, not a driver ABI change: inject the required boolean only for `call launch_app`; malformed launch JSON must fail clearly rather than be reinterpreted.

## Tasks
| ID | Task | Binding | Oracle |
| --- | --- | --- | --- |
| C1 | [x] Inject `start_minimized:true` for CUA `launch_app` calls | `packages/opencode/src/tool/cua.ts` | exported pure argument normalizer test |
| C2 | [x] Preserve unrelated CUA call payloads | `packages/opencode/src/tool/cua.ts`, `packages/opencode/test/tool/cua.test.ts` | JSON forwarding test |
| C3 | [x] Document and record the no-focus launch policy | `docs/tools-and-sidecars.md`, `_progress_log.md` | read-back plus focused test |

## Claims and risks
- C1: every wrapper-mediated `launch_app` request has `start_minimized:true`. Falsifier: an omitted or explicit `false` value is forwarded unchanged.
- R1: a driver may refuse minimized launch when Windows cannot grant the foreground lock. Containment: surface its structured `background_unavailable` result; never retry through foreground launch.
- R2: a minimized target cannot produce a screenshot until restored. Containment: retain CUA's UIA/PostMessage background path; require explicit user authorization for any foreground restoration.

## Smoke contract
- Baseline: the wrapper currently forwards `params.args` unchanged.
- Post-change: the focused CUA test passes. Project typecheck reached unrelated errors in `test/provider/transform-reasoning-guard.test.ts`; none reference the CUA wrapper or test.

## Rollback
Remove the wrapper-only normalizer and its test; no persisted state or driver binary changes are involved.
