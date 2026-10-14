<!-- intention: фиксы GLM-кеша проверены только на готовом коде -> независимый измерительный скрипт квалифицирован до живых запросов и наблюдает кеш напрямую -->
<!-- goal_sv: independent-probe 0.40, cache-observation 0.35, controlled-input 0.25 -->
# Независимый тест кеша GLM-5.3-Flash

## Направление и границы
План поддерживает `plans/MASTER_PLAN.md`, Goal level 0: измерительный инструмент,
который может опровергнуть заявление об исправлении, вместо проверки готового кода.
Запрос владельца: «надо сдлеать вообще независимый скрипт тест перед тем как что либо куда слать»;
дополнение: заголовки OpenCode-Go, ключ из `bin/auth.json`, далее обычный живой тест.
Инструмент — Python standard library; без импортов OpenCode/SDK, без его gateway,
без настоящих сессий/БД. Auth читается только в память, никогда в argv/env/отчёт.
Живой опыт — отдельные контрольная и experimental сессии, неизменные тело/заголовки
внутри каждой серии. Retention меняется только между сериями; разные session affinity
оставляют routing альтернативой, поэтому пара серий сама по себе НЕ доказывает эффект retention. Ответы и часы
определяют наблюдения; точный TTL без серверного сигнала не заявляется.

