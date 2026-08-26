# Progress Log

## 2026-08-16 Tools JSON era-freeze — T1-T6 завершены (plan: plans/2026-08-16-tools-kv-cache-era-freeze.md)

Reason: KAT-прогон с реальным каталогом (31 тул) показал — Layer-1 саммари-тур шлёт `tools: {}` (prompt.ts ветка `summaryAttempt`), префикс 55k вместо 73k, gateway «хитит» чужую эру (без тулов), рабочий префикс кэш не набирает; саммари-тур при этом не был защищён ничем, кроме пустого каталога. Дизайн-принцип заказчика: каталог тулов/скиллов перманентный (гейтинг — constitution+промпт, не форма провода); compact = апгрейд версии системы.

Script/Changes:

- `packages/opencode/src/session/prompt.ts` — T1: убрана ветка `tools = {}` из `summaryAttempt` (саммари-тур использует тот же `cachedTools`/`SessionTools.resolve`); ин-луп саммари-тур обёрнут в `Constitution.setSummaryMode(sessionID, true)` с очисткой в `Effect.ensuring` (по образцу сайдкара 854/992-998; guard — `tools.ts:194-210`).
- `packages/opencode/test/session/prompt.test.ts` — 4 ассерта `tools.length===0` заменены на паритет JSON каталога саммари/рабочего тура + снятие флага; новый тест «Layer-1 in-loop summary turn keeps the full tool catalog on the wire» (ручной инжект через `SessionCompaction.Service.injectSummaryRequest`, т.к. runLoop больше сам не инжектит).
- `experiments/2026-08-16-zen-tools-kv-smoke/tools_kv_zen_smoke.py` — живой zen-smoke: W1 cold → W2 identical → W3 drop-last-tool → W4 full-again; ключ из bin/auth.json (не печатается).

Script Output:

- typecheck: PASS exit 0 (`20260816T161342Z_336797af`).
- Новый T1-тест: **1 pass, 0 fail** (`20260816T163404Z_f6bc5652`; 4 expect: паритет JSON каталога, флаг снят).
- A/B на чистом HEAD: legacy Layer-1 тесты (`prompt.test.ts:806/845/…`) падают и без правок (inputs 1 vs 2) — in-loop инжект в dev не вызывается, тесты устарели (pre-existing, отдельная задача).
- Zen live (nemotron-3-ultra-free, 31 тул): W1 5.32s cold; W2 идентичный 2.88s (тёплый префикс, cached_tokens=0 как на KAT — null≠miss); W3 drop-last-tool prompt 3160 vs 3244 (−84 токена = 1 тул, префикс видимо другой); W4 снова полный каталог 2.31s — префикс-кэш эры переиспользуется. Контракт T1 подтверждён на живом gateway.
- **T2 (captureSummary)**: `tools: {}` → полный `SessionTools.resolve` (стаб-processor 3 поля, providerAgent=cacheAgent). Тест «emergency captureSummary carries the full tool catalog on the wire» — **1 pass** (`20260816T181517Z_c1d3f3d0`), с `bigCaptureProviderCfg` (context 200K — иначе sidecar headroom-гейт M+32K не пускает при открытом 65K-окне). typecheck: после рефакторинга captureSummary на `Effect.fn` + R-каст (паттерн runLoop в loop()) — PASS exit 0 (`20260816T182429Z_d7279618`). Оба новых теста вместе: **2 pass, 0 fail** (`20260816T182638Z_f16a1fe5`).
- **T3 (эра-заморозка описаний)**: `createEraMemo` в `ToolRegistry` (per-session memo describeTask/Skill), `invalidateToolDescriptions(sessionID)` из compact + identity-mismatch. Тесты: юнит memo + «era-freezes task/skill descriptions...» — **1 pass** (`20260816T184312Z_2cf0338f`); typecheck PASS (`20260816T184437Z_9c4982ee`). Pre-existing: «exposes only memory» (каталог не режется по роли давно).
- **T4 (MCP)**: `mcp/index.ts` — детерминированный порядок (sorted clients, server-listed tools; гонка concurrency:4 убрана), silent-drop устранён (re-fetch `defs()` при отсутствии кэша). `tools.ts` — эра-снапшот MCP wire (`mcpEraStore` per session+model, `mcpLiveSig`-детект → defer-лог, deny-стаб при дисконнекте), `invalidateMCPEra` из compact/identity-mismatch. Тест «deterministic client-sorted tool order» — **1 pass** (`20260816T190413Z_e742e616`). A/B: фейлы lifecycle.test.ts (listToolsCalls 2 vs 1) — pre-existing (`20260816T190228Z_bc527763` на чистом HEAD).
- **T5 (wire-аудит + user.tools)**: `llm.ts` — audit-хэш в insertion order, `checkToolStability` (warn «bug: tool catalog changed mid-session»), `resolveTools` = identity; `tools.ts` — `userDisabled` runtime-deny (ответ «Tool disabled by user configuration»), `prompt.ts` передаёт user.tools=false в оба resolve. Тесты tools+llm — **21 pass, 0 fail** (`20260816T192836Z_b660560f`; обновлён pre-existing deny-ассерт и legacy wire-фильтр-тест). typecheck PASS (`20260816T193056Z_e933d5a8`); T1+T2 регресс — **2 pass** (`20260816T193314Z_27879b3c`).
- **T6**: план → COMPLETED; stash `t4-abi` добавлен к `t1-kv-tools` (оба ждут разрешения на drop).
- WIP: stash `t1-kv-tools` остался в списке (constitution заблокировал `git stash pop`; правки восстановлены edit-инструментами — stash можно drop с разрешения).
- free-лимиты zen: deepseek-v4-flash-free и mimo-v2.5-free отдали 429 FreeUsageLimitError; nemotron-3-ultra-free работает.

## 2026-08-16 Compaction Sidecar Wiring Fix (plan: plans/2026-08-16-compaction-sidecar-wiring-fix.md)

Reason: Layer-1 64K summary-захват был подключён к `result === "stop"`, который процессор возвращает ТОЛЬКО при blocked/error (processor.ts:1079-1081) — на нормальных ходах захват не исполнялся никогда (0 строк project_checkpoint за всю БД); компакты фолдили историю без покрытия (сессия ses_fffc5d1d2ffe: 538 сообщений, summaries:0, forced /summarize 08:08:14 UTC).

Script/Changes:

- `prompt.ts` — T1: `completedCleanly` + `captureDue`-гейты, стоп-последовательность (checkpoint persist → captureSidecar → maybeCompactCadence) на нормальных ходах с fall-through в incremental save; T4: `openSidecars < 2` блокирует фолд; T5: debug skip-логи.
- `prompt.ts` — T3: `captureSidecar` вынесен на уровень сервиса (+sessionID/onHeadroomCompact), новый `SessionPrompt.captureSummary` для /summarize.
- `compaction.ts` — T2: отказ фолда при нуле summaries (`compaction refused: no summary coverage`).
- `httpapi/session.ts` — /summarize = captureSummary → compact(force) → loop; при неудаче false.
- `compaction.test.ts` — приведён к новым семантам (refusal-тесты, boundary-семантика computeOpenWindowTokens, тела summary-фикстур, padding recent против walk-back overlap).
- `docs/compaction.md` — gap-таблица обновлена.

Script Output:

- typecheck: PASS exit 0 (`20260816T100757Z_007888b2`).
- `bun test compaction.test.ts summary-cadence.test.ts`: **87 pass, 0 fail** (`20260816T100842Z_8da40ca4`).
- Baseline-оракулы: до фикса compaction/summary-cadence = 6 fail (stale-тесты); prompt.test.ts на HEAD = 40 fail (pre-existing); revert-compact.test.ts = 5 fail (SessionRevert.revert не персистит revert-state, pre-existing).
- WIP-восстановление: constitution заблокировал `git stash pop` → восстановлено через `git apply logs/compaction-fix.patch` (stash-запись осталась в списке).
- Nuance-round (user, 2026-08-16 11:43): `RECENT_MIN_TOKENS` → 32_768; `selectRecentTail` walk-back хард-стопится на prior message* (включает его одним юнитом); `captureSummary` отказывает на lone-star. Итог: хвост ≥32K (±m*), summaries в начале, повторные компакты идемпотентны. Oраклы: typecheck exit 0 (`20260816T114757Z_8c1dfd49`), тесты **88 pass, 0 fail** (`20260816T114834Z_e8bb4e23`, +тест «walk-back hard-stops at the prior message*»).
- Nuance-round #2 (user, 2026-08-16 11:50): (a) компакт-порог = `usable()` = limit−32K−10K gap — подтверждён, без изменений; (b) закрыт гэп в stop-path: `maybeCompactCadence` теперь выполняется в конце хода и при `!captureDue`; headroom-нехватка 32K → force-компакт → счётчик = len(m*)/4; (c) панели summaries исключены из агент-M — верифицировано (`message-v2.ts:847-859,881`, синтетик+ignored); (d) revert: fallback без fossil-чекпоинта (message-level persist + warn вместо молчаливого bail) — `revert.ts`. Oраклы: typecheck exit 0 (`20260816T115313Z_a35f704b`); combined-прогон (`20260816T115346Z_9da21af5`): compaction/summary-cadence **88 pass, 0 fail**; revert-compact 7 fail — таймауты ~5s (fossil spawn в тест-окружении), отдельный план.

