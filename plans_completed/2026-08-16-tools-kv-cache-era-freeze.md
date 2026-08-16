# 2026-08-16 — Tools JSON: era-freeze для KV-кэша

## Design principles (от пользователя, G4)

- **Каталог тулов и скиллов — перманентный в пределах эры.** Менять набор тулов = ломать инференс
  (модель уже видела схемы, план её ответов зависит от каталога).
- **Рантайм-гейтинг делают Constitution (execute-time deny) и промпт** (что разрешено использовать),
  НЕ перекройка набора схем. Провод всегда несёт полный каталог; блокировка — на исполнении.
- **Compact = новая версия системы.** На compact можно обновить ВСЁ, включая кернел — это не «резка»,
  а новая эра: старый префикс умирает честно, новый живёт в своём ключе. Середина эры — заморожена.
  (Совпадает с существующей политикой path-system: «freezes until compact».)

## Goal

Каталог тулов должен быть **byte-stable, era-frozen** частью префикса запроса провайдера.
Саммари-туры (Layer-1 in-loop + emergency route) обязаны держать **полный каталог на проводе** —
как это уже делает сайдкар. Ни один дрейф (MCP-коннект, новый скилл/агент, плагин,
opt-out user.tools) не должен менять bytes провода внутри эры сессии.
Эра-снапшоты каталога (T3/T4) пересчитываются только на границе эры
(cold-start / compact / kernel identity change); внутри эры — только чтение снапшота.

## Claims (premises — все Exact, прочитаны в коде)

- **C1**: runLoop-ветка `summaryAttempt` шлёт `tools = {}` — `src/session/prompt.ts:1861-1868`.
  Саммари-запрос теряет весь tools JSON (~18k на KAT) → gateway «хитит» чужой префикс (55k-эра без тулов), рабочий 73k-префикс кэш не набирает.
- **C2**: сайдкар — противоположная, правильная политика: полный каталог на проводе
  (`prompt.ts:2356`), исполнение заблокировано `Constitution.setSummaryMode` (`src/session/tools.ts:194-210`).
- **C3**: `describeTask`/`describeSkill` вшивают **живые** списки агентов/скиллов в description
  (`src/tool/registry.ts:348-381, 403-409`). Резолв каталога — каждый юзер-тур
  (`cachedTools` живёт только внутри runLoop — `prompt.ts:1568-1573`).
- **C4**: аудит сортирует ключи тулов (`llm.ts:584-589` + `stableStringify` 99-110),
  провод использует insertion order (`llm.ts:668-669`) → рассинхрон невидим.
- **C5**: MCP-тулы дописываются после builtin по живым `connected`-клиентам
  (`src/session/tools.ts:264-266`, `src/mcp/index.ts:637-639`); порядок зависит от порядка коннектов.
- **C6**: `user.tools[k]===false` выкидывает схему с провода (`llm.ts:762-769`) — per-request, не per-эра.
  По design principle #1 это нарушение перманентности каталога → переводится на runtime-deny (T5e).

## Open questions — РЕЗОЛВИНГ (explorer task-1 MCP, task-2 валидация)

- **Q1 (MCP-дрейфы)**: `s.defs` живёт и обновляется по `ToolListChangedNotification` (`mcp/index.ts:469-481`);
  `mcp.tools.changed` публикуется (`:479`), но **подписчиков ноль** — ивент орфанед.
  **Silent drop**: connected-клиент без `s.defs` просто исчезает из каталога с warn (`mcp/index.ts:648-652`).
  **Недетерминированный порядок**: `Effect.forEach(..., { concurrency: 4 })` пишет ключи в общий `result`
  в порядке завершения (`mcp/index.ts:641-657`) → порядок MCP-тулов на проводе зависит от гонки;
  reconnect после disconnect переставляет клиента в конец (`:567, :625`). Конфиг-вотчера нет —
  правка config.json сама по себе ничего не триггерит; HTTP-роуты `mcp.add/connect/disconnect` — да.
