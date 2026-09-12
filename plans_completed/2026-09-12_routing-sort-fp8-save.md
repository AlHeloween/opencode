# Routing sort, fp8 default, and explicit Save

state: COMPLETED
owner: build

## Goal

Make OpenRouter routing understandable and reversible in the TUI: expose dynamic sorting by price and speed, default the quantization filter to fp8 only when the selected model has live fp8 endpoints, surface an inherited `provider.only` pin instead of hiding it, and treat the routing form's Save action as the sole write authorization. In the `/agents` model and variant editors, replace generic yes/no write questions with one explicit Save action.

## Grounding

- The executable loads global configuration from `D:/zPython/opencode/bin`; the active file is `bin/opencode.jsonc`.
- That file currently pins all OpenRouter requests with `provider.openrouter.options.routing.only = ["Modal"]`.
- A captured title-agent request inherited that pin for `anthropic/claude-haiku-4.5` and received a 404 because Modal was not an available endpoint.
- `dialog-routing.tsx` reads only `routing.order`, so an existing `routing.only` value is neither displayed nor editable.
- The bad value is provider-wide (`provider.openrouter.options.routing`), while the form writes model- or agent-specific routing. The form must display the effective inherited value, but repairing the provider-wide source remains a separate explicit config write.
- OpenRouter's provider-routing contract supports `sort: "price" | "throughput" | "latency"` and `quantizations` filters.
- The routing dialog already has a Save row, but global scope adds another confirmation dialog; model and variant global writes use generic yes/no confirmation dialogs.

## Tasks

- [x] Add pure routing-state helpers and focused tests for `only`/`order`, sorting, fp8 defaulting, and preservation of unrelated routing keys.
- [x] Extend the routing dialog with price/throughput/latency controls, visible effective/inherited strict-provider selection, and one explicit Save action without a second confirmation.
- [x] Stage global model + variant edits in `/agents` and persist both with one explicit Save action and one config write.
- [x] Remove the accidental global Modal-only pin from the executable-adjacent config and read the persisted artifact back.
- [x] Update routing documentation/workflow records and run focused tests, typecheck, and a TUI smoke where feasible.

## Risks

- A global fp8 filter can break OpenRouter models that have no fp8 endpoint. Containment: default fp8 in the model-aware form only when live endpoint metadata advertises fp8; do not force fp8 globally across every model.
- Rebuilding a routing object can erase native OpenRouter keys not owned by the form. Containment: preserve unknown keys and replace only `only`, `order`, `sort`, `quantizations`, and `allow_fallbacks`.
- `only` and `order` have different routing semantics. Containment: retain the existing mode when editing a pinned list and clear explicit provider selection when dynamic sorting is chosen.
- The synchronized config view is merged, so a global editor can initially reflect a worktree override. Containment: label the displayed state as effective, keep the write target explicit, and do not claim that a child override removed a provider-wide source; repair the known provider-wide Modal pin directly and verify the artifact.
- Model and variant currently write independently. Containment: the global `/agents` path passes the selected model into the variant editor, stages the variant locally, and calls one batch writer only from Save.

## Smoke Tests

Baseline before source edits:

```text
tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/provider/openrouter-routing.test.ts test/session/session-settings-routing.test.ts test/tui/agent-selection.test.ts
```

Post-change:

```text
tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/provider/openrouter-routing.test.ts test/session/session-settings-routing.test.ts test/tui/agent-selection.test.ts test/tui/dialog-routing-state.test.ts
tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun typecheck
```

Decisive artifact oracle: parse `bin/opencode.jsonc` after the write and assert that `provider.openrouter.options.routing.only` no longer contains `Modal`.
