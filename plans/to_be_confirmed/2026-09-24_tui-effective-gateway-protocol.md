<!-- intention: TUI shows the configured `auto` policy as if it were the selected protocol -> TUI shows the transport actually used by the current assistant turn, or explicitly `unknown` when no matching fact exists -->

# TUI: фактический транспорт gateway

## Состояние и границы

CONFIRMED (✓ codegraph `wrapFetch`, `View`, `protocolRow`; source 2026-09-24): `wrapFetch` writes `usedProtocol` into worker `globalThis`; sidebar reads another `globalThis` in the TUI thread. `createMemo` does not track that write. `protocolRow` falls back to `auto`, the policy rather than a transport. Assistant messages carry `parentID`; the LLM sends that user message ID in `x-request-id` for DeepSeek and most providers, but Novita sends `sessionID`. Existing `GlobalBus` events cross the worker boundary and reach `props.api.event`; `useEvent` requires a matching directory or `directory: "global"`.

## Acceptance and smoke before change

- [x] A1. A gateway request publishes the successful transport with its `x-request-id`, provider, and model through `GlobalBus`. Falsifier: transport succeeds but no addressed event is emitted. Baseline: `20260924T153945Z_82c703ab` failed with zero events; after change `20260924T154430Z_8fe97841` passed, including h3→h2 fallback publishing only h2.
- [ ] A2. Sidebar accepts only the event whose request ID matches the current assistant's `parentID` (or `sessionID` for Novita) and whose provider/model match, and rerenders reactively. Falsifier: another turn/provider event changes the row. Baseline: current sidebar reads its own worker-inaccessible global.
- [x] A3. No matching fact displays `unknown (protocol)` rather than presenting `auto` as measured transport. Falsifier: the row says `auto (protocol)` without a gateway observation. `sidebar-protocol.test.ts` covers an empty fact map, invalid `auto`, an older Novita turn and an unrelated sessionID for DeepSeek (`20260924T155016Z_3677ee39`). Custom fetch and reopened sessions are inferred from the absence of an event subscription history, pending A2 live acceptance.
- [x] A4. Focused provider, sidebar and global-event delivery tests pass (17/17, `20260924T155016Z_3677ee39`); package typecheck passed (`20260924T155036Z_1c85e609`). All execution stayed outside `bin/`; no live runtime promotion.

## Binding

1. `provider/gateway/adaptive-client.ts`: publish a factual, correlated event after transport success via existing `GlobalBus` envelope with `directory: "global"` (the typed Bus path needs a new schema and SDK union for no additional filtering benefit here). Replace the legacy global last-protocol state. Oracle: local gateway request and observed event payload.
2. `cli/cmd/tui/feature-plugins/sidebar/{context.tsx,protocol-row.ts}`: hold matching events in a Solid signal and show fact or unknown. Oracle: event and row tests with a different turn/provider as controls.
3. Focused tests in `test/provider/adaptive-client.test.ts` and `test/tui/sidebar-protocol.test.ts`; update related docs/index only if the behavior description has a home. Oracle: `bun test <paths>` and `bun typecheck` from `packages/opencode`.

Risk: background gateway calls may share a model. Address by the existing request ID and assistant parent ID, and reject a fact older than creation of the displayed assistant message (Novita uses sessionID as request ID). Omit an uncorrelated fact. Rollback is the bounded diff to these files. No `bin/` access.

## Остаток после исправления

A2 остаётся открытым только для живой TUI: source и tests подтверждают адресное событие, `useEvent` пропускает `directory: "global"` в активном workspace, а `createSignal` является реактивной зависимостью `createMemo`; но итоговый пиксель/текст строки в отдельном TUI-процессе пока не наблюдался. Подтверждение: запустить изолированный кандидат, отправить DeepSeek-запрос с `auto`, увидеть `h2`/`h3`/`http/1.1` в строке и сверить с фактическим transport gateway того же запроса. Живой `bin/` без отдельного разрешения владельца не запускать и не изменять. Это не повод повторять тесты четырёх прежних планов из `plans/to_be_confirmed/`.
