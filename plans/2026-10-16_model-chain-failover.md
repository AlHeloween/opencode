<!-- intention: blind retry loops on dead models with human failover -> explicit ordered model chain per agent/scope with automatic classified failover and 10-minute health checks -->
<!-- goal_sv: model-chain,failover-classification,health-probe,assignment -->
# t68 — explicit model chain (recents = primary + backups), automatic failover, 10-minute health check

```yaml
Keywords: model-chain 0.35, failover-classification 0.25, health-probe 0.20, assignment 0.12, tui-recents 0.08
Semantic dominant: An explicit ordered model chain per agent replaces blind retry with classified automatic failover and periodic health recovery.
md5: 8f3a1c2d4e5f6a7b8c9d0e1f2a3b4c5d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
```

Owner, 2026-10-16, verbatim: «Вообще надо доработать систему:
1. Явное добавление в recents - модель и ее бэкапы, на случай если сложностей, и чтобы они цеплялись автоматом после
ошибок. Цепочку проверять раз в 10 минут и смотреть если модели из списка отлипли.
2. При назначении агентов назначаются именно назначенные recents.
3. Это убережет нас от зацикливания запросов на которые мы заведомо получаем отлуп.»

State: **DRAFT** — grounding done this session (codegraph + reads), no product edit yet. Bounds per run: steps 80, tools 200, loops 4, depth 2, time 7 200 000 ms.

## Ground (G1 — what the code says, not a proposal)

- Recents today is an implicit LRU, not a chain: `local.tsx:744-750,1192-1200` prepends every pick to `modelStore.recent` (cap 10), persisted via `save()` into `.opencode/data/state/model.json`; session copy via `sessionPayload` (`local.tsx:240-258`). TUI owns the worktree layer (`setWorkspaceAgentModel`, `session-settings.ts:105`); a write behind its back is overwritten (measured 10-15). Every write goes through the SAME server path the TUI uses. Map: `docs/agent-model-resolution.md`.
- Resolution today: `resolveAgentModel` (`session-settings.ts:257`) S2 session → S1 worktree → fallthrough; server `prompt.ts:1289` `input.model ?? resolveAgentModel ?? ag.model ?? lastModel`. Dispatch pins by hand: `experiments/2026-10-08_robot-wave/dispatch.py` `MODEL`/`FALLBACK_MODEL`/`VARIANT` sent as `prompt_async {agent,model,variant}`.
- Health already exists — REUSE, no second breaker: `provider/gateway/store.ts` `getHealthWindow`, `recordError`, `recordSuccess`, `getOrCreateCircuitBreaker`, `recordCircuitBreakerFailure/Success`, `isCircuitBreakerOpen`; `provider/gateway/health-window.ts` (100-sample window, p50 latency/ttft/chunk-gap); `provider/gateway/circuit-breaker.ts` (failThreshold 5, cooldown 30 s, probeLimit 3); `provider/gateway/adaptive-client.ts:363 wrapFetch` records both.
- Error classification exists in pieces: `provider/error.ts parseAPICallError` (overflow, unknown_parameter, api_error + `isRetryable`), `session/retry.ts retryable/delay/policy` (5xx always retriable, overflow never, backoff 2 s ×2, headers honoured), `session/message-v2.ts fromError` (AuthError, APIError, AbortedError, HeaderTimeoutError → retryable). No terminal-vs-transient split, no DOWN-at-once, no chain order.
- Retry UI: `SessionRetry` (`packages/ui/src/components/session-retry.tsx`) renders attempt/next/message — the visible-note surface to reuse for failover notes.
- Storage rule (AGENTS.md): new state = key namespace in LMDB/SQLite, never a new JSON file. Chain extends the EXISTING `model.json` / session `.jsonc` / global config shapes (same files the TUI already writes), not a new file. Granularity rule: 10-min check runs off the request path, on its own timer.
- Absence-of-oracle rule: chain health renders a value or `unknown`, never blank.

## Design (decided from the code; the rest is implementation detail)