## 2026-08-14 Sidecar Summary Parity Fix (spec: user — summary = обычный user-запрос к полному M)

Reason: sidecar Layer-1 summary уходил как «другой» запрос (range-only, tools:{}, tool_choice:none, max_tokens 8192, gap-fill) под общим cache key — расхождение с immutable-prompt инвариантом. Спецификация: summary = полный checkpoint M + синтетический user-промпт, те же tools на проводе, стандартный бюджет, запрет исполнения тулов системным флагом (constitution), retry тем же запросом, S сохраняется в базу, X не мутируется.

Script/Changes:

- `packages/opencode/src/session/prompt.ts` — `maybeCaptureSidecar`: messages = `[...checkpoint.messages, {role:"user", summaryRequestProse}]` (полный M, без range-реконвертации); убраны `toolChoice:"none"`, `outputTokenMax` (стандартный бюджет), gap-fill целиком; retry-цикл `SIDECAR_MAX_ATTEMPTS=3` (тот же запрос, тот же префикс → кеш-хит на ретраях); `Constitution.setSummaryMode(sessionID, true/false)` вокруг stream (clearing в `ensuring`); `tools` передаётся из scope вызова.
- `packages/opencode/src/session/constitution.ts` — `setSummaryMode`/`isSummaryMode` (per-session Map; очистка в `resetEpistemicState`).
- `packages/opencode/src/session/tools.ts` — execute-обёртка: `isSummaryMode` → denied-вывод «Tool execution disabled during summary», схемы остаются на проводе.
- `packages/opencode/src/session/compaction.ts` — в `summaryRequestProse` добавлено «Do not call tools — write the summary as plain text only».

Script Output:

- typecheck (tsgo --noEmit): PASS exit 0 (`20260814T183541Z_93c24122`, после восстановления правок через edit).
- `bun test test/session/constitution.test.ts`: 37 pass, 0 fail (`20260814T182415Z_6faa48f3`).
- `bun test -t "Layer-1" test/session/prompt.test.ts`: HANG без вывода — **pre-existing**: зависает и БЕЗ наших правок (stash-дискриминатор `20260814T182831Z_e8a075e3`), не вызвано фиксом.
- Rebuild `_build.ps1 -SkipOpenTui`: exit 0 (`20260814T183632Z_2cbf9ef5`) → dist 10.0.842, smoke: version OK + reasoning_prompt.txt inlined.
- Soft gap-fill (spec: «второй запрос включает что дополнить, без выключения чего-либо»): `prompt.ts` retry-цикл — attempt 1 = `summaryRequestProse`; attempts 2+ = тот же полный M + `gapFillRequest(body, gaps)` + «Previous draft for reference» в user-сообщении, ответ мержится `mergeSummarySections`; ничего не выключается (те же system/tools/бюджет).
- LIVE smoke `experiments/cache-alignment-smoke/smoke_gapfill_parity.py` (`20260814T185804Z_58f188fd`): retry-same — быстро; **parity gap-fill B1: cached 12096/12216 = 0.990 (M-префикс HIT, miss только tail)**; old-style (system:[], 2 msg) — cold. ВЕРДИКТ: мягкий gap-fill кеш-безопасен.
- Typecheck после soft gap-fill: exit 0 (`20260814T185939Z_f622bb26`); rebuild: exit 0 (`20260814T190011Z_98028f28`) → dist 10.0.843.
- LSP «Cannot find module openai»: root cause — pyrefly LSP авто-выбирает venv `.rag_env` (по pyvenv.cfg), а тот создан с `include-system-site-packages = false` → базовые site-packages (где стоит openai) не видны; PATH при наличии venv игнорируется. Fix: `include-system-site-packages = true` в `.rag_env\pyvenv.cfg` (gitignored, локально). Проверено: `.rag_env\Scripts\python.exe` теперь резолвит openai из `D:\USESoft\Python313\Lib\site-packages`. Эффект после рестарта LSP/opencode (пирайт кеширует интерпретатор).

## 2026-08-14 Cache null≠miss classification (critical: KAT gateways return cached_tokens:null on hits)

Reason: vanchin KAT Coder и другие гейтвеи возвращают `cached_tokens: null` (или не отдают поле) на ХИТАХ. Цепочка `getUsage` (session.ts:497 `?? 0`) схлопывала null → 0, `isCacheWarm` давал «cache miss» — хит логировался как промах. Различие «явный 0» vs «null/absent» терялось, тестов не было.

Changes:
- `packages/opencode/src/session/session.ts` — `CacheState = "hit"|"miss"|"unknown"` + `classifyCacheRead(cacheRead)` (null/undefined → unknown; 0 → miss; >0 → hit); комментарий-инвариант (классифицировать по RAW значению до коллапса getUsage).
- `packages/opencode/src/session/processor.ts` — finish-step: `rawCacheRead = value.usage.inputTokenDetails?.cacheReadTokens` ДО getUsage; лог «cache hit»/«cache miss»/«cache unknown» + поле `cacheState`.
- `packages/opencode/test/session/cache-classification.test.ts` — tri-state, collapse-trap регрессия (null ≠ miss), cacheRatio без NaN, isCacheWarm.

Output:
- `bun test test/session/cache-classification.test.ts test/session/cache-injection.test.ts test/session/processor-effect.test.ts`: **34 pass, 0 fail** (`20260814T194540Z_a89d9dfb`).
- typecheck exit 0 (`20260814T194735Z_44e08411`); rebuild exit 0 (`20260814T194807Z_866f7117`) → dist 10.0.844.

## 2026-08-14 Layer-1 summary cadence fix (bug: summary fired at ~10K startup content)

Reason: `summaryWindowLimit` клэмпил каденцию 65 536 по контексту модели. Для ~40K-модели порог схлопывался до ≈12 528 → Layer-1 summary срабатывал при старте с ~10K контента (не 64K). Клэмп нужен только Layer-2 (trim Recent), а не Layer-1.

Changes:
- `packages/opencode/src/session/compaction.ts` — `layer1SummaryThreshold()`: чистая каденция 65 536, без контекстного клэмпа (+док о регрессии).
- `packages/opencode/src/session/prompt.ts` — maybeCaptureSidecar: `threshold = SessionCompaction.layer1SummaryThreshold()` вместо `summaryWindowLimit`; `summaryWindowLimit` остаётся только в двух Layer-2 compact-вызовах (Recent trim).
- `packages/opencode/test/session/summary-cadence.test.ts` — каденция 65 536 model-independent; регрессия «10K старт не дотягивает до порога»; 65K окно срабатывает; summaryWindowLimit для 40K-модели = 12 528 (Layer-2, Layer-1 никогда его не использует).

Output:
- `bun test test/session/summary-cadence.test.ts test/session/cache-classification.test.ts`: **16 pass, 0 fail** (`20260814T195731Z_74bd6016`).
- typecheck exit 0 (`20260814T195802Z_7263d8d6`); rebuild exit 0 (`20260814T195834Z_ec00b050`) → dist 10.0.845.

## 2026-08-14 Summary 32K generation headroom gate (invariant: никогда не резать контент)

Reason: под генерацию summary всегда должно быть ≥32K свободного места; если полный M + 32K не влезает в лимит провайдера — обязан сработать компакт (иначе провайдер режет контент). Старый pre-flight мерял open-window (не полный M) против usable() и молча скипал summary — компакт в опасной зоне не срабатывал.

Changes:
- `packages/opencode/src/session/overflow.ts` — `SUMMARY_GENERATION_RESERVE_TOKENS = 32_768`; `summaryNeedsCompactFirst({model, contentTokens})`: `estimateRequestTokens(content) + 32_768 > limit` → true (limit = observed ?? input ?? context; ≤0 не блокирует).
- `packages/opencode/src/session/prompt.ts` — maybeCaptureSidecar pre-flight заменён: `fullMTokens = estimateContentTokens(visible)`; при `summaryNeedsCompactFirst` → warn «no 32K generation headroom — compacting first» + `maybeCompactCadence({force:true})` + return false. `maybeCompactCadence` получил `force` (обходит skip_single_sidecar и needsContentCompaction-гейт; sanity compactTarget>0 остаётся).
- `packages/opencode/test/session/summary-cadence.test.ts` — 6 тестов гейта: резерв 32_768; место есть/нет; точная граница fit; unknown limit не блокирует; регрессия «64K окно на 100K модели → compact first».

Output:
- `bun test test/session/summary-cadence.test.ts test/session/cache-classification.test.ts`: **22 pass, 0 fail** (`20260814T200703Z_7ab71e20`).
- typecheck exit 0 (`20260814T200717Z_ca8207bc`); rebuild exit 0 (`20260814T200748Z_d9882244`) → dist 10.0.846.

## 2026-08-15 Summary/compact loop guard (bug: бесконечное кольцо summary→force-compact→summary)

Reason: на версии под тестом после компакта сессии «позависали» во всех проектах. Цепочка: star без s (сырой) ≥ каденции 64K → sidecar дёргается на каждом стопе → headroom gate (full M + 32K > limit) форсит компакт → компакт не может уменьшить одинокий star (trim по границам сообщений) → Checkpoint.remove каждый стоп → холодный re-prefill каждый ход → TUI мёртв, abort/рестарты.

