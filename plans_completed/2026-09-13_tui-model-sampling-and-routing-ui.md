<!-- intention: TUI agent settings without per-model sampling controls or stable endpoint navigation -> editable, persisted per-model sampling controls and a stable endpoint-routing dialog -->
---
title: TUI per-model sampling and routing ergonomics
status: COMPLETED
owner: OpenCode team
reproduce:
  files:
    - packages/opencode/src/cli/cmd/tui/context/local.tsx
    - packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx
    - packages/opencode/src/cli/cmd/tui/component/dialog-model-parameters.tsx
    - packages/opencode/src/cli/cmd/tui/component/dialog-routing.tsx
    - packages/opencode/src/session/session-settings.ts
    - packages/opencode/src/session/llm.ts
  commands:
    - cd packages/opencode && bun test test/session/model-sampling.test.ts test/session/session-settings-persist.test.ts test/tui/agent-selection.test.ts test/tui/dialog-routing-state.test.ts test/tui/settings-registry.test.ts
    - cd packages/opencode && bun typecheck
  inputs: /agents → selected agent → Sampling; edit all four fields; choose Save. Open Ctrl+O routing afterwards.
  expected_outputs: Saved values survive the selected scope and become the model's effective chat parameters; routing presents a static legend and no animated/loading text inside the selectable form.
---

# TUI per-model sampling and routing ergonomics

## Goal
Add the requested standard model parameters — `temperature: 0.6`, `repetition_penalty: 1.15`, `top_p: 0.92`, `presence_penalty: 0.8` — to every model's `/agents` configuration path. Values are editable, scope-persisted, applied to future requests, and saved only from the last menu row. Replace routing dialog status text that changes during asynchronous endpoint lookup with a stable status line and preserve keyboard navigation.

## Grounded facts
- `DialogAgent` is the entrypoint for agent configuration; its selected model resolves through `local.model.forAgent`.
- Model options are merged into provider options, but `streamText` receives `temperature` and `topP` as top-level parameters. A model-level sampling surface therefore needs explicit runtime precedence rather than raw provider-option injection.
- Session settings and worktree `model.json` already persist model-indexed state; global and worktree config write through existing SDK/config paths.
- `DialogRouting` recreates rows when live endpoints finish loading and renders changing loading/error strings in the form header area. Its Save row already exists and must remain the only write action.

## Tasks
| ID | Task | Binding | Oracle |
| --- | --- | --- | --- |
| T1 | [x] Add typed sampling state and scope resolvers | `session-settings.ts`, `model-sampling.ts`, `local.tsx` | 30 persistence/default assertions |
| T2 | [x] Apply resolved model sampling to generation | `config/provider.ts`, `llm.ts` | `bun typecheck` |
| T3 | [x] Add `/agents` sampling editor | `dialog-model-parameters.tsx`, `dialog-agent.tsx` | typed menu with Save as final action |
| T4 | [x] Stabilize inference-endpoint routing UI | `dialog-routing.tsx` | focused routing-state tests and live TUI startup |

## Claims and risks
- C1: scope precedence is session → worktree → global. Falsifier: a higher-scope persisted value overrides a lower-scope one.
- C2: `temperature`, `top_p`, and `presence_penalty` map to AI SDK top-level options; `repetition_penalty` is namespace-routed by the existing provider transform. Falsifier: request inspection does not contain the configured values in their expected routes.
- R1: unsupported provider knobs may be rejected. Containment: preserve the model/provider transform path and scope values; no silent compatibility aliases.
- R2: endpoint fetch timing can move keyboard rows. Containment: keep interaction rows stable and move fetch state into a non-selectable static status line.

## Smoke contract
- Baseline: existing session persistence and routing state tests.
- Post-change: 44 focused persistence/default/TUI-state assertions and `bun typecheck` passed. The terminal TUI started and rendered; keyboard injection could not drive the dialog in the supervised PTY.

## Rollback
Revert the bounded sampling storage/editor/runtime fields and routing view change; no data migration is required because unknown persisted keys are ignored by older builds.