<!-- intention: protocol for a model is still resolved per REQUEST (h3 probe on the wire, SDK cache pinned to the first model) and /agents loses the cursor on return -> protocol is resolved ONCE at selection time, persisted into the selected layer and read as a plain value; the /agents cursor stays on the agent you configured -->
# /agents: protocol resolve-on-select + cursor restore

**Status:** ACTIVE — owner directive 2026-09-29T04:21Z. Owner answered the two open questions: cursor bug is (A) «выбрал модель → вернулся в /agents → курсор на первой строке»; auto resolve must «записать конкретный» protocol into the layer.

## Prior art

- ✓ Owner spec 2026-09-26 (`plans/2026-09-26_unified-settings-layers.md` §Addendum 3-5 + T6 part 2): protocol lives in the layers, chosen in /agents; display is `auto(resolved)`; «протокол фиксируется при выборе настроек, а не при запросе»; runtime reads a ready value. Part 1 (display) shipped; part 2 (session scope + resolve-at-selection) OPEN — this plan.
- ✓ Where protocol is read per request today: `provider.ts:1634-1642` — custom fetch passes `gatewayProtocol: model.options?.protocol`; `resolveSDK` cache key is `Hash.fast({providerID, npm, options})` (`provider.ts:1589-1597`) — SDK instances are cached per PROVIDER options, so the first model's `options.protocol` sticks for every later model of that provider; per-session override cannot land at all. Gateway side is ready: `adaptive-client.ts:462` `resolveGatewayProtocol(provider, init?.gatewayProtocol)`, `protocolChain` at :72-77.
- ✓ TUI write path exists: `local.tsx:1009-1047 setModelProtocol` (global + worktree via `patchProjectConfig`; session scope currently toasts «needs server work»).
- ✓ Cursor restore mechanism exists: `dialog-agent.tsx:233-240` passes `restoreValue` on return; `DialogSelect` (`ui/dialog-select.tsx:118-127`) restores the highlight via `setCursor`, but **never scrolls** — `moveTo` (the only path that scrolls, :279-303) is called for `props.current` in the delayed effect (:253-269) and NOT for `cursorValue`. Configuring a SUBAGENT (rows below the fold) and returning leaves the viewport at the top → «курсор сбросился на начало».

## Design decisions (owner-confirmed)

1. `auto` at selection time = **probe once, write the concrete rung** (`h3` | `h2`) into the layer; runtime then reads a concrete value and never probes. Choosing `h3`/`h2`/`http/1.1` writes it verbatim (unchanged).
2. Probe = one simple request to the provider origin: `fetch(origin, { protocol: "http3" })` bounded by a short timeout; any HTTP answer proves h3; transport failure → check plain (h2) fetch; both fail → nothing written, visible toast.

## Task list

- [x] ✓ **T1 (cursor fix).** `ui/dialog-select.tsx` `cursorValue` effect: deferred centred `moveTo` added after `setCursor`. Oracle: `test/tui/dialog-select-cursor.test.ts` RED `20260929T061845Z_b74512e8` (1 pass / 1 fail — the effect reached `setCursor` but not `moveTo`) → GREEN `20260929T061904Z_47430a21` (2 pass / 0 fail); `test/tui` 200 pass / 0 fail `20260929T062431Z_67fd6f7c`.
- [x] ✓ **T2 (probe module).** `cli/cmd/tui/component/protocol-probe.ts` + `test/tui/protocol-probe.test.ts`: h3 ok → h3 (one request, `protocol: http3`); h3 handshake fail + plain ok → h2; both dead → undefined; `protocolNeedsProbe` truth table. Covered by the 249/0 run `20260929T062229Z_34b280e3` and the 200/0 run `20260929T062431Z_67fd6f7c`.
- [x] ✓ **T3 (session layer storage).** `session-settings.ts`: `modelProtocol` field + `SESSION_SETTINGS_KEYS` + normalize + `sessionModelProtocol()`. `local.tsx setModelProtocol`: session branch writes `{sid}.jsonc` (a probe-failed literal `auto` drops the key). The settings-registry policy test (inside `test/tui`) passed on the new key.
- [x] ✓ **T4 (runtime reads the layer).** `llm.ts` resolves `sessionModelProtocol(...)` and passes `protocol` to `provider.getLanguage`; `provider.ts` builds an effective model with the override, the language-model cache key gains `#p<protocol>`, and `resolveSDK`'s SDK key includes `model.options?.protocol` so the fetch closure cannot keep the previous rung. `bun typecheck` exit 0 `20260929T062403Z_2c055d67`.
- [x] ✓ **T5 (UI save flow).** `dialog-model-parameters.tsx save()`: `auto`/absent → `probeProtocol` against `models[base].api.url` → concrete rung written via `setModelProtocol` + toast; probe failure leaves the layer unchanged and keeps the dialog open. Origin from the model's `api.url` (the SDK `Provider` carries none — first typecheck red `20260929T062256Z_90781ab7` caught it, fixed and verified green).
- [x] ✓ **T6 (oracles, focused).** `bun test test/tui test/session/session-settings-*.test.ts` → 249 pass / 0 fail `20260929T062229Z_34b280e3`; `bun test test/tui` → 200 pass / 0 fail `20260929T062431Z_67fd6f7c`; `bun typecheck` → exit 0 `20260929T062403Z_2c055d67`.
- [ ] **T6-live (residual — plan stays in `plans/`).** Live smoke needs a rebuilt candidate: /agents → pick a subagent model → cursor stays on the row; protocol `auto` → one probe → the layer holds the concrete rung; the next request carries it (raw-wire shows `configured: h2`, no h3 probe). Not run this cycle — no candidate build was authorized.

## Out of scope

- SDK cache key is shared per provider: after T4 the key includes the protocol only; a broader per-model key refactor is a separate task.
- `parseStreamError` plain-object OR shape (residual from the retry plan).