Changes:
- `compaction.ts` — идемпотентный skip «visible = [message*]» теперь **безусловный** (force не обходит): пересвёртка одинокого star не может его уменьшить. `isMessageStar` экспортирован; новый `hasFoldableContent(visible)` (чистый guard: star один → fold бессилен). `compact()` возвращает `{messageStarTokens, folded}` (skip/early-return → folded:false).
- `prompt.ts` — headroom gate: если `hasFoldableContent` → force compact + return false (как было); если складывать нечего (одинокий star) → **warn + capture дальше** (summary — единственный выход). `maybeCompactCadence`: `folded.folded === false` → return false **без** `Checkpoint.remove`/cooldown-сброса (не рушим KV-непрерывность на no-op).
- Тесты: `compaction.test.ts` — «FORCE re-compact на lone star → folded:false, star один» (1 pass, точечно `20260815T013051Z_7c166447`); `summary-cadence.test.ts` — `hasFoldableContent` 5 кейсов + регрессия deadlock-сценария.

Output:
- Pure: `bun test summary-cadence + cache-classification + cache-injection + processor-effect`: **51 pass, 0 fail** (`20260815T012844Z_d00f6381`).
- Force no-op (filtered, compaction.test.ts): **1 pass, 0 fail** (`20260815T013051Z_7c166447`). Полный compaction.test.ts — пре-существующий hang харнесса (как prompt.test.ts).
- typecheck exit 0 (`20260815T013125Z_ce7a8b5a`); rebuild exit 0 (`20260815T013159Z_d2d6236a`) → dist 10.0.847.

## 2026-08-15 KAT reasoning_content: не возвращать в replay (гипотеза подтверждена live + доки)

Reason: kat-coder-v2.5 — эхо reasoning_content в мультитёрне не нужно. LIVE (experiments/cache-alignment-smoke/smoke_kat_reasoning_echo.py `20260815T093520Z_7510f28e`): no-echo принят, prompt не растёт (73 vs 73), output reasoning tokens 50 vs 142 (с эхом модель пере-думает), быстрее (1042 vs 1768ms), явный cache hit. Tool-call сценарий (smoke_kat_reasoning_toolcall.py `20260815T093655Z_19ed03e8`): no-echo принят БЕЗ 400 (в отличие от DeepSeek), prompt 78 vs 101. Интернет: DeepSeek docs — без tool call reasoning_content игнорируется, с tool call обязателен; Alibaba/Qwen docs — «retain only content, ignore reasoning_content».

Changes:
- `packages/opencode/src/provider/transform.ts` — normalizeMessages: для streamlake/vanchin URL + npm github-copilot/openai-compatible → дроп reasoning-частей из assistant replay + зачистка `providerOptions.openaiCompatible.reasoning_content/reasoning_details`. Copilot opaque (github URL) и прочие прокси не тронуты; deepseek-правила выше не затронуты.
- `packages/opencode/test/provider/transform-reasoning.test.ts` — 5 новых KAT-кейсов (no-tool drop, tool-call drop, providerOptions strip, copilot untouched, litellm untouched).

Output:
- `bun test test/provider/transform-reasoning.test.ts`: **22 pass, 0 fail** (`20260815T094820Z_104e40c1`).
- typecheck exit 0 (`20260815T094908Z_bd83f8f0`); rebuild exit 0 (`20260815T094959Z_9b646b08`) → dist 10.0.848.
- Живые smoke (эксперименты, KAT): prefix-shrink — shorter-after-longer = 0.997 hit (`20260814T174304Z_5532596a`); sidecar под shared key НЕ клобберит ствол (0.997 hit после S) — прежний «clobber» вердикт дезавуирован (None≠miss).

## 2026-08-14 Cache Alignment (plan: plans/2026-08-14-cache-alignment.md)

Reason: привести opencode в соответствие с измеренным поведением кешей DeepSeek и StreamLake/KAT (две лабораторные серии), чтобы кеш не ломался от наших же артефактов.

Script/Changes:

- `packages/opencode/src/provider/transform.ts` — P2: deepseek-маршрут дропает CoT-байты из replay для сообщений БЕЗ tool calls (API игнорирует), сохраняет эхо при tool calls (400-guard); исключён OpenRouter (свой reasoning_details pass-through). P3: убран мёртвый `prompt_cache_key` для deepseek SDK-маршрута (не сериализуется, изоляции нет — D5 опровергнут).
- `packages/opencode/src/session/processor.ts` — P4: `prefixResetDelta()` + warn «cache: prefix reset» при сжатии промпта > порога (compaction/model switch).
- `packages/opencode/test/provider/transform-reasoning.test.ts` — P2/P3 тесты; `test/session/cache-injection.test.ts` — P4 тесты.

Script Output:

- typecheck: PASS (`20260814T155717Z_d81409cc`); 61/61 тестов PASS (`20260814T155443Z_8e64e8e0`).
- Rebuild `_build.ps1 -SkipOpenTui`: exit 0 (`20260814T160217Z_082209ae`) → dist 10.0.840.
- LIVE OC1: dist TUI на pasha-coder → wire содержит `stream_options.include_usage` → финальный чанк с реальным usage `{prompt_tokens:42008, completion_tokens:130, reasoning_tokens:37}`; `prompt_tokens_details:null` (cached_tokens гейтвей не отдаёт).

## 2026-08-14 DeepSeek Verification Series (experiments/deepseek-test)

Reason: mirror the StreamLake verification suite against api.deepseek.com (deepseek-v4-pro, DEEPSEEK_API_KEY from env) after reading the official API refs (chat completions, thinking mode, kv_cache).

Script: `experiments/deepseek-test/deepseek_test.py`, run via cmd_runner (`20260814T151203Z_c15f4a79` ladder, `20260814T151509Z_96b2ba97` big, `20260814T152056Z_23a60af4` no_think, `20260814T152307Z_546f0cb3` isolation).

Output: D1/D2/D3/D4/D6 CONFIRMED (balance, auto-cache full prefix, CoT ignored, thinking toggle works, usage auto). D5 NOT confirmed — user_id does not isolate KV cache (both new user_ids hit 48 128 on turn 1). Cold turn = 87% of series cost ($0.0209 miss on 48K). Report: `experiments/deepseek-test/REPORT.md`.

## 2026-08-14 StreamLake KAT Verification Series (experiments/streamlake-test)

Reason: confirm docs/streamlake-kat-thinking-cache.md claims (128-step cache, null≠miss, echo not billed, chat_template_kwargs ignored, bucket isolation) with multiturn+thinking series; measure cache hit/miss ratio.

Script: `experiments/streamlake-test/pasha_test.py` (modified from `bin/pasha_test.py`, key from `bin/auth.json`), run via cmd_runner (`20260814T143109Z_6b42b820` ladder, `20260814T143309Z_0419930b` big series).

Output: all 5 doc claims CONFIRMED (C1 with 64-token lattice nuance; C2 with latency nuance on big prompts). Hit ratio on 72K prefix: 0.969–0.9993 (miss = appended turn only). NEW ROOT CAUSE: gateway reports usage only with `stream_options.include_usage`; copilot-provider didn't send it → fixed in `packages/opencode/src/provider/sdk/copilot/copilot-provider.ts` (includeUsage default true); typecheck PASS (`20260814T143736Z_65596181`). Report: `experiments/streamlake-test/REPORT.md`.

## 2026-08-14 Cache-Miss Tail Fix (plan: plans/2026-08-14-cache-miss-tail.md)

Reason: wire/DB analysis showed 5.3% of prompt tokens (miss tail) consuming 87% of input cost; max deviation 38.6% miss per request on large tool-output injections; streamlake gateway reports no usage at all.

Script/Changes:

- `packages/opencode/src/session/message-v2.ts` — exported `REPLAY_TOOL_OUTPUT_MAX_CHARS = 32_000`.
- `packages/opencode/src/config/config.ts` — added `tool_output.replay_max_chars` (default 32000).
- `packages/opencode/src/session/prompt.ts` — all 8 `toModelMessages*` callsites pass `toolReplayOptions(cfg)`.
- `packages/opencode/src/session/processor.ts` — `CACHE_INJECTION_WARN_TOKENS=24_576`, `injectionDelta()`, `accumulateStepTokens()`; finish-step warns on large injections and aggregates per-step tokens.
- `packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts` — mapped `prompt_tokens_details.cache_write_tokens` → cacheWrite (was hardcoded undefined).
- `packages/opencode/test/session/cache-injection.test.ts` — new: 7 tests for T3/T4 pure functions.

Script Output:

- `bun typecheck` (packages/opencode): exit 0 pre-edit (`20260814T131807Z_2ea8598e`) and post-edit (`20260814T133958Z_8dcbcd51`).
- `bun test test/session/cache-injection.test.ts test/session/message-v2.test.ts test/session/processor-effect.test.ts`: 54 pass, 0 fail (`20260814T133958Z_ce3c3ca6`).

## 2026-06-04 Cache Collapse And Stream Stall Recovery

Reason: fix DeepSeek/Anthropic prompt-cache collapse detection, prevent cache-poison loop blocking, notify users, and add conservative pre-tool stream stall recovery.

Changes:

- Updated `packages/opencode/src/session/processor.ts` with input-delta collapse detection, rebaseline signaling, and stream stall timeout handling.
- Updated `packages/opencode/src/session/prompt.ts` to consume rebaseline signals and auto-continue pre-tool stalls.
- Updated `packages/opencode/src/session/compaction.ts` to map stalled compaction streams to stop.
- Updated `packages/opencode/src/session/session.ts` with `Session.Event.CacheCollapsed`.
- Updated `packages/opencode/src/provider/transform.ts` to include DeepSeek in cache marker application.
- Updated `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` to show cache-collapse toasts.
- Regenerated SDK event type surface for `session.cache_collapsed`.
- Updated plans under `plans/`.

