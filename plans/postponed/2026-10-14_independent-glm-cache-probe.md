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
- [~] T2 независимый readback/негативные контроли PASS; живой warm/idle тест BLOCKED: обе exec_command CreateProcess отклонены automatic policy (blocked by policy), причины подробнее нет. Процессы не запущены, live outputs отсутствуют. <!-- sv: cache-observation 0.60, controlled-input 0.40 -->
- [x] T3 инструкции, полные evidence, штатная сборка и архив. ✓ CONFIRMED: docs/independent-glm-cache-probe.md + индекс; experiments_history/2026-10-14_independent-glm-cache-probe/; build 20261014T084439Z_c55b15a0 exit0, bytes_dropped0, truncatedfalse, dist candidate10.0.1330. Scoped commit именует этот план, Git readback фиксируется после коммита. <!-- sv: evidence 0.50, continuity 0.50 -->

## SVM
turn_id: independent-glm-cache-probe-2026-10-14; parent_turn_id: null;
goal_hierarchy: level0 инструментальный тест кеша; master_plan: этот файл.
oracle_vector: baseline EXPECTED_FAIL module missing; qualification PASS (parent 15 tests);
live verdict NOT_RUN (launch rejected by runtime policy).
Residual: независимый живой warm/idle опыт. Lift signal: runtime policy допускает
credentialed HTTPS launch к OpenCode-Go в указанном envelope; авторизация владельца уже есть.
Не повторять запуск и не менять маршрут ради обхода отказа.
Долгий срок удержания будет доказан только фактической паузой нужной длины.

## Closure
BOUND STOP / BLOCKED: instrumental acceptance T1 PASS, live acceptance T2 NOT_RUN.
Product-source actual_diff=none; bin/ unchanged by this task. Продвижения кандидата нет.
Независимый explorer проверил постановку: убраны утверждение sliding TTL и причинная
интерпретация одиночной A/B пары; родитель перечитал исходные pins. Полный accepted
PORTFOLIO_AUDIT чужих completion не получен, project-wide SUCCESS не заявляется.
MASTER renderer21plans включил этот план, head SHA256 сохранён:
fb80b65370bd296d9214871df7b4abff1e4954fc3ac2d4d1633a0dd1885427af.
После переноса blocked-плана карта повторно рендерится; baseline грязных файлов сохранён.