1. **Chain is explicit and ordered** — per agent AND scope (global / worktree / session, filled not resolved): `[primary, backup1, backup2…]`, each `{providerID, modelID, variant}`. User adds model AND backups from the TUI dialog (DialogModel/DialogManageModels extension); web form (t59 lane) coordinates through the SAME server route — one route, two surfaces, never built twice.
2. **Failover is automatic and classified** — terminal (auth, privacy/consent gate, 402 balance, model-not-found, unknown_parameter naming a body field) marks member DOWN at once, zero retries on it; transient (429, 5xx, timeouts, HeaderTimeoutError/ResponseStreamError, stream with no first token past threshold derived from measured p50-TTFT — `threshold = max(floorMs, k × p50TtftMs)`, floor and k named in code and pinned by test, never a guessed constant) gets the existing bounded retry (`retry.ts delay/policy`), then DOWN. Session continues on next healthy member with a visible note (which member, why — via the SessionRetry surface); never a silent swap.
3. **10-minute health check** — each DOWN member gets one cheap probe on a 10-min cadence, off the request path. Probe is a DIRECT provider call (or ephemeral non-resumable path) with zero tools and zero sessions in the robots' host (measured 10-16: probe sessions got revived with «Продолжай» and stole plan boxes). Probe answers → UP, chain returns to order.
4. **Assignment uses the chain** — dispatched agent (TUI, `prompt_async` without model, org delivery) resolves to first UP member of its assigned chain; dispatcher stops pinning models by hand (`dispatch.py` MODEL/FALLBACK_MODEL becomes chain read, not a constant).
5. **No paid tier sneaks in** — member set is exactly what the user put in the chain; failover never invents a model. Paid `/paid` zen/contributor distinction from catalog stays user-visible.

## Review R1–R4 (owner, 2026-10-16) — decided, implemented in slice 2