Script output:

- `bun typecheck`: passed.
- `bun test test/session/processor-effect.test.ts --test-name-pattern "cache poison|input delta|cold start"`: 6 passed.
- `bun test test/provider/transform.test.ts`: 143 passed.

Notes:

- Dedicated runtime watchdog tests remain pending because existing LLM-server live tests in `processor-effect.test.ts` time out in this environment.

## 2026-06-07 Remove Watchdog And Cache-Control Side Effects

Reason: finish cleanup of automatic stream-stall and prompt-cache control-flow behavior, remove the processor scratch `MessageTable` dual-write, and keep cache handling passive.

Changes:

- Updated `packages/opencode/src/session/processor.ts` so cleanup persists through `session.updateMessage()` only.
- Moved `plans/20260606_remove_watchdog_cache_side_effects.md` to `plans_completed/20260606_remove_watchdog_cache_side_effects.md` after plan validation passed.
- Updated `_application_workflow_diagram.md` to remove stale stalled/cache-collapse workflow descriptions.

Script output:

- `bun test --timeout 30000 test/session/processor-effect.test.ts -t "record aborted errors and idle state"`: passed, 1 pass, 24 filtered out (`cmd_runner` run `20260607T080950Z_a55468aa`).
- `bun typecheck`: passed (`cmd_runner` run `20260607T081202Z_c3fcbf85`).
- `bun test --timeout 30000 test/session/compaction.test.ts`: passed, 48 pass (`cmd_runner` run `20260607T081202Z_05d9ac2c`).

## 2026-06-07 Runtime Path And Project DB Routing

Reason: `bin_tst\tst2\bin` contained executable-adjacent `.opencode\data` artifacts, and `tst2` project data was routed to the parent repo DB when discovery walked up to `D:\zPython\opencode\.git`.

Changes:

- Updated `packages/core/src/global.ts` so pre-worktree data/cache/state/log/bin paths start at the launch working directory instead of the executable directory.
- Updated `packages/opencode/src/project/project.ts` so a local opencode project DB/config file creates a project boundary before parent git discovery.
- Updated `packages/opencode/src/project/project.ts` so `dir\\bin\\opencode.json` and `dir\\bin\\opencode.jsonc` create a boundary for portable bundles launched from `dir`.
- Updated `packages/opencode/src/project/project.ts` so non-git and no-commit fallback projects use stable path-derived IDs instead of `ProjectID.global`.
- Removed config-level SQLite `account.db` creation and the unused opencode account/account_state project schema.
- Replaced `AccountRepo` persistence with process-local in-memory state for experimental console account routes.
- Added/updated tests in `packages/core/test/global.test.ts` and `packages/opencode/test/project/project.test.ts`.
- Fixed `_build.ps1` PowerShell 5 path joins so the portable bundle build completes.

Script output:

- `bun test --timeout 30000 test/project/project.test.ts`: passed, 38 pass (`cmd_runner` run `20260607T172739Z_0b43b725`).
- `bun test --timeout 30000 test/global.test.ts`: passed, 1 pass (`cmd_runner` run `20260607T095003Z_a1f469e3`).
- `bun test --timeout 30000 test/account/repo.test.ts test/account/service.test.ts`: passed, 26 pass (`cmd_runner` run `20260607T143800Z_18177818`).
- `bun test --timeout 30000 test/server/httpapi-experimental.test.ts`: passed, 3 pass, 1 skip (`cmd_runner` run `20260607T143800Z_6e017afb`).
- `bun typecheck`: passed (`cmd_runner` run `20260607T143800Z_421139e7`).
- `bun typecheck`: passed after the portable boundary fix (`cmd_runner` run `20260607T172739Z_642b7319`).
- `pwsh _build.ps1`: passed and produced version `10.0.98` (`cmd_runner` run `20260607T172921Z_c0f5d996`).
- Fresh portable launch from `bin_tst\\tst3`: prompt `2+2?` returned `4`; logs opened `bin_tst\\tst3\\.opencode\\data\\opencode.db`; no `bin\\account.db` or `bin\\.opencode` was created (`cmd_runner` run `20260607T173159Z_24d85141`).
- Restore-oriented relaunch from `bin_tst\\tst3`: logs reused project ID `c0e7496c66ae89d0c28c5d036a623b3f356c7761` and the same project DB (`cmd_runner` run `20260607T173918Z_cb0a119e`).

Final verification update:

- Initial final verification commands without `--shell cmd` produced PowerShell payload quoting errors in `cmd_runner`; those runs are not counted as valid verification evidence.
- `bun typecheck` from `packages/opencode`: passed (`cmd_runner` run `20260607T175919Z_f8978a24`).
- `bun typecheck` from `packages/core`: passed (`cmd_runner` run `20260607T175919Z_ff26610b`).
- `bun test --timeout 30000 test/account/repo.test.ts test/account/service.test.ts` from `packages/opencode`: passed, 26 pass (`cmd_runner` run `20260607T175919Z_7fb55528`).
- `bun test --timeout 30000 test/server/httpapi-experimental.test.ts` from `packages/opencode`: passed, 3 pass, 1 skip (`cmd_runner` run `20260607T175919Z_4bbad0bf`).
- `bun test --timeout 30000 test/global.test.ts` from `packages/core`: passed, 1 pass (`cmd_runner` run `20260607T175920Z_7f356544`).
- `bun test --timeout 30000 test/project/project.test.ts -t importFromDisk` from `packages/opencode`: passed, 3 pass, 35 filtered out (`cmd_runner` run `20260607T180249Z_61dcaddd`).
- `bun test --timeout 30000 test/project/project.test.ts` from `packages/opencode` hung before test output and was stopped (`cmd_runner` runs `20260607T175919Z_e92432da`, `20260607T180127Z_1665f17a`). The earlier full project suite pass after the boundary fix remains the valid full-suite evidence for this code path (`cmd_runner` run `20260607T172739Z_0b43b725`).
- `bun test --timeout 30000 test/project/project.test.ts -t "uses parent directory boundary when config lives in child bin"` hung before test output and was stopped (`cmd_runner` run `20260607T180249Z_6bd2d15f`).
- Runtime directory search found no `account.db` under `.opencode`, `bin`, `dist`, or `bin_tst`.

## 2026-06-08 Portable Continue Command

Reason: the TUI exit banner printed `opencode -s <session>`, but a copied portable bundle launched from `bin_tst\\tst3` needs `bin\\opencode.exe -s <session>` so the user does not accidentally run a different `opencode` from `PATH`.

Changes:

- Updated `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` to derive the continue command from the current executable instead of hardcoding `opencode`.
- Added command-path quoting for paths with shell-sensitive characters.
- Rebuilt the portable binary and copied it into `bin_tst\\tst3\\bin\\opencode.exe` for runtime verification.

Script output:

- `bun typecheck` from `packages/opencode`: passed (`cmd_runner` run `20260608T015744Z_ffa4700e`).
- `_build.ps1`: passed, smoke test version `10.0.100` (`cmd_runner` run `20260608T015813Z_c736b7a2`).
- Absolute portable invocation restored reported session `ses_15b15261fffe3zPa4pCOPoSrpM` (`cmd_runner` run `20260608T020116Z_d2bedc6d`).
- Exit banner printed `Continue bin\\opencode.exe -s ses_15b15261fffe3zPa4pCOPoSrpM` (`cmd_runner` run `20260608T020116Z_d2bedc6d`).
- Exact displayed command through `cmd.exe` restored the session and exited cleanly (`cmd_runner` run `20260608T020231Z_7a7f6fde`).
- Direct `cmd_runner` argv execution of relative `bin\\opencode.exe` is not equivalent to a user `cmd.exe` prompt and reproduced `Session not found`; that diagnostic run was stopped (`cmd_runner` run `20260608T020146Z_1b34a5e0`).

## 2026-06-08 Document Read Conversion

Reason: reading non-empty PDF/DOCX/PPTX files from `artifacts/` returned empty content because `convertDocument()` could not resolve `opencode-markdownify` and returned an empty string on failure.

Changes:

- Updated `packages/opencode/src/util/markdownify.ts` to search the real executable directory, executable-adjacent config directory, project `bin`, cwd `bin`, and source-checkout `bin` before development `dist` fallbacks.
- Updated `packages/opencode/src/util/markdownify.ts` to throw a clear document conversion error when the converter is missing or exits non-zero.
- Updated `packages/opencode/src/tool/read.ts` to classify `.pdf` as binary and reject binary bytes in text-like extensions instead of converting them through markdownify.
- Updated `packages/opencode/src/tool/read.ts` to resolve Windows drive-less absolute paths against the active project drive before read permission/stat checks.

Script output:

- `bun typecheck` from `packages/opencode`: passed (`cmd_runner` run `20260608T144234Z_74fcce27`).
- `convertDocument()` against all files in `artifacts/`: non-empty output for `Методические указания по курсовому проекту.pdf`, `Основные требования.pptx`, `Примерное содержание раздела Тестирование.docx`, and `Титульный лист.docx`.
- `bun test --timeout 30000 -t "rejects text extension files with null bytes" test/tool/read.test.ts`: passed, 2 pass, 126 filtered out (`cmd_runner` run `20260608T143539Z_205c3467`).
- `bun test --timeout 30000 test/tool/read.test.ts`: passed, 37 pass (`cmd_runner` run `20260608T144234Z_5dafabe4`).

