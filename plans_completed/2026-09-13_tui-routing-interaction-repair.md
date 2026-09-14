<!-- intention: routing appears inert and sampling controls are undiscoverable -> routing has an explicit, immediately observable interaction model for mouse and keyboard, and agent sampling is visibly reachable -->
---
title: TUI routing interaction repair
status: COMPLETED
owner: OpenCode team
reproduce:
  files:
    - packages/opencode/src/cli/cmd/tui/component/dialog-routing.tsx
    - packages/opencode/src/cli/cmd/tui/component/dialog-routing-state.ts
    - packages/opencode/src/cli/cmd/tui/component/dialog-agent.tsx
    - packages/opencode/test/tui/dialog-routing-state.test.ts
  commands:
    - cd packages/opencode && bun test test/tui/dialog-routing-state.test.ts
    - cd packages/opencode && bun test test/tui/
    - cd packages/opencode && bun typecheck
  inputs: /agents → an OpenRouter-model agent → Ctrl+O (or any OpenRouter model via /models → Ctrl+O).
  expected_outputs: The routing editor opens focused on the first sort choice; arrows skip section headings; the header shows the live mode line (e.g. "Mode: dynamic OpenRouter routing by lowest price"); dynamic sort rows render as radios (•)/( ).
---

# TUI routing interaction repair

## Grounded defect

`DialogRouting` starts the cursor on a non-actionable section heading and moves through headings. Its rendered rows have no mouse handler although OpenTUI emits raw `down`/`up` pairs and does not synthesize clicks. Thus a mouse release bubbles harmlessly through the dialog and no control state changes. The form also renders dynamic sort choices like checkboxes even though they are a mutually exclusive mode; toggling a provider clears the sort without an explicit state summary. Sampling is accessible only through a `Ctrl+G` keybind in the agent dialog, so it has no visible discovery path.

OpenTUI requires the application to own focus traversal and mouse activation; its `Select` reference uses focused rows, visible selection, arrows/j/k, and Enter. This repair follows that contract rather than adding another custom interaction convention.

Sources: `dialog-routing.tsx` lines 293–556; `dialog-agent.tsx` lines 227–307; [OpenTUI Select](https://opentui.com/docs/components/select/); [OpenTUI interaction](https://opentui.com/docs/core-concepts/interaction/).

## Contract

- Arrow navigation visits actionable rows only; the initial active row is the first sort choice.
- Space, Enter, and a left mouse release over an actionable row perform the same action and visibly retain the active row.
- Dynamic routing is a radio selection. Provider and quantization choices remain checkboxes. The form states the current routing mode after every action.
- Agent sampling has a visible `Sampling…` action beside `Routing`, retaining keyboard shortcuts as accelerators.
- No routing option is silently reinterpreted; save payload remains `buildRouting` output and live endpoint fetch behavior is unchanged.

## Tasks

| Task | Bound surface | Oracle |
|---|---|---|
| T1 `[COMPLETION]` Make cursor and control semantics explicit | routing state + dialog rows | focused state tests: headings skipped; dynamic/default payload transitions preserve native keys |
| T2 `[COMPLETION]` Bind pointer and keyboard activation | routing dialog | OpenTUI pointer handlers invoke the same `act()` path as Space/Enter; source is parsed by the launched TUI |
| T3 `[COMPLETION]` Expose sampling entry point | agent configuration dialog | the visible shortcut is named `Sampling parameters` |
| T4 `[COMPLETION]` Record and close | docs, plan, progress records | landed as `918f114db8`; the former capture residual was closed by run `20260914T130240Z_2815997c` (`routing.png`, `skip.png`) |

## Smoke tests

Baseline before code: `cd packages/opencode && bun test test/tui/dialog-routing-state.test.ts`.

Post-change: focused routing-state and interaction tests, then launch the TUI with `bun run dev` and exercise `/agents` → `Ctrl+O` against a real terminal. A renderer capture alone does not prove live input dispatch.

## Risks / rollback

- Mouse events may start text selection; the row handler must prevent the renderer default on left down without removing keyboard access.
- Endpoint data is live and non-deterministic; tests must use deterministic rows, not the network.
- Routing semantics are provider-visible configuration. Preserve `buildRouting`; rollback is the single plan-bound source reversal.

## Execution evidence

- Baseline: `bun test test/tui/dialog-routing-state.test.ts` — 5 pass / 0 fail (`20260913T164707Z_8b3044a2`).
- Post-change: the same focused test — 7 pass / 0 fail (`20260913T164949Z_80b9a39e`).
- Live smoke (first pass): `bun run dev` rendered the TUI and reached its Agents panel with `Tab` (`20260913T165512Z_cf3f1230`); no routing configuration was saved.
- Landed 2026-09-14 as `918f114db8` (the session's log was committed while this code stayed stashed): focused file 12 pass / 0 fail, `test/tui` 52 pass / 0 fail, `bun typecheck` exit 0 — plus `routingModeLabel` extracted so the mode line is unit-tested.
- Live capture (closes the former residual): `_run.cmd` + `--terminal wt --direct-terminal` keeps the TUI alive (plain `bun run dev` exits 0 after ~7s in the supervised environment); run `20260914T130240Z_2815997c` showed the dialog for `openrouter/z-ai/glm-5.3-flash` with the mode line, radios `(•) Lowest price` / `( )`, focus on the first actionable row, and 4×DOWN skipping the `PROVIDERS` header straight to `[order]` (`routing.png`, `skip.png` in `logs/cmd_runner/20260914T130240Z_2815997c/`).