- **R1 fill-once, not read-walk.** `fillChain` (session→worktree→global on read) violated the fill rule — replaced by `fillChainForNewLayer` (one copy at layer creation/backfill) + `readChainLayer` (one key, no parents) + `shouldBackfill`. An empty layer warns `bug: session chain layer left unfilled` and falls through to the legacy path. ✓ (`chain.ts`, `model-chain-failover.test.ts` fill-once block)
- **R2 key namespace, not JSON fields.** LMDB is NOT deployed (`learned-facts.ts:17`, `epistemic-store.ts:10-12`, absent from package.json — measured, not assumed), so the chain lives in the relational plane: `model_chain(scope, agent, data)` (`chain.sql.ts`, `storage/db.ts` CORE_SCHEMA_SQL), same single-row-blob split as `session_epistemic`; key `session:<id>:agent:<name>:chain` (`chainKey`). Writes go through the server-side store (`store.ts`, `Database.use` with the epistemic fallback contract), never behind the TUI's back, never a new JSON file. When LMDB lands, the namespace moves and the table goes with it. ✓ (`chain.sql.ts`, `store.ts`, `model-chain-store.test.ts`)
- **R3 one signal source.** The chain does not count — no windows, counters or thresholds of its own; all counting stays in `HealthWindow`/`CircuitBreaker`. `gateway.ts` maps gateway `recordError` categories (`429/5xx/conn_reset/read_timeout` + status) onto the chain input, so the site catching a provider error feeds ONE refusal to both `Store.recordError` (transport stats) and `classifyChainError` (member selection). ✓ (`gateway.ts`, `classifyGatewayError` block)
- **R4 measured floor.** Read-only 2026-10-16 over `.opencode/data/opencode.db` (user→assistant latency, `message.time_created`, 1 s–60 min): free n=33 p50 = 23 594 ms / p95 = 50 761 ms; Go contributor n=5 p50 = 41 009 ms / max = 50 819 ms. `FIRST_TOKEN_FLOOR_MS = 120 000` (~2.4× observed max; covers today's Go-OK 37 s; a 30 s floor would cut live answers) with provenance written next to the constant. ✓ (`classify.ts` FLOOR comment)
- **Trivia.** Missing health routes as UP but displays as `unknown` (`displayHealth`); plan SV md5 fixed to 32 hex.
- **Slice 3 (route + wiring).** `GET/PUT /chain/:scope/:agent` (`httpapi/chain.ts`, регистрация в `public.ts`/`server.ts`) — тот же HttpApi-путь, что остальные instance-роуты; web-форма t59 подключается к нему же, форму не строим. `promptAsync` без модели подставляет first UP (`assignChainModel`); `task`/`pipeline` берут цепочку первыми с `chain switch`-заметкой в лог; статусы+reasons видны через `GET /chain`. In-session баннер требует новый event-type и едет в C6.
- **Slice 3 live (изолированный стенд .temp/chain-stand, копия dist, порт 4099).** `PUT/GET /chain` — JSON живьём, статусы `unknown`, пустой слой `[]`; hono-бридж обязателен (experimental-дерево serve не монтирует — доказано SPA-ответом). `prompt_async` без модели → `chain assign opencode/muse-spark-1.3-contributor-free` в логе стенда. free ответил живым terminal-отказом: 429 `FreeUsageLimitError`, `retry-after: 64404` (~17.9 ч) — покрыт BALANCE-веткой классификатора + явным пином. Go xhigh — 7+ мин ни ответа, ни ошибки (висит дольше пола 120 с). Авто-перехода висящего free→Go нет: нужен in-request контур поверх `promptAsync` (обрыв по first-token timeout + повтор на следующем UP) — следующий лист C3b, без него цепочка переключает только по записанному DOWN.
- **C3b (in-request контур, ядро приземлено).** Чистое ядро `stream-failover.ts` (watcher с инжектированным временем, `decideStreamError`, `buildSwitchNote`, служебное событие `ChainSwitchEvent`) + контур в `llm.stream/runChain` (first-token watchdog 120 с, abort попытки, повтор на следующем UP через `provider.getModel`, switch как упорядоченное событие) + `case "chain-switch"` в processor (фиксация оборванного текста + synthetic note part). Без цепочки на слое — байт-идентичный legacy-путь. Variant цепочки на переключённую модель не применяется (остаток). Тесты на заглушке с fake-clock RED→GREEN.

- [ ] **C3b** — In-request failover (ЯДРО ПРИЗЕМЛЕНО, лист открыт до live-stand подтверждения): обрыв по first-token порогу, повтор на следующем UP, видимая synthetic-заметка, частичный текст зафиксирован с причиной. Осталось: live-стенд с висящим мембером, p50-адаптация порога, variant-подмена, in-session баннер — C6. state=PENDING;eta_turns=1;oracle=A3/live-stand. <!-- sv: inrequest-failover 0.50, visible-note 0.30, partial-kept 0.20 -->
## Acceptance frame (named BEFORE planning — ISO/IEC 25010)

| ID | Predicate | Oracle / discriminating control |
|---|---|---|
| A1 | Chain CRUD persists per agent/scope through the TUI's own server path; fill (global→worktree→session) preserved, no new JSON file | Focused store test + `model.json`/session readback; TUI-behind-back overwrite case stays green |
| A2 | Terminal refusal (privacy-gate text, 402, auth, model-not-found) marks member DOWN at once — refusing member never called twice before its health check | Fixture stub test RED-first; call-count assertion on refusing member |
| A3 | Transient (429/5xx/timeout/no-first-token past derived threshold) retries bounded, then DOWN; session ends on backup with visible note (member + reason) | Hanging-stub cut at threshold; session transcript contains the note; silent-swap mutation → EXPECTED_FAIL |
| A4 | 10-min check probes each DOWN member once with a cheap direct call; recovered member returns on next check; probes create no sessions and carry no tools | Fake-clock test (no 10-min sleep); probe session-creation count = 0, tools = 0 |
| A5 | `prompt_async` without model + task/pipeline/reasoning resolve to first UP member; dispatcher no longer pins MODEL by hand | Assignment test with first member DOWN → second member used; `dispatch.py` diff shows chain read |
| A6 | No invented models: failover set ⊆ user chain; health surface shows value or `unknown`, never blank | Exhausted-chain test errors visibly instead of inventing; status render test |
| A7 | Live: chain [free zen → Go contributor] with free hanging today ends on Go; scoped regressions + typecheck + `_build.ps1` green | Real free/contributor-only probe via researcher_agent; run/state receipts |
| A8 | Retry status on a switch names failed→next models, the terminal code and retry-after with zero wait; the session лента carries the same switch note | Policy switch-message unit test + processor chain test; a silent-status mutation (message without models) → EXPECTED_FAIL |

## Tasks and bindings

- [ ] **C1** — Chain store (LANDED slice 2, box stays open until A1 full): `model_chain(scope, agent, data)` in `storage/db.ts` CORE_SCHEMA_SQL + `chain.sql.ts` drizzle table + `store.ts` (`loadChain` one key / `saveChain` / `ensureChainFilled` once, epistemic fallback contract). Server route for TUI dialog + web form (t59) and `model.json` behind-back case still owed. Binding: `packages/opencode/src/provider/model-chain/{chain.sql.ts,store.ts}`, `packages/opencode/src/storage/db.ts`, `packages/opencode/test/provider/model-chain-store.test.ts`. state=PENDING;eta_turns=1;oracle=A1. <!-- sv: chain-store 0.45, fill-not-resolve 0.30, shared-route 0.25 -->
- [ ] **C2** — Error classifier: `classifyChainError(parsed, message)` → `terminal | transient`, reusing `parseAPICallError` + `retryable`; terminal list: auth/401/403, privacy/consent-gate regex, 402/insufficient-balance, ModelNotFound, unknown_parameter; transient: 429/5xx/timeout/HeaderTimeout/no-first-token. TTFT threshold from `HealthWindow` p50 (`max(floorMs, k×p50)` with named constants). Binding: `packages/opencode/src/provider/error.ts`, `packages/opencode/src/session/retry.ts`, `packages/opencode/src/provider/gateway/health-window.ts`, new `packages/opencode/src/provider/model-chain/*` + focused test. state=PENDING;eta_turns=1;oracle=A2/A3-classify. <!-- sv: error-classification 0.50, reuse-existing 0.30, measured-threshold 0.20 -->
- [ ] **C3** — Failover executor: first-UP selection, terminal→DOWN-at-once, transient→bounded retry→DOWN, continue session on next healthy + visible note (member, reason) via SessionRetry surface, never silent. No invention: exhausted chain = visible error. Binding: `packages/opencode/src/session/prompt.ts` (`createUserMessage`/`getModel`/`runLoop`), `packages/opencode/src/session/message-v2.ts`, `packages/ui/src/components/session-retry.tsx`, `packages/opencode/src/provider/gateway/store.ts` (reuse breaker/health). state=PENDING;eta_turns=2;oracle=A3/A6. <!-- sv: failover-execution 0.45, visible-note 0.30, no-invention 0.25 -->
- [ ] **C4** — 10-min health checker: timer off request path, one cheap direct provider probe per DOWN member, UP on answer, order restored; zero tools, zero sessions; fake-clock tests. Reuses breaker `cooldownMs` concept with chain cadence 10 min (named constant, not breaker default 30 s). Binding: new `packages/opencode/src/provider/model-chain/health-check.ts`, `provider/gateway/adaptive-client.ts` (direct-call path), focused test with fake clock + probe-call recorder. state=PENDING;eta_turns=1;oracle=A4. <!-- sv: health-probe 0.50, no-session-probe 0.30, fake-clock 0.20 -->
- [ ] **C5** — Assignment uses chain (CORE LANDED slice 2): `resolveChainAgentModel` in `session-settings.ts` reads ONLY the session layer key + first UP; empty layer warns `bug:` and falls through to legacy `resolveAgentModel`. `prompt_async`/task wiring to call it with the session chain + `dispatch.py` unpin still owed. Binding: `packages/opencode/src/session/session-settings.ts:resolveChainAgentModel`, `packages/opencode/src/tool/{task,pipeline,reasoning}.ts`, `packages/opencode/src/session/prompt.ts`, `experiments/2026-10-08_robot-wave/dispatch.py`. state=PENDING;eta_turns=1;oracle=A5. <!-- sv: chain-assignment 0.50, dispatcher-unpinned 0.30, prompt-async 0.20 -->
- [ ] **C6** — TUI chain editor + close: DialogModel/DialogManageModels gains primary+backups editing through the C1 route; web lane (t59) parity noted not built twice; live free→Go receipt via researcher_agent; regressions + typecheck + `_build.ps1`; docs + `_progress_log.md` + `svm render`. Binding: `packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx`, `dialog-manage-models.*`, `docs/agent-model-resolution.md` (appendix, not rewrite), this plan, `_progress_log.md`. state=PENDING;eta_turns=2;oracle=A6/A7. <!-- sv: tui-chain-editor 0.40, live-receipt 0.35, docs-close 0.25 -->
- [x] **C7** — Видимые попытки (ЗАКРЫТ 2026-10-16): decide возвращает именованное сообщение (`chain switch prev → next: terminal … (код, retry-after)`); policy публикует его в статус ретрая с нулевым ожиданием; reason обогащён кодом + retry-after; лента несла prev/next через buildSwitchNote с самого начала. Оракулы: retry 36/36 (20261016T161231Z_06b951a3), failover 32/32 (20261016T161917Z_aacfacd5), chain-тест 1/0 (20261016T161934Z_e4c936c8), typecheck exit 0 (20261016T162117Z_061cc2e6). state=DONE. <!-- sv: switch-visibility 0.50, status-names-models 0.30, reason-codes 0.20 -->
- [ ] **C8** — favorites→chain (ЧАСТИЧНО 2026-10-16: helper+тест): `favoritesToChain(picked, favorites)` в `chain.ts` — явный выбор = голова, остальные favorites = бэкапы по порядку списка, без алиасинга; 3 юнита в `model-chain-failover.test.ts` (32/32 зелёные). Связь доказана ОТСУТСТВУЮЩЕЙ: favorites живут в TUI-сторе (`local.model.favorite()/recent()`), chain — в `model_chain` через `saveChain`/PUT-роут, общих вызывающих нет. Остаток: проводка `DialogModel.onSelect` → `PUT /chain/:scope/:agent`; честная преграда — chain-клиента нет в SDK v2 (grep `chain` по `sdk.gen.ts` → no matches, 2026-10-16), нужен новый метод клиента. state=PENDING;eta_turns=2;oracle=dialog-pick пишет chain через серверный путь + readback. <!-- sv: favorites-chain 0.50, explicit-head 0.30, sdk-gap 0.20 -->

## Smoke Tests (PRE_FLIGHT gate — no product edit before RED)

1. `packages/opencode/test/provider/model-chain-failover.test.ts` (new, ONE file per runner call): stub provider with 4 behaviours — hang (no first token), privacy-refusal text, 402, 429-then-success. RED today: no chain module exists. Asserts: terminal members called exactly once; hanging cut at derived threshold; session ends on backup with note; recovered member returns after fake-clock advance; exhausted chain errors without inventing.
2. `packages/opencode/test/session/session-settings-smoke.test.ts` § chain-fill (extend, not fork): chain fill global→worktree→session; TUI-path write wins over behind-back edit.
3. Live (researcher_agent only, free/contributor): chain `[opencode/muse-spark-1.3-contributor-free → opencode-go/muse-spark-1.3-contributor]` with free hanging → session answers on Go; receipt = session id + model footer + timings.

## Risks

| ID | Trigger | Severity | Containment / rollback | Owner |
|---|---|---|---|---|
| R1 | Second breaker alongside gateway store | critical | REUSE `getHealthWindow`/`recordError`/breaker; review diff for duplicate state | Smit |
| R2 | Probe creates sessions / carries tools (10-16 incident) | critical | Direct-call-only probe; test asserts sessions=0, tools=0; no `prompt_async` in probe path | Smit |
| R3 | TUI-behind-back overwrite (10-15) | high | All writes via TUI server path; behind-back test stays green | Smit |
| R4 | Paid model invented by failover | high | Failover set ⊆ chain; exhausted = visible error; catalog price labels untouched | Smit |
| R5 | Threshold as guessed constant | medium | Derived from p50-TTFT with named floor/k; test pins formula, not value | Smit |
| R6 | Two robots in same tree on disjoint paths | medium | Own paths only, private-index commits, lock waited-for never deleted by hand | Smit |

## Claims (assistant proposes; only @ORACLE binds Exact)

| ID | Statement | Falsifier |
|---|---|---|
| CL1 | Recents today is implicit LRU, not an ordered chain | `local.tsx` shows ordered per-agent primary+backups with failover |
| CL2 | No terminal-vs-transient split exists | `classifyChainError` + tests pin the split |
| CL3 | Probes can run without creating sessions | A4 test: probe path creates zero sessions with tools zero |

Web-lane parity: t59 owns the web form; this plan owns the shared server route + chain semantics. Coordinate, do not duplicate.

## Execution envelope (proposed; binds at G4)

action_classes: READ, PLAN_WRITE, MODIFY_CANDIDATE, MODIFY_PROJECT (listed bindings only). No PROMOTE_STABLE (dist/ only via `_build.ps1`), no SELF_MODIFY (no kernel), no EXTERNAL_EFFECT beyond free/contributor probes via researcher_agent. Tools: codegraph/read/grep/glob, edit/write, cmd_runner-probed tests, task(researcher_agent for live probes). Bounds: steps 80, tools 200, loops 4, depth 2, time 7 200 000 ms. Prohibitions: `bin/`, `--amend`, `--no-verify`, bare `git commit`, `bun test` without path, sleeping 10 minutes, deleting a held lock file by hand.