## 2026-06-12 Provider Max Output Cap

Reason: qwen-like model metadata can report native output equal to the full context window, causing provider requests to send an impossible `max_tokens` value when input tokens are also present.

Changes:

- Updated `packages/opencode/src/provider/transform.ts` so `ProviderTransform.maxOutputTokens()` preserves explicit overrides and normal native limits, but caps pathological `output >= context` metadata to a context reserve.
- Added focused `ProviderTransform.maxOutputTokens()` regression tests in `packages/opencode/test/provider/transform.test.ts`.
- Updated `plans/20260612_cap_pathological_max_output_tokens.md` and `_development_plan.md` with completed verification.

Script output:

- `bun test --timeout 30000 test/provider/transform.test.ts`: passed, 148 pass (`cmd_runner` run `20260612T074312Z_c0e85514`).
- `bun typecheck`: passed (`cmd_runner` run `20260612T074327Z_7d464663`).

## 2026-06-12 Qwen Request Cap Verification

Reason: confirm the qwen/openai-compatible LLM request path sends a capped provider `max_tokens` value when model metadata reports native output equal to context.

Changes:

- Added a qwen-like request-body regression test in `packages/opencode/test/session/llm.test.ts` using the existing `alibaba/qwen-plus` fixture with an in-memory `output == context` override.
- Verified the mock HTTP capture receives `max_tokens == 20000` and less than the model context window.
- Updated `plans/20260612_qwen_request_cap_e2e_verification.md` and `_development_plan.md` with completed verification.

Script output:

- `bun test --timeout 30000 test/session/llm.test.ts -t "caps max_tokens for qwen-like"`: passed, 3 pass, 178 filtered, 0 fail (`cmd_runner` run `20260612T075720Z_e5b7a91e`).
- `bun typecheck`: passed (`cmd_runner` run `20260612T075744Z_64d9ca27`).

## 2026-06-12 Ordered Compaction Replacement

Reason: compaction rebuilt the active history by removing prior compaction pairs and appending them after the selected head, which could change cache-prefix order. Overflow replay also preserved an extra pre-replay tail even though the replayed user request is inserted after the summary.

Changes:

- Updated `packages/opencode/src/session/compaction.ts` so compaction selects from the ordered active history directly instead of hiding and re-appending previous compaction pairs.
- Changed regular compaction to preserve only the newest real turn as tail, placing the summary immediately before it.
- Changed overflow replay compaction to summarize all pre-replay history and preserve no extra tail, so the replayed request becomes the only post-summary turn.
- Updated `packages/opencode/test/session/compaction.test.ts` for single-latest-tail and overflow replay prompt-order coverage.

Script output:

- `bun test --timeout 30000 test/session/compaction.test.ts`: passed, 50 pass, 0 fail (`cmd_runner` run `20260612T094919Z_3921508d`).
- `bun typecheck`: passed (`cmd_runner` run `20260612T095402Z_abf22fa9`).

## 2026-06-12 Compaction Plan Maintenance

Reason: active compaction plans needed to reflect the current code state after ordered compaction and synthetic-tail changes.

Changes:

- Updated `plans/20260612_remove_synthetic_tail.md` so implemented items are checked and remaining test coverage gaps stay pending.
- Updated `plans/20260612_compaction_schema_diagram.md` to remove stale synthetic-tail write paths and include `CompactionPart.tail_count`.
- Moved completed `plans/20260611_compaction_written_then_gone.md` to `plans_completed/20260611_compaction_written_then_gone.md`.

Script output:

- Explore validation: clean (`task` run `ses_143a1e1e0ffeudqtu53z4RPjeM`).

## 2026-06-13 Compaction Skill Prompt Isolation

Reason: compaction was invoking the processor with `system: []` and appending the full compaction summary template as a user message. The normal system prompt should be passed through unchanged, while compaction formatting rules should live in deterministic skill content.

Changes:

- Extended `SessionCompaction.process` to accept the normal system prompt and pass it to the compaction processor.
- Updated `prompt.ts` so compaction tasks build and pass the same base system array used for normal processing.
- Split compaction prompt construction into static `<skill_content name="compaction">` template content plus a small dynamic user instruction for create/update summary context.
- Added regression coverage that verifies the template is not in `input.system`, the system prompt is preserved, and the compaction skill payload is present in `input.messages`.

Script output:

- `bun test --timeout 30000 test/session/compaction.test.ts`: passed, 51 pass, 0 fail (`cmd_runner` run `20260613T022803Z_32d575c5`).
- `bun test --timeout 30000 test/session/revert-compact.test.ts`: passed, 7 pass, 0 fail (`cmd_runner` run `20260613T022803Z_c99ceaf9`).
- `bun test --timeout 30000 test/session/compaction.test.ts -t "passes normal system"`: passed, 1 pass, 156 filtered, 0 fail (`cmd_runner` run `20260613T023216Z_a23632a8`).
- `bun typecheck`: passed (`cmd_runner` run `20260613T022803Z_7ca3d452`).
- Invalid verification attempts using cmd_runner's PowerShell wrapper produced payload quoting errors and are not counted (`cmd_runner` runs `20260613T022733Z_252b76c3`, `20260613T022733Z_817fdc50`, `20260613T022733Z_9cec454b`).
- A redundant solo compaction rerun was stopped after the full parallel compaction run had already completed successfully (`cmd_runner` run `20260613T023109Z_9f52d227`).

## 2026-06-13 Compaction Normal-Flow Integration

Reason: compaction used a separate `compaction.process()` path with a tool-less "compaction" agent — this broke semantic flow, switched the system prompt (different agent → different skills → different SHA256), and invalidated the provider's KV cache. Compaction should be a normal turn using the same agent, same system prompt, and normal processor path.

Changes:

- Created `packages/opencode/src/skill/compaction/SKILL.md` — compaction skill as a proper file with YAML frontmatter and anchored summary template.
- Registered "compaction" as a built-in skill in `packages/opencode/src/skill/index.ts`.
- Removed hardcoded `COMPACTION_SKILL_CONTENT` from `packages/opencode/src/session/compaction.ts`.
- Removed entire `compaction.process()` function (560 lines) and its service interface entry — no longer needed.
- Rewired compaction in `prompt.ts`: uses `lastUser.agent` (original user agent, not "compaction"), constructs identical system prompt, processes via normal `handle.process()`.
- `compaction.create()` now sets `agent: input.agent` (original agent) and includes a text part with the summarization instruction.
- Added `summary: true` on compaction assistant message — enables `filterCompactedEffect` boundary detection.
- Added `compaction.selectMessages()` call to set `tail_count` on the compaction part before processing.
- Added `bypassAgentCheck: false` to `SessionTools.resolve()` in compaction block.
- Added `format` / `json_schema` system prompt check for byte-identical system prompt parity.
- Removed `SessionProcessor` dependency from compaction layer (no longer needed).
- Removed 21 `session.compaction.process` tests, updated `create` test for 2 parts (text + compaction).
- All 31 remaining compaction tests pass, typecheck clean.

KV cache continuity:
- System prompt is byte-stable across entire session: same agent → `sys.skills(agent)` returns same content, no timestamps or mutable markers in `environment()`, date injected into user messages not system prompt.
- Providers see identical SHA256(system prompt) → prefix cache hits → minimum recomputation for appended compaction instruction + summary response.

Script output:

- `bun typecheck` from `packages/opencode`: passed.
- `bun test test/session/compaction.test.ts` from `packages/opencode`: 31 pass, 0 fail.
- `bun test test/skill/skill.test.ts` from `packages/opencode`: 10 pass, 0 fail (one flaky timeout passes on rerun).

---

## [2026-08-15] CoT semantic map experiment

**Reason:** Map the semantic structure of CoT reasoning — how the model's thinking
flows through a task (phases, jumps, revisits), instead of guessing from anecdote.

**Scripts:** `experiments/cot-semantic-map/` — `extract_cot.py` (DB → sentences.jsonl),
`embed_sentences.py` (BGE-bge-base-en-v1.5 on GPU, shim for torch.distributed-less build),
`build_map.py` (PCA 768→32, UMAP 2D, k-means phases, stats, self-contained `map.html`).

**Output:** 8804 CoT sentences from 467 messages / 6 sessions; embeddings (8804, 768);
10 semantic phases (k-means silhouette 0.085); trajectory stats: 290 phase transitions,
67 jumps, 96 revisits, median step 0.055 / max 0.427 of the map span.
Phase lexicons match real work topics: prompt.ts inspection, echo policy, summary
sidecar, cache modeling, compaction mechanics, transform blocks.

**Artifacts:** `experiments/cot-semantic-map/map.html` (interactive: hover = sentence
text, trajectory arrows = message flow, phase legend). `map_data.json` for replays.

---

## [2026-08-23] Fix request-diff false remove+add (DB-vs-model ID misalignment)

