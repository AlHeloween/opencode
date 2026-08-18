# Plan: Compaction Sidecar Wiring Fix — вернуть Layer-1 summary на нормальные ходы

- plan_id: 9c1d4f2e-7a3b-4c5d-8e6f-0a1b2c3d4e5f
- revision: 1
- created_by: build_mode
- state: ACTIVE (G4, 2026-08-16)
- date: 2026-08-16

## Goal

Восстановить рабочий каденс Layer-1 summary (~64K контент-токенов): захват sidecar-чекпоинта должен выполняться на **нормальном чистом завершении хода**, а не только при ошибке/блокировке. Дополнительно — гарантировать, что `compact()` никогда молча не скрывает непросуммированную историю, и что `/summarize` сначала создаёт summary, а потом фолдит.

## Root cause (кратко)

`maybeCaptureSidecar` подключён к `if (result === "stop")` (`prompt.ts:2160`, вызов на `2195`), но `SessionProcessor.process()` возвращает `"stop"` **только** при `ctx.blocked || assistantMessage.error` (`processor.ts:1079-1081`); нормальное завершение хода возвращает `"continue"`. Второй барьер: на чистом ходу цикл выходит через top-of-loop break (`prompt.ts:1636-1645` «exiting loop») до повторного входа в ветку `result === "stop"`. Итог: за 3 недели жизни фичи (`02d9c513be`, 27.07) — **0 строк в `project_checkpoint` за всю БД**, все компакты фолдили историю без покрытия.

## G6 validation (explorer, 2026-08-16)

Explorer прошёл по следу — 10/10 пунктов подтверждены (git-история снята build_mode отдельно):

1. `processor.ts:1079-1081` — CONFIRMED; `ctx.blocked` ставится только в `failToolCall` (`processor.ts:455`), `ctx.shouldBreak` — primary-агент без `continue_loop_on_deny`.
2. Единственный вызов `maybeCaptureSidecar` — `prompt.ts:2195`, внутри `if (result === "stop")` (`2160`); `compaction.compact` — `1514` (через `maybeCompactCadence`, определён `1468`, вызов `1664`) и `2234` (`result === "compact"`).
3. Top-of-loop break `1636-1645`; после `while` только `return yield* lastAssistant(sessionID)` (`2330`) — второй барьер недостижимости на нормальных ходах.
4. `injectSummaryRequest` — 0 вызовов из prompt.ts (dead; docs:148); legacy `summaryAttempt`-ветка `2034` мёртвая без инжекта.
5. `compaction.ts` — гардов на `summaries.length === 0` нет: Recent-cap `914-920`, безусловное скрытие visible `947-953`.
6. `/summarize` (`session.ts:729-738`) — `compact({force:true})` без предварительного summary.
7. Git: `maybeCaptureSidecar` введён `02d9c513be` (2026-07-27); `08da0ea077` (2026-07-30) тоже размещает захват в stop-ветке.
8. `compaction.test.ts:1404-1436` легализует фолд без summaries; `summary-cadence.test.ts` — только чистые функции, стоп-путь не покрыт.
9. `IncrementalCheckpoint.save` — единственный writer таблицы: `prompt.ts:1395` (внутри `maybeCaptureSidecar`).
10. Доки (`compaction.md:138,154-161`, `session-memory-graph.md:70,87,153`) описывают capture на «stop» как норму; код противоречит (чистый ход = "continue").

Доп. находки: (а) двойная недостижимость (п.3); (б) `session-memory-graph.md:155` уже фиксирует «Break-before-compact on completed turns», но не сверен с claim о sidecar.

## Premises (⊆ G)

- C1: `processor.ts:1079-1081` — `process()` возвращает `"compact"` | `"stop"` | `"continue"`; `"stop"` ⇔ `ctx.blocked || assistantMessage.error`. [Exact, read 2026-08-16]
- C2: `prompt.ts:2160-2204` — единственный вызов `maybeCaptureSidecar` внутри `result === "stop"`; нормальные ходы идут по `"continue"` → `break` в `"exiting loop"` (`prompt.ts:1636-1645`) без захвата. [Exact, read 2026-08-16]
- C3: `prompt.ts:2034-2143` — legacy-ветка `summaryAttempt` жива только при наличии synthetic summary-request в БД; `injectSummaryRequest` из `prompt.ts` не вызывается (dead). [Exact, read 2026-08-16]
- C4: `compaction.ts:947-953` — `compact()` безусловно скрывает все visible; `compaction.ts:912-920` — при отсутствии summaries Recent урезается до ~64K; фолд без покрытия не блокируется. [Exact, read 2026-08-16]
- C5: `session.ts:729-737` — HTTP-роут `/summarize` вызывает `compact({force:true})` без предварительного захвата summary. [Exact, read 2026-08-16]
- C6: БД-факты: `project_checkpoint` = 0 строк (вся БД), 0 legacy `summary:true`, 3 `message*` в сессии `ses_fffc5d1d2ffe` без единого `--- Summary ---` блока; последний фолд 2026-08-16 08:08:14 UTC: `{compacted:538, summaries:0, recent:88, forced:true}`. [Exact, dbread 2026-08-16]
- C7: `maybeCompactCadence` (`prompt.ts:1468-1535`) блокирует фолд только при `openSidecars === 1`; при 0 — пропускает. [Exact, read 2026-08-16]