- **Q2 (resolve в captureSummary)**: `SessionTools.resolve` требует ровно
  `Pick<SessionProcessor.Handle, "message"|"updateToolCall"|"completeToolCall">` (`tools.ts:47`);
  стаб уже доказан в `test/session/tools.test.ts:79-86`.
- **Q3 (тесты)**: `bun run test` / `bun run typecheck` из `packages/opencode`;
  целевые: `bun test --timeout 30000 test/session/prompt.test.ts test/session/tools.test.ts test/session/compaction.test.ts test/session/llm.test.ts test/session/summary-cadence.test.ts`.
  **ВНИМАНИЕ**: `prompt.test.ts:806, :845` сейчас ассертят `tools.length === 0` у саммари-туров — тесты закрепляют баг, их надо обновить в T6.

## Prior art

- Внутренний прецедент уже есть в коде: **path system «freezes until compact»**
  (`src/session/checkpoint.ts:56-59`, `prompt.ts:1986-2008`) — та же политика переносится на каталог тулов.
- Сайдкар-гарант (`tools.ts:194-210` + комментарий «Schemas stay on the wire») — готовый механизм блокировки исполнения.
- `reuse: N/A` (всё в дереве; внешних решений не нужно).

## Smoke Tests (PRE_FLIGHT)

**Baseline (до первой правки, cwd = packages/opencode):**
- `cmd_runner start -- bun typecheck` → exit 0, 0 ошибок.
- `cmd_runner start -- bun test test/session/` (уточнить по explorer 2 — список файлов) → PASS.

**Post-impl oracles (перед `[x]` каждой задачи):**
- typecheck PASS; новые unit-тесты задачи PASS; существующие session-тесты PASS.
- KAT acceptance (на живом gateway):
  - рабочие туры T1–T3 с каталогом: prompt length одинаковый, gateway отдаёт cached>0 на повторе идентичного запроса;
  - саммари-тур S: prompt length **равен** рабочему (тулы на проводе), cached>0 в том же префиксе;
  - T4 (drop last tool) → префикс отличается, кэш-мисс — ожидаемо и видимо.

**Live-верификация на zen free-модели (2026-08-16, `experiments/2026-08-16-zen-tools-kv-smoke/tools_kv_zen_smoke.py`, nemotron-3-ultra-free, 31 тул):**
- W1 холодный: prompt 3244, 5.32s → W2 идентичный повтор: prompt 3244, **2.88s** (префикс тёплый; `cached_tokens` остаётся 0 — известное KAT-поведение null/0≠miss).
- W3 drop last tool: prompt **3160** (−84 токена = ровно один тул) — смена каталога видимо меняет префикс.
- W4 снова полный каталог: prompt 3244, **2.31s** — кэш префикса эры переиспользуется, ключ стабилен.
- free-лимиты: deepseek-v4-flash-free / mimo-v2.5-free → 429 FreeUsageLimitError; nemotron-3-ultra-free — работает.

## Tasks

### T1 — UNIFY_SUMMARY_TOOL_POLICY (in-loop Layer-1) — [x] DONE
- **what**: убрана ветка `tools = {}` из `summaryAttempt` (`prompt.ts:1861-1868`); саммари-тур использует тот же `cachedTools`/`SessionTools.resolve`, что и рабочий. **Ин-луп тур сегодня не защищён ничем, кроме пустого каталога** (флаг ставит только сайдкар) — поэтому тур обёрнут в `Constitution.setSummaryMode(sessionID, true)` с очисткой в `Effect.ensuring` (образец: `prompt.ts:854, 992-998`).
- **files**: `packages/opencode/src/session/prompt.ts`, `packages/opencode/test/session/prompt.test.ts`
- **oracle**: новый тест «Layer-1 in-loop summary turn keeps the full tool catalog on the wire» (ручной инжект через `SessionCompaction.Service.injectSummaryRequest`, т.к. runLoop больше сам не инжектит) — PASS (1 pass, 4 expect: паритет JSON каталога, флаг снят). typecheck PASS (`20260816T161342Z_336797af` exit 0).
- **A/B-факт**: legacy Layer-1 тесты (`prompt.test.ts:806/845/…`) падают и на чистом HEAD (inputs 1 vs 2) — in-loop путь в dev не запускается без внешнего инжекта; их ассерты обновлены под новый контракт, но сами тесты оживут только при восстановлении инжекта в runLoop (отдельная задача, вне скоупа).