**Reason:** KV-cache diff logs (`{data}/log/*_diff_*.diff`) reported byte-identical
tool-result messages as "1 removed, 1 added" between consecutive requests in one turn
(e.g. `1787406857921_diff_mimo-v2.5-free_ses_fd663bc4....diff`, message #126 gaining
`id=msg_...`). Root cause: `modelMessageIDs` in prompt.ts was DB-indexed while
`modelMsgs`/`fromIndex` are model-indexed; `convertToModelMessages` expands an
assistant tool-call 1:N (assistant + tool roles), so every ID after the first
expansion shifted and tail messages got none. `messageKey()` then flipped between
content-hash and id keys → false remove+add. Diagnostic-only: wire payload unchanged.

**Change:** `Checkpoint.expandMessageIDs(ids, counts)` (checkpoint.ts) expands DB ids
to model positions with stable `id#k` keys; prompt.ts builds model-indexed IDs via
`toModelMessagesWithCountsEffect` for suffix/full-reconvert and counts for prefix;
request-diff.ts docstring states the contract. New regression test
`test/session/prompt-alignment.test.ts`: per-message conversion is payload-identical
to batch; diff between steps shows "2 added, 0 removed"; old behavior reproduces the
false positive. checkpoint.test.ts: 4 expandMessageIDs unit tests (caught a n==0 bug
in the first helper draft).

**Verification:** bun test checkpoint/request-diff/prompt-alignment green (25 pass),
tsgo --noEmit clean. Pre-existing failures exonerated via git-worktree baseline at
HEAD: session-undo-fossil 3/8 fail on BOTH trees (git/fossil subprocess timeouts);
prompt.test.ts "native mode transition..." fails identically on both — fixture picks
up user-global instructions ("You are Smit", Semantic Vector rules from ~/.codex)
instead of expected "Reasoning Mode"; timeout-class tests also reproduce on baseline.
Baseline worktree torn down after comparison.

## [2026-08-23] Undo/redo latency profile (session-undo-fossil)

**Reason:** User-reported regression: "undo/redo to selected message broke after some
update". Suite failed 5/8 under bun default 5000ms per-test timeout.