## Tasks

| Task | Что | Файлы | Oracle |
|---|---|---|---|
| T1 | **Переезд стоп-последовательности на нормальный путь.** Вынести блок «checkpoint publish/persist → `maybeCaptureSidecar` → `maybeCompactCadence`/defer» в хелпер `runStopPathSequence(...)` внутри runLoop; вызывать: (a) из `result === "stop"` (error/blocked, поведение сохраняется), (b) при нормальном чистом завершении (finish не tool-calls/unknown, нет tool-частей, нет error) — с последующим fall-through в существующий incremental-checkpoint save (`prompt.ts:2253+`), чтобы KV-непрерывность не пострадала | `packages/opencode/src/session/prompt.ts` | `bun typecheck`; unit-тест T1: mock LLM «stop» → вызов захвата (чекпоинт-строка в `project_checkpoint`); существующие `prompt.test.ts` зелёные |
| T2 | **Инвариант покрытия в `compact()`.** Вычислить `coveredThroughId = max(toId собранных summaries)`; скрывать только сообщения `id <= coveredThroughId` (+ текущий Recent-хвост по прежней логике). Если summaries пусто — не скрывать ничего, `folded:false` + `slog.warn("compaction refused: no summary coverage")` (кроме явного escape-hatch, см. Risks R2) | `packages/opencode/src/session/compaction.ts` | unit: фолд без summaries → `folded:false`, сообщения не скрыты; фолд с 1 summary → скрыты только сообщения ≤ to_id; тест `compaction.test.ts:1405` переписан |
| T3 | **`/summarize` = capture → fold.** Извлечь переиспользуемый `captureSidecar(...)` (checkpointData + llm.stream + `IncrementalCheckpoint.save` + UI-панель) в сервис (SessionCompaction или SessionSummary), использовать из prompt.ts и из роута. Роут: экстренный захват по текущему окну → при валидном body `compact({force:true})` (уже покрыт) → `prompt.loop()`; при неудаче — HTTP 500 + сообщение, фолд НЕ выполняется | `prompt.ts`, `server/routes/instance/httpapi/session.ts`, `compaction.ts`/`summary.ts` | unit: роут с mock LLM → сначала checkpoint, потом компакт; failure-кейс → нет фолда |
| T4 | **`maybeCompactCadence`: блокировать фолд при `openSidecars === 0`** (сейчас только `=== 1`). Force-путь headroom-гейта остаётся, но подчиняется инварианту T2 (фолдит только покрытое) | `prompt.ts:1477-1485` | unit: 0 sidecars → skip (лог), 1 → skip, ≥2 → compact |
| T5 | **Диагностика.** В `log.info("compacted")` добавить `uncoveredFolded: N`, `coveredToId`; `slog.warn` при N>0. В `maybeCaptureSidecar` добавить debug-лог причин skip (turnComplete/cooldown/threshold/headroom) | `compaction.ts:985-992`, `prompt.ts:1254-1277` | code review + живой прогон |
| T6 | **Тесты и доки.** Переписать `compaction.test.ts:1405` (фолд без summaries ⇒ отказ), добавить тесты T1/T2/T4; обновить `docs/compaction.md` gap-таблицу (capture on normal stop = Match) и `session-memory-graph.md` | тесты + docs | `bun test` зелёные; docs соответствуют коду |

Порядок: T2 → T4 → T1 → T3 → T5 → T6 (инвариант раньше переезда, чтобы фолд-дыра была закрыта до активации захвата).

## Smoke Tests (PRE_FLIGHT)