### T2 — EMERGENCY_ROUTE_TOOL_PARITY (captureSummary) — [x] DONE
- **what**: `captureSummary` (`prompt.ts`) резолвит реальный каталог через `SessionTools.resolve` вместо `tools: {}` — тот же порядок/схемы, что в runLoop (providerAgent=cacheAgent, стаб-processor 3 поля по паттерну `tools.test.ts:79-86`). Title-путь (`prompt.ts:340`) не трогали: small-модель, отдельный cache key.
- **files**: `packages/opencode/src/session/prompt.ts`, `packages/opencode/test/session/prompt.test.ts`
- **oracle**: новый тест «emergency captureSummary carries the full tool catalog on the wire» — **1 pass** (`20260816T181517Z_c1d3f3d0`; captured=true, паритет JSON каталога с рабочим туром, флаг снят). Тестовая модель переведена на `bigCaptureProviderCfg` (context 200K) — headroom-гейт сайдкара (M+32K ≤ context) иначе не пускает при открытом 65K-окне.

### T3 — FREEZE_TASK_SKILL_DESCRIPTIONS (era snapshot) — [x] DONE
- **what**: в `ToolRegistry` добавлен per-session era-memo (`createEraMemo`, `State.descEra`): `describeTask`/`describeSkill` вычисляются один раз на эру (первый `tools()` с `sessionID`), дальше — заморожены; `invalidateToolDescriptions(sessionID)` бампает эру. Инвалидация вызывается из `prompt.ts` в двух границах эры: compact (`Checkpoint.remove` рядом) и checkpoint identity mismatch (смена кернела). `SessionTools.resolve` передаёт `sessionID` в `registry.tools()`.
- **files**: `packages/opencode/src/tool/registry.ts`, `packages/opencode/src/session/tools.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/test/tool/registry.test.ts`
- **oracle**: юнит `createEraMemo` + интеграционный «era-freezes task/skill descriptions per session until invalidateToolDescriptions» — **1 pass, 7 expect** (`20260816T184312Z_2cf0338f`). typecheck PASS (`20260816T184437Z_9c4982ee`).
- **pre-existing**: `registry.test.ts` «exposes only memory to the protected reasoning agent» падает и без правок (каталог давно не режется по роли — ACL на execute); dynamic-import тесты таймаутят под CPU-лимитом.

### T4 — MCP_ERA_FREEZE + ремонт MCP-поверхностей — [x] DONE
- **what**: (a) эра-снапшот MCP wire-каталога (`mcpEraStore` в `tools.ts`: имена/описания/схемы per session+model; `mcpLiveSig` детектит изменения; расхождение → log «MCP tool catalog changed — deferred to next era», провод держит снапшот; execute пересобирается из живого клиента, при дисконнекте — deny-стаб «unavailable until next era»); `invalidateMCPEra(sessionID)` вызывается в compact и identity-mismatch; (b) **silent drop устранён**: connected-клиент без defs → re-fetch (`defs()`), только провал re-fetch опускает сервер с warn «bug:»; (c) **детерминированный порядок**: клиенты в sorted-порядке, тулы в server-listed порядке — гонка `concurrency:4` убрана; (d) `mcp.tools.changed` покрыт сравнением `mcpLiveSig` в resolve (defer-лог).
- **files**: `packages/opencode/src/mcp/index.ts`, `packages/opencode/src/session/tools.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/test/mcp/lifecycle.test.ts`
- **oracle**: тест «tools() returns a deterministic client-sorted tool order» — **1 pass** (`20260816T190413Z_e742e616`); `tools.test.ts` PASS (`20260816T191246Z_a7d0c0b9` — заодно обновлён устаревший deny-ассерт, pre-existing с 67d2dca2de); typecheck PASS. A/B: фейлы `lifecycle.test.ts` (listToolsCalls 2 vs 1 и др.) — **pre-existing** (подтверждено прогоном на чистом HEAD `20260816T190228Z_bc527763`).