**Findings:** With `--timeout 30000`: 8 pass / 0 fail (46.31s total, ~5.8s/test).
Logic intact; failures were pure latency. Stage profile
(experiments/2026-08-23_undo_profile.test.ts): first snap.track ≈ 2.4s
(fossil auto-configure ~0.8s + clean init ~0.8s, fossil.ts:211/246/310),
subsequent tracks 0.5–0.9s, revert ≈ 0.9s. Raw fossil CLI smoke
(experiments/2026-08-23_fossil_smoke.ps1, via cmd_runner): 12 ops in 1216ms
(20–102ms/op) — app-side wrapper is 5–10x costlier per operation than raw CLI.
Fossil docs (external/fossil/fossil-src-2.28/www): temp dir = FOSSIL_TEMP→TEMP→TMP,
SQLite uses GetTempPath(); recommend excluding %TEMP%\fossil from antivirus scans
(server/windows/service.md). Binary resolution for tests: external/fossil/fossil.exe
(fossil.ts findFossil dir #3).

**Conclusion:** No logic regression in undo/redo at HEAD 5122ad0724. Perceived breakage
= seconds-scale latency (first-call init overhead + per-op spawn cost scaling with
worktree size). Options: raise suite timeout (immediate), cache/reuse auto-configure +
init across instances (prod fix), AV exclusion per docs.

## [2026-08-23] findFossil: prefer side-installer tools/ over build artifact

**Reason:** tools/ is the canonical distribution point maintained by the centralized
side installer; external/fossil is a build artifact fallback. All three current copies
(tools/, bin/tools/, external/fossil/) are byte-identical (md5 0bfd3c2c...), so this
is a resolution-order fix, not a behavior change today.

**Change:** fossil.ts findFossil() order now: repoRoot/tools → repoRoot/bin/tools →
execPath/tools → home/tools → repoRoot/external/fossil → PATH.

**Latency ground truth:** raw fossil per-process floor on Windows ≈ 80-130ms even for
trivial ops (info 87-130ms, status 79-93ms via tools/fossil.exe). In-app adds ~10-50ms
spawn overhead. One snap.track = info×2 + add + commit ≈ 0.5-0.9s for a single file;
undo = several infos + diff ≈ 0.7s minimum. Scaling with worktree size explains the
perceived "broken" undo in large sessions. Diagnostic timing stub added to runFossil,
measured, removed. Profiler test corrected to canonical SU-1 shape (patch parts are
required for revert targeting — without them revert is a no-op, which had produced
false v3 failures in earlier profiling runs).

## [2026-08-23] Undo scaling check: flat cost vs file count (user hypothesis confirmed)

**Reason:** User challenged the linear-scaling extrapolation: fossil should handle
1000 files as fast as one.

**Experiment:** experiments/2026-08-23_undo_scale.test.ts — SU-1 shape with a
1000-file bank across 10 dirs, single-file change per track.
Results: track#1 (full bank first snapshot) ≈ 2.6s; track#2/#3 with one changed
file on a 1000-file tree ≈ 0.45-0.5s (same as 1-file case); revert ≈ 1.4s;
assert ok, bank intact after undo. Fossil's checkout mtime cache makes cost
effectively independent of unchanged-tree size.

**Conclusion:** No scaling cliff. Undo/redo latency is bounded (~0.5s/track warm,
~1.5s/revert, plus one-time init on cold start). The user-reported real-session
breakage is therefore NOT explained by worktree size; next step is reproducing the
actual TUI undo-to-message scenario from a live session history.

## [2026-08-23] Mass-change rollback investigation — no product bug; experiment artifact

**Reason:** scale10k probe showed bank files surviving revert; user asked to dig in.

**Investigation:** Instrumented runFossil/checkoutTo/revertTo (full argv capture +
post-checkout state: fossil info/ls/changes/sql vfile/cat). Root cause of the probe
anomaly: snap.track([note.txt]) tracks ONLY given paths — the 1000-file bank was never
committed into any snapshot leaf, so checkout correctly left it untouched (vfileCount=1,
manifestBank missing). No fossil defect; raw replays (fossil_checkout_repro.sh,
fossil_replay6.sh, fossil_anchor_repro.sh) all restore correctly, including exact argv
sequences with --hash/--nested/anchor commits. Fossil per-process floor on Windows is
~80-130ms regardless of tree size; mass-change commit over 1000 dirty files ≈ 0.46s;
revert ≈ 1.4-2.5s on a 10k tree.

**Resolution:** All diagnostics removed from fossil.ts (diff = findFossil order only).
undo-fossil suite 8/8 pass @30s timeout; tsgo --noEmit clean. Real-session undo issues,
if any recur, must be reproduced from actual session history (patch.parts targeting),
not synthetic trees.

## [2026-08-23] ROOT CAUSE: vanished tracked path froze all snapshot tracking

**Symptom:** After rebuild, undo/redo dead, timeline empty in ALL sessions of the
worktree ("tracking commit failed" spam). stderr: `no such file:
plans/2026-08-22_compact-mstar-prior-limit.md` — an ancient plan deleted via git
outside fossil while the checkout cache still listed it; every subsequent
`commit --hash` aborted on ENOENT and track() returned the stale beforeHash,
freezing the tip (undo/redo/timeline all read from it).

**Fix:** Live repo healed manually (fossil rm + commit, tip advanced
2ca043c3→e99f0cca); product heal added to track() — parse vanished paths from
stderr, record deletions, retry once (framing: reconcile index toward disk+DB
truth, fossil = change tracker coordinated with session DB). Regression:
test/snapshot/fossil-track-heal.test.ts (addremove sweep → external delete →
leaf must advance).

**Commits:** 231cdfc3df (request-diff ID alignment), f21e3d8e8e (tools-first
resolution + docs), 4147dbbea1 (track reconcile + regression). Verification:
heal test 1/1; fossil-rollback+track isolation 9/9; undo-fossil 8/8 @30s;
tsgo clean. Note: full-directory parallel runs of test/snapshot/ interfere on
Windows (60s hangs) — run files individually.

## 2026-08-23 Boundary-crossing undo (compaction mask)
- **Root chain**: `plans/2026-08-23_undo_compact_concept.md` -> revert schema `crossing` manifest -> revert/unrevert/cleanup mechanics -> trial T3/T4.
- **Changed**: `session.ts` (Revert schema + messages visibleOnly passthrough + interface), `revert.ts` (manifest build/flip in revert, inversion in unrevert, manifest-aware fold in cleanup), new `test/session/revert-crossing.test.ts`.
- **Verification**: crossing trial 1 pass/0 fail; session-undo-fossil + fossil-track-heal 9 pass/0 fail; `tsgo --noEmit` clean. Commit: feat(session) boundary-crossing undo.
- **Note**: trial simulates the mask via info.compacted directly; SessionCompaction force-fold with zero summaries refuses to fold (summaries>=1 guard) - real compaction integration covered by T5/T6 fold semantics, untested here.
- **Follow-up (same day)**: crossing fold bug - cleanup() loaded visible-only and missed the flipped-hidden discarded future; fixed with visibleOnly:!crossing. T5/T6 trials added (deep-archive remodel): fold deletes only manifest-visible future; second crossing undo resurrects; redo anchors to that undo's pre-state. Commit 59e2791458.

## 2026-08-23 Undo/redo/timeline wedge on real repo (v10.0.878)
- **Symptom**: undo ok; redo dead; subsequent undo/timeline-revert dead; no errors logged; unrevert POST never completed.
- **Root cause A**: fossil spawned with open stdin pipe; `fossil checkout --force` waits for stdin EOF (proven: `sleep 30 | fossil checkout` = 30.4s) -> hang -> per-repo lock wedges all later fossil ops. Fix: `stdin: "ignore"` (pattern already used by ripgrep.ts).
- **Root cause B**: ignore-glob bare names (node_modules, .git) cover only worktree root; nested copies walked by `fossil extras` (20s+ no finish). Fix: expandGlob adds star-prefixed twin for slash-free patterns.
- **Verification**: repro restore(e99f0cca) 20s-timeout -> 2.9s COMPLETED; extras instant; tsgo clean; crossing+undo-fossil+track-heal 11/11.
- **Side finding**: `bun run dev serve` dies with TDZ ReferenceError at src/agent/agent.ts:634 (defaultLayer before init) - separate issue, built binaries unaffected.

## 2026-08-23 Dev-serve TDZ crash (agent.ts:634)
- **Symptom**: `bun run dev serve` dies instantly: ReferenceError "Cannot access 'defaultLayer' before initialization" at agent.ts:634 (Plugin.defaultLayer). Built binaries unaffected (bundle order masks it).
- **Root cause**: module-eval cycle Plugin -> Session -> message-v2 -> sync -> project/instance -> bootstrap -> Plugin (and Plugin -> ... -> Agent). agent.ts read Plugin.defaultLayer at module top level while Plugin was still mid-evaluation.
- **Fix**: Agent.defaultLayer wrapped in Layer.suspend - Plugin.defaultLayer now read at layer-build time (pattern already used by provider/auth, provider, compaction, llm).
- **Verification**: `index.ts serve` now boots: /doc returns OpenAPI, /global/event 200. tsgo clean.
- **Known latent (NOT fixed, entry-order dependent)**: importing @/session/message-v2 as the FIRST module still TDZs ("Assistant") via cycle message-v2 -> sync -> instance -> bootstrap -> plugin -> session.ts:459 (MessageV2.Assistant.fields.error at eval time). No production entry hits it (serve verified). Proper fix = Schema.suspend at session.ts:459 or extracting the error field to a leaf module; both change bus-schema AST shape - needs a dedicated decision.
- **User-verified (oracle)**: rebuild with c7c71bb + 1115ab0 - undo/redo, timeline navigation, fork all confirmed working on real workflow. Fossil wedge cycle closed.

## 2026-08-24 Foldable summaries/compact rows + latent TDZ closed
- **Real-compaction crossing (T-Real)**: trial drives SessionCompaction.force with a genuine assistant summary row (T2 guard satisfied): summary row resurrects on crossing undo, message* hides and is physically deleted at fold, second crossing works. Guard summaries>=1 kept (2026-08-16 incident invariant).
- **TDZ closed**: session.ts:459 error field via Schema.suspend; message-v2-first and plugin-first entries both load clean; resolution-time zod shape unchanged.
- **TUI banner**: existing boundary banner auto-covers crossing (boundary row resurrects into view); counter now excludes synthetic message* row via sync.data.part.
- **Verification**: crossing 3/3, full battery (crossing+undo-fossil+track-heal+compaction) 83 pass/0 fail, tsgo clean. Commit c050322.
- **Timeline crossing UX**: compacted rows marked [compacted] in the timeline picker with boundary-crossing hint; crossing undo from TUI = Timeline -> message -> Revert (server unfiltered walk + resurrect banner already in place). Commit with marker; tsgo clean; smoke 74/0.
- **Mechanical compact (critical)**: removed usable(model) gate from Layer-2 cadence — degraded windows used to disable folding entirely (provider overflow errors); compact now fires on fixed 64K content cadence, threshold floor window-independent. summaryWindowLimit machinery deleted; docs/compaction.md contract rows updated. Suites 101/0, tsgo clean.
- **Scrollbar bounce (TUI)**: live chip resized the transcript viewport by 2 rows on every live-edge crossing; reserved the chip row so layout is stable. Isolated OpenTUI wheel repro added (core mechanics clean). tsgo clean; repro 2/0.
- **Tracker paging (TUI)**: sessions >100 messages now load older pages on scroll-up (cursor before-pages, scroll anchoring, eviction cap 400). Archive rows intentionally excluded (visibleOnly) - collapsed groups next. tsgo clean.
- **Timeline collapse (TUI)**: message*/L1 rows collapsed into one expandable entry (+/- keys or select) - navigation decluttered; work rows untouched. tsgo clean.
- **Hotfix boot hang**: Schema.suspend in session.error bus event crashed Effect derivation at serve boot ("unsupported effect schema: Suspend") - worker died silently, TUI hung (build 880). Replaced with plain optional-any; loadOlder export level fixed. serve boots, probes OK, suites 109/0.
- **Operation indication**: summarizing status variant + spinner labels (working/writing summary/compacting history) + session.compacted toast. SDK codegen drift found (fresh spec drops Provider/Model/Event/McpStatus) - regeneration reverted, separate slice. tsgo clean; suites 101/0; serve boots.
- **Transcript collapse (TUI)**: consecutive message*/L1 rows render as one [+] header; click expands; timeline navigation auto-expands. Revert banner precedence preserved. tsgo clean; suites 74/0. cmd_runner BOM payload bug reported (workaround: direct bash).
- **Collapse fixes**: threshold 2+ rows (singles stay inline - no more phantom mid-turn collapse); explicit [-] control after expanded runs via displayItems flattening. tsgo clean; 74/0.
- **Cache/compact rework (2026-08-25)**: sidecar s request now uses the SAME provider cache key as the trunk (session:provider) — ":sidecar" suffix forked the namespace, every summary request ran full-price (observed 0 hit / 132K miss). T2 refusal + T4 (≥2 sidecars) gate removed: zero summaries → tail-only m* (last ~32K tokens of messages) — manual /compact works on fresh sessions. Compact trigger = window fill: usable(model) = limit − 32K response − 10K overhead, checked pre-send (hasSpareOutput force) and at stop; fixed-64K target was pointless (m* ≈ 64K replaced 64K of work, zero savings). selectRecentTail: 32K cap on no-boundary tails (whole-message granularity, floor-preserving). Suites 74/0, tsgo clean.
- **Empirical validation (2026-08-25, Alexander)**: after 2-3 compaction cycles, code re-localization via git search remains "phenomenal" — the Exact-handle chain (from_id/to_id → checkpoint → filediff/codegraph) survives folds; precision is grounded by session-read re-reading, not recall. Confirms the presence/access split under real multi-fold load.
- **m* recovery line (2026-08-25, Alexander)**: m* now closes with "Use messagesearch, sessionread and dbread to restore missing facts." — single end-placed pointer (earlier top-placed recipes caused spirals; end placement keeps m* framed as work state, not a recovery manual). Suites 74/0, tsgo clean.
- **Empirical validation (2026-08-25, Alexander)**: the closing m* recovery line ("Use messagesearch, sessionread and dbread...") noticeably improves long-horizon task efficiency — gap-filling becomes a sanctioned routine instead of improvised guessing.
- **TUI hang root fix (2026-08-26)**: `needsContentCompaction is not defined` — import block in `prompt.ts` had a duplicated `summaryNeedsCompactFirst` instead of the real symbol; stop-cadence `maybeCompactCadence` threw ReferenceError after every first finish-step, runLoop died without status idle → eternal spinner (log evidence: `_1C_Project` ses_fc659bdc6ffe, l-0113). One-line import fix. tsgo clean.
- **m\* ≠ increment (2026-08-26, Alexander)**: Layer-1 counter `computeOpenWindowTokens` counted the folded star (~len(m\*)/4 ≈ whole 64K interval) as new work when no checkpoint boundary existed → s fired immediately after every compact. Now the leading star chain is skipped without boundary; fold never arms the cadence. Pinned test inverted ("star alone ≥ interval") replaced with two contract tests; compaction+summary-cadence 99/0. tsgo clean.
- **Pre-send no-progress guard (2026-08-26)**: `hasSpareOutput` fail → force fold → still failing AND nothing folded → loud `NamedError` with used/usable numbers instead of infinite silent `continue`. Unreachable on ≥256K windows by the m\* bound (≤32K summary bodies + ≤32K recent tail + tools/schema ≈ ≤124K vs 224K gate); reachable on small-window models / oversized single input. Message/comment state the 32K+32K invariant. tsgo clean.
- **Docs sync (2026-08-26)**: compaction.md contract table — "Recent tail ≥ ~16k" stale row corrected to `RECENT_MIN_TOKENS` 32 768; two new contract rows (m\* not an increment; pre-send guard), pre-send diagram branch, token-formula row for the post-fold m\* bound; session-memory-graph claim ledger +2 Exact rows.
- **Test-debt audit (2026-08-26)**: full `test/session` = 621 pass / 40 fail parallel; idle-machine serial rerun isolates deterministic reds: prompt.test.ts ×36 (28 timeouts pinning PRE-window-fill cadence choreography — e.g. handoff test expects sidecar at 22K open vs threshold 65_536; subtask-metadata trio pins pre-`7d39847b4b` model resolution), revert-compact ×2 (`revert` undefined vs object — pre-crossing undo semantics), snapshot-tool-race ×1, message-v2 fromError ×1. Baseline stash confirmed reds pre-exist today's fixes. Backlog, not regressions of 2026-08-26 changes.
- **m\* design rationale recorded (2026-08-26, Alexander)**: prior stars never enter the new star (pointer-only `Prior message*` chain + from_id/to_id handles); m\* is a synthetic single-message construct for rollback atomicity, O(1) fold cost and KV-prefix stability — the earlier piecewise assembly caused bugs, slowdowns and cache breakage. compaction.md "Prior m\* never enters" block + memory-graph ledger rows.
- **Wire-name unification in kernel (2026-08-26, Alexander)**: tool names in kernel texts normalized to wire ids (`canonicalName` strips all non-alphanumerics; models confuse `-`/`_`): reasoning_exit→reasoningexit, plan_enter/plan_exit→planenter/planexit, multi_edit→multiedit, patch_apply→applypatch (real registry id verified), session-read→sessionread. Sources fixed (fragments 00_map/01_gates, core_schemas.yaml, 20_specs_agents, 24_specs_policies, 27_runtime_dict), regenerated dist staging + _kernel_precompiled.py, promoted to live reasoning_prompt.txt; anthropic.txt TodoWrite→todowrite. Pipeline lesson: precompiled fast-path is captured at import — regenerate in two processes (write_precompiled_kernel → write_reasoning), then manual promotion of dated staging to undated dist + package txt. Verification: conformance Self-test PASSED, pytest prompts_kernel/tests 489/0, bun system-compose 13/0, leftover separator-tokens = 0.
- **Persona audit fixes (2026-08-26)**: audit of all 14 prompt/*.txt vs kernel constitution (reasoning_prompt.txt) - contradictions and dead code removed from personas only (kernel text untouched this round). Deduplicated YAML-meta vs prose double-rendering (frontmatter parser consumes models/family only - verified session/system.ts parseFrontmatter); codex duplicate Glob/Grep line; codex 250-line chunks -> READ_ENTIRE_FILE alignment (<100KB whole-file); codex anti-citation constraint dropped in favor of path:line (kernel code_refs); gemini raw `&` backgrounding -> platform background-job mechanism (@CONSTITUTION_BLOCKS unisolated toolchains); gpt multi_tool_use.parallel/commentary-final channels/frontend React-vendor specifics removed; beast fabricated .github/instructions memory section removed, emoji todo -> markdown [x], proactive .env creation -> propose-and-approve; copilot-gpt-5 rewritten (~15K->2.7K bytes): dead Copilot tool names (semantic_search/grep_search/file_search/get_changed_files), KaTeX, outputFormatting printed-codeblock template vs "never print codeblocks" self-contradiction resolved. Deliberately KEPT: trinity one-tool-per-message (model-specific tuning), verbosity caps (per-family UX). Personas 43K -> 30K bytes (-30%). Verification: frontmatter parse check 9/9 registry entries, bun system.test.ts 22/0, system-compose 13/0.
- **Test-debt diagnosis (2026-08-26, 4 parallel scouts)**: (A) prompt.test.ts timeout cascade is fixture-infrastructure: bun timeout abandons fibers WITHOUT interruption; abandoned fiber holds global tmpdirInstanceLock(1) -> every later test in file starves at uniform 3s. Hardened test/lib/effect.ts run(): inner Effect deadline (budget-500ms) with forkChild+raceFirst+Fiber.interrupt so scope finalizers release locks. (B) Layer-1 suite: tests calibrated for REMOVED window-dependent threshold - scripted content (~22K open) never reaches fixed 65_536, and summaryNeedsCompactFirst pre-flight folds before capture on 100K-window fixtures; two llm.calls=0 are DISTINCT: budget test hits b47680b6f6 pre-send throw pre-HTTP; post-stop-restart test exposes MISSING restart-time due-summary injection in runLoop (early terminal-turn break prompt.ts:1822-1832 precedes any captureDue). Fix prescriptions per test recorded in ClusterB transcript (history). (C) Subtask-metadata trio = REAL REGRESSION: provider.getModel throws inside Effect.fn -> DIE not typed failure; unregistered child model dies through task.ts laundering catch into SUCCESS-with-sentinel, handleSubtask error branch unreachable; contract {error status + metadata{sessionId,model}} structurally unreachable. Proper fix = typed ModelNotFoundError + stop laundering + stamp hoist + tools.ts precedence (fixed: output ?? precedence) - DEFERRED: typed-failure ripple touches ~6 never-channel consumers, needs dedicated slice. Interim: backfill sentinel metadata on handleSubtask !result branch. (D) message-v2 fromError lacked ContextOverflowError passthrough (pre-send real instance fell to Unknown) - FIXED with round-trip case, 34/0. revert-compact sequential x2 = stale pre-redo-stack pins - rewritten to walk-unrevert-until-clear, 7/0. snapshot-tool-race = REAL tension: bounded track(files=[]) no-ops when only bash mutated files (changedFiles covers edit/write only) -> equal step snapshots; options: include bash/cmd in mutation tracking (perf: full reconcile per such step) vs rescope test - NEEDS PRODUCT CALL.
- **Option-1 snapshot reconciliation (2026-08-26, Alexander)**: bash/run/task/pipeline steps without product-write changes now run full fossil addremove reconcile at step-finish and pre-patch commit (bounded track([]) was a silent no-op returning beforeHash -> equal step snapshots, "bug: tracking commit failed" noise). Snapshot-race test rescoped to the documented boundary: bash-only mutations are Fossil-undoable but excluded from Summary Exact session_diff; suite 1/0 green. tsgo clean.
- **Lifecycle debug session (2026-08-26)**: instrumented runLoop/pre-send chain end-to-end for "loop sets status to busy then idle". Facts: loop fiber reaches busy-set, hydrates messages, resolves lastUser, then exits SUCCESSFULLY without ever reaching model-ready/send - no break probe fires, no defect surfaces. The successful early exit path is not identifiable via console instrumentation (Cause.pretty of interrupt-only cause prints empty). Requires interactive debugger session (bun --inspect + DAP) stepping ensureRunning/runLoop pre-send region. All [dbg] probes removed from src/*; representative test restored clean. Hardened runner kept: inner deadline interrupts fibers, fixture locks release (verified - cascade starve pattern gone, each red now fails independently at its own budget).
- **Lifecycle debug session part 2 (2026-08-26)**: queued-caller cancel test instrumented end-to-end. Findings: NON-DETERMINISTIC dual stall mode - (mode1) prompt.cancel hangs inside runner.cancel chain (no branch traces fire), (mode2) cancel completes, state->Idle, but BOTH child fibers (superseded A + queued B) never settle even though runner-level interrupts/Deferred completions are wired per design (runner.ts:231-240). Console forensics exhausted; requires interactive debugging with async stack traces (bun --inspect + DAP adapter) focusing on SynchronizedRef.modify serialization in effect/runner.ts and Deferred completion ordering between finishRun/complete() and awaitDone catchTag('RunnerCancelled'). Affected tests: cancel-with-queued-callers(30s hard hang), concurrent-loop-callers x2, prompt-submitted-during-active-run, keeps-stored-part-order(async file resolution). All pre-exist today's changes (present in every baseline since rerun2). Budgets raised 3s->30s separately which fixed the other ~22 timing reds permanently.
- **native-mode identity pin updated (2026-08-26)**: "Reasoning Mode" literal exists ONLY in the test - no production source emits it since persona/kernel rework. Parity assertions (system messages toEqual, tools toEqual) are the actual stability contract and pass; replaced obsolete marker assertion with kernel-root presence (GATED_WORKFLOW). Suspected 7d39847b4b regression CLEARED. prompt.test.ts now 35 pass / 6 fail / 13 skip.
- **Landscape instability note (2026-08-26, late)**: same-tree full prompt.test.ts reruns diverge wildly across days WITHOUT semantic changes between them - rerun6 (post-budgets): 34 pass / 7 fail; rerun7 (post runner-hardening + relic-cut + native-pin): 8 pass / 33 fail where 33 failures are ALL self-inner-deadline hits incl trivially-fast specs (unknown-agent-typed-error, filenames-with-hash). Signature: each failure burns its FULL inner budget stuck PRE-REQUEST inside provideTmpdirServer boot / first-loop send, i.e. environment-dominated cold-start latency (fossil+sqlite+WAL subprocess init on loaded disk), NOT logic regressions from the 17 commits. Conclusion: lifecycle red-set size is machine-load dependent; the stable behavioral core is the ~7 named reds from rerun6 analysis (queued-caller dual-stall, metadata trio, native-mode identity [now fixed], keeps-part-order). Next lever when resuming: profile provideTmpdirServer cold boot (which subprocess/init eats seconds) or move fixture boot off the assertion budget entirely; do NOT add more code changes chasing the moving number.
- **Metadata trio RESOLVED (2026-08-26)**: root cause chain = getModel throw-die inside Effect.fn -> defect escapes task.ts laundering catch -> handleSubtask catchCause converts to error tool state; missing piece was metadata preservation, delivered via sentinel-backfill enrichment extracting REQUESTED {providerID, modelID} from ModelNotFoundError.data (strict pair, suggestions dropped). Subtask trio 3 pass / 0 fail. Provider throw->typed-fail conversion EXPERIMENTED and ABORTED: widens Interface.getModel error channel causing ripple through SessionPrompt.Interface E=never surfaces (~6 sites incl agent.ts capability resolver); recorded as future refactor if die-semantics ever block real use-cases (current defect path is functionally correct end-to-end).