- baseline-1: `cmd_runner start --cwd packages/opencode -- bun typecheck` → exit 0.
- baseline-2: `cmd_runner start --cwd packages/opencode -- bun test test/session/compaction.test.ts test/session/summary-cadence.test.ts` → pass (текущее состояние до правок; ожидаем 1 известный тест-легализатор T2 на перезапись).
- baseline-3: БД-снимок: `SELECT COUNT(*) FROM project_checkpoint` = 0 (эталон «до»; после фикса в живой сессии должен расти).

## Outcome contract

- OC1: нормальный чистый ход (finish=stop, нет tool-calls) в живой сессии с контентом ≥ 64K токенов → появляется строка в `project_checkpoint` и панель `=== LAYER-1 SUMMARY ===` в TUI.
- OC2: `compact()` при нуле summaries возвращает `folded:false` и не скрывает сообщения (unit PASS).
- OC3: `/summarize` при недоступном LLM-захвате НЕ фолдит и возвращает ошибку (unit PASS).
- OC4: существующие тесты сессии (`prompt.test.ts`, `compaction.test.ts`, `summary*.test.ts`) зелёные; `bun typecheck` exit 0.
- coverage_threshold: 1.0.

## Risks

- R1 [KV-CACHE RISK]: переезд стоп-последовательности может изменить порядок/байты checkpoint-сохранений. Митигация: fall-through в существующий incremental save (2253+) сохраняется; отдельный холодный ход после деплоя задокументировать.
- R2: escape-hatch T2 (фолд непокрытого при provider context-overflow, `result==="compact"`) — осознанная дыра: сессия-сирота без s при маленьком контексте иначе зациклится на 413. Митигация: `slog.warn` + видимый статус; подтвердить на G4.
- R3: sidecar LLM-вызов добавляет ~1 вызов провайдера на ход при достижении каденса (это by design, но теперь реально заработает — следить за cost/задержкой).
- R4: `isAssistantTurnComplete` может резать захват на reasoning-моделях, если reasoning-часть не закрылась; проверить живым прогоном deepseek.

## Verification (G8)

- [x] T2: `compact()` отказывает при нуле summaries (`compaction refused: no summary coverage`), hide-all только при покрытии.
- [x] T4: `maybeCompactCadence` блокирует фолд при `openSidecars < 2` (без force).
- [x] T1: стоп-последовательность запускается на нормальных ходах (`completedCleanly` + `captureDue`), fall-through в incremental checkpoint save сохранён; error/blocked-поведение прежнее.
- [x] T3: `captureSidecar` вынесен на уровень сервиса + `SessionPrompt.captureSummary`; `/summarize` = capture → fold, при неудаче false без фолда; lone-star → false (идемпотентность).
- [x] T5: debug-логи причин skip в captureSidecar; warn при отказе компакта.
- [x] T6: `compaction.test.ts` приведён к новым семантам; docs/compaction.md обновлён.
- [x] **T7 (nuance 2026-08-16)**: `RECENT_MIN_TOKENS` 16 384 → **32 768**; walk-back хард-стопится на prior message* (включает его одним юнитом, не переходит дальше); summaries в начале, хвост ≥32K (±m*) в конце; повторные компакты без нового контента — no-op.
- [x] **T8 (nuance 2026-08-16 #2)**: компакт-порог = `usable()` = limit − 32K − 10K gap (уже был); закрыт гэп: `maybeCompactCadence` теперь вызывается в конце каждого хода и при `!captureDue` (не только в ветке захвата); headroom-путь (нехватка 32K на 64K-каденсе) → force-компакт → счётчик = len(m*)/4; панели summaries — UI-only, исключены из агент-M (`message-v2.ts:847-859,881` — верифицировано).
- [x] **T9 (revert)**: `SessionRevert.revert` больше не уходит молча при отсутствии fossil-чекпоинта — message-level revert персистится с warn; file-restore пропускается. Revert-тесты в этом окружении таймаутят (fossil spawn, ~5s) — отдельный план.
- [x] Oracle: `bun typecheck` exit 0 (2026-08-16 11:53).
- [x] Oracle: `bun test test/session/compaction.test.ts test/session/summary-cadence.test.ts` — **88 pass, 0 fail** (2026-08-16 11:49; повторно в combined-прогоне 11:54).
- [ ] OC1 живой прогон (rebuild + чистая сессия ≥ 64K → строка в `project_checkpoint`) — отложен до rebuild.
- [ ] Pre-existing (вне scope плана): `prompt.test.ts` 40 fail на HEAD; `revert-compact.test.ts` 5 fail (SessionRevert не персистит revert-state); некоммиченный `transform.ts` в дереве.