```yaml
Keywords: independent-probe 0.40, cache-observation 0.35, controlled-input 0.25
Semantic dominant: Квалифицировать независимое измерение кеша до отправки живых запросов.
md5: c85276a390ed4bfda1207e68543f9c02
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence / claims
- ✓ CONFIRMED (чтение `session/llm.ts:933-963`): x-opencode-session/request/project/client,
  x-request-id/session-id/session-affinity и User-Agent — контракт заголовков.
- ✓ CONFIRMED (структурное чтение JSON, без значений): bin/auth.json содержит
  opencode-go.key; исходный файл остаётся нетронутым.
- ✓ CONFIRMED (git/source): старые тесты фиксировали форму параметров, а не удержание.
- ✓ CONFIRMED (живой провод, `retention-live/01_response.bin` + report.json): HTTP 400 `[unsupported_parameter] "prompt_cache_retention" is not supported by this endpoint; use "prompt_cache_options"` — серверное слово, дословно.
- ✓ CONFIRMED (живой провод, `control-live/report.json`): немедленный повтор побайтно идентичного тела — observed_miss, `cached_tokens=0` и `cache_write_tokens=0` при `prompt_tokens=2617`; прогретый кеш через независимый путь не квалифицирован.
- Unknown: причинный эффект retention и время жизни живого кеша. Falsifier:
  независимый HTTP-ответ с usage при неизменном запросе после измеренной паузы.

## Smoke Tests
Предсказания: тест существующего отсутствующего инструмента — EXPECTED_FAIL;
локальный HTTP cold/hit/expired, отсутствие usage, 400, таймаут, редирект,
UTF-8 и отсутствие внешнего запроса без --live — PASS после реализации.
Проверять полученные сервером байты и заголовки, а не return transport.
Живой контроль и 24h: результаты diagnostic, не предсказанный PASS; нет usage → Unknown.
Повторные хиты могут продлевать sliding cache: отдельные независимые серии для каждого idle.

## Envelope / binding
ALLOW на пользовательском запросе: READ, PLAN_WRITE, MODIFY_CANDIDATE,
EXTERNAL_EFFECT (только api OpenCode-Go, максимум 12 запросов, output cap 128/запрос).
Пути: этот план; experiments/2026-10-14_independent-glm-cache-probe/**;
архив эксперимента, _progress_log.md (своя запись), docs/README.md (ссылка),
docs/independent-glm-cache-probe.md, generated-body MASTER_PLAN (renderer only).
Обязательная сборка: только кандидат dist/.temp штатным _build.ps1.
Запрещено: изменения bin/, kernel, provider source, существующих сессий;
секреты в отчётах; автоматические повторы сетевых ошибок.
Бюджеты: steps=35, tools=60, loops=3, depth=2, time_budget_ms=1800000.
Откат: удалить только созданные файлы; живые запросы необратимы, их не повторять.

## Tasks
- [x] T1 standalone script и локальная HTTP-квалификация. ✓ CONFIRMED: parent run 20261014T084252Z_4ab19fe2, 15 tests/0 failures, complete log, exit0; script SHA256 5e3b33650fbbb0b6a3c7d0a4c72428e3d0f0346594705b77d3cbccdee0e9ddef. <!-- sv: independent-probe 0.60, controlled-input 0.40 -->
- [x] T2 независимый readback/негативные контроли PASS; живые серии ИСПОЛНЕНЫ 2026-10-14. ✓ CONFIRMED (report.json + артефакты + runner state): control ses_5380fe108dfd41eeb9aefe61f4f59165 — 2 запроса (холодный MISS; немедленный повтор тех же байтов MISS, cached_tokens=0/cache_write_tokens=0, prompt_tokens=2617), инструмент остановился по контракту, idle-стадия не достигнута; retention ses_71b2f8eaa37a4205ac62f954bf2a7da6 через cmd_runner 20261014T093941Z_85024ef6 — 1 запрос, HTTP 400 unsupported_parameter (сервер отвергает prompt_cache_retention и называет prompt_cache_options). Живых запросов 3/12; оба расхождения предсказаний зафиксированы. Артефакты: experiments_history/2026-10-14_glm-cache-live/ (+ scratch в experiments/). <!-- sv: live-probe 0.45, unsupported-parameter 0.35, warm-cache-miss 0.20 -->
- [x] T3 инструкции, полные evidence, штатная сборка и архив. ✓ CONFIRMED: docs/independent-glm-cache-probe.md + индекс; experiments_history/2026-10-14_independent-glm-cache-probe/; build 20261014T084439Z_c55b15a0 exit0, bytes_dropped0, truncatedfalse, dist candidate10.0.1330. Scoped commit именует этот план, Git readback фиксируется после коммита. <!-- sv: evidence 0.50, continuity 0.50 -->

## SVM
turn_id: independent-glm-cache-probe-2026-10-14; parent_turn_id: null;
goal_hierarchy: level0 инструментальный тест кеша; master_plan: этот файл.
oracle_vector: baseline EXPECTED_FAIL module missing; qualification PASS (15 tests, повтор t41 2026-10-14);
live EXECUTED: control 2 запроса (MISS/MISS), retention 1 запрос (HTTP 400 unsupported_parameter); TTL не измерен.
Residual: (1) квалификация прогретого кеша при префиксе заметно больше 2617 токенов;
(2) схема prompt_cache_options (серверный хинт); (3) wire-захват продуктового glm-запроса.
Lift signal: снят — credentialed HTTPS запуск исполнен в том же envelope.
Живые запросы необратимы: не повторять; повтор опыта — с новыми префиксами/ключами.
Долгий срок удержания будет доказан только фактической паузой нужной длины.

COMPLETED: instrumental acceptance T1 PASS; live acceptance T2 ИСПОЛНЕН — живой опыт доведён до контрактных терминалов инструмента, наблюдения и расхождения зафиксированы.
Product-source actual_diff=none; bin/ не изменён; штатная сборка не запускалась — source-изменений нет (явное исключение задания).
Живых запросов 3/12, сетевых ретраев нет. TTL и эффект retention остаются Unknown: прогретый кеш не квалифицирован — survival-эксперимент недостижим при этом теле.
Residual: prompt_cache_options; минимальная кэшируемая длина; продуктовый wire-захват (мотив — здесь не измерялся).
План переведён в plans_completed/ этим изменением; MASTER_PLAN перерендерится (renderer only).
Project-wide SUCCESS не заявляется: полный чужой portfolio audit не делался.