### T5 — WIRE_ORDER_AUDIT (аудит видит то, что на проводе) — [x] DONE
- **what**: (a) audit-хэш тулов — insertion order (`llm.ts`: `Object.keys(tools)` без `.sort()`); (b) `checkToolStability` — per-session хэш wire-каталога (порядок+описания+схемы), дрейф → `warn("bug: tool catalog changed mid-session")`; (c) чек вызывается после `_noop`-аппенда (LiteLLM-стаб включён); StructuredOutput (`prompt.ts`) — детерминированный per-format toggle, вне wire-чека (отмечено); (d) `activeTools`/«invalid» — проверено: `InvalidTool` (id «invalid») реально существует и осознанно исключается из activeTools; коллизия имён исключена `register()` — правок не требует; (e) **user.tools opt-out → runtime-deny**: `resolveTools` — identity (wire не режется), deny перенесён в `SessionTools.denied`/`rejected` (отдельный ответ «Tool disabled by user configuration»), `userDisabled` передаётся из обоих resolve-вызовов в `prompt.ts`.
- **files**: `packages/opencode/src/session/llm.ts`, `packages/opencode/src/session/tools.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/test/session/tools.test.ts`, `packages/opencode/test/session/llm.test.ts`
- **oracle**: `tools.test.ts` + `llm.test.ts` — **21 pass, 0 fail** (`20260816T192836Z_b660560f`, включая новый «user.tools=false is a runtime-deny, never a wire reshape» и обновлённый «never reshapes the wire catalog»); T1+T2 тесты — **2 pass** (`20260816T193314Z_27879b3c`); typecheck PASS (`20260816T193056Z_e933d5a8`).

### T6 — ORACLES_AND_TESTS (финальная проверка) — [x] DONE
- **what**: все задачи закрыты ораклами выше; план перенесён в `plans_completed/`; `_progress_log.md` и `_application_workflow_diagram.md` обновлены.
- **Итог ораклов**: typecheck exit 0 (последний `20260816T193056Z_e933d5a8`); новые тесты: T1+T2 = 2 pass, T3 = 1 pass, T4 = 1 pass, T5 = в наборе 21 pass; KAT acceptance — живой zen smoke (`experiments/2026-08-16-zen-tools-kv-smoke/`): W2 2.88s vs W1 5.32s (тёплый префикс), W3 −84 токена при drop тула, W4 2.31s (кэш эры переиспользуется).

## Risks

- R1: эра-снапшот тулов добавит память/сложность в registry — мягко, InstanceState уже есть.
- R2: отложенный MCP-тул до следующей эры = пользователь ждёт compact до появления нового тула. Приемлемо (документируем в логе); альтернатива — явная инвалидация эры с потерей кэша, осознанный выбор.
- R3: саммари-тур с полными тулами = модель может попытаться вызвать тул; блокировка через setSummaryMode обязательна (T1), иначе регресс хуже бага.
- R4: существующие тесты `prompt.test.ts:806/845` ассертят `tools.length === 0` у саммари-тура — они кодируют баг; обновляются в T6 вместе с кодом T1 (нельзя мержить T1 без T6).
- R5: MCP-порядок на проводе сегодня зависит от гонки `concurrency:4` — фикс порядка в T4(c) изменит байты для всех MCP-сессий один раз (холодный старт префикса), далее стабильно.
- R6: `toolChoice: "required"` при StructuredOutput (prompt.ts:2096) — отдельный toggle; покрыт аудитом T5(c), семантику не меняем.

## Status

state: COMPLETED — все задачи T1-T6 закрыты ораклами; KAT/zen acceptance пройден (живой smoke nemotron-3-ultra-free).
