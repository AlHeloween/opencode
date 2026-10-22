<!-- intention: Haiku в OpenCode даёт длительные паузы, в omp с загруженным kernel пользователь наблюдает быстрый ответ -> воспроизводимое сравнение actual запросов и изолированных факторов, с установленной областью причинного вывода и непокрытым остатком -->
<!-- goal_sv: controlled-latency,wire-equivalence,protocol-grounding,causal-boundaries -->
# Haiku: контролируемое сравнение OpenCode и omp

Состояние: DRAFT → ACTIVE для ограниченного исследования. Product repair, изменение пользовательских настроек и promotion в этот план не входят.

```yaml
Keywords: controlled-latency 0.35, wire-equivalence 0.30, protocol-grounding 0.20, causal-boundaries 0.15
Semantic dominant: Найти измеренные различия OpenCode и omp без переноса локального PASS на сквозную работоспособность.
md5: 81e70d3af5c64b8292d15e6f370a49bc
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```
<!-- subgoal: s4-model-boundary — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S4 -->

## G0: намерение и границы

USER_REQUEST: «Я только что проверил на omp, тоже работает быстро. Мы явно что-то делаем не так, надо провести исследование». Уточнение: kernel в omp загружен. Желательный результат — установить причину различия на воспроизводимых сравнениях; наличие kernel не подменять отсутствием kernel.

SVM: turn=`haiku-omp-20261016-01`, parent=null; goal_hierarchy=OpenCode turn-loop latency → Haiku → OpenCode/omp comparison. goal_vector=this plan + acceptance ниже. task/evidence/oracle fields наполняются измерениями, не предположениями.

PLAN_STRATEGY: [MASTER_PLAN.md](MASTER_PLAN.md), hand-owned Goal level0 — mechanical continuity, observable state и turn-loop/stall прежде новых поверхностей. Contribution: установить фазы задержки и условия сопоставимости runtime. Чужой portfolio данным исследованием не квалифицируется.

BOOTSTRAP/G4: запрос разрешает READ, PLAN_WRITE, MODIFY_CANDIDATE и bounded диагностические API calls к выбранному пользователем Haiku. Scope: собственные `experiments/2026-10-16_haiku-omp-compare/**`, public-safe archive того же имени, этот план и progress/index routing. Runtime sessions сравнения создаются отдельно от owner sessions. Общие config/credentials/source/kernel/bin не меняются. Credential только в памяти; никакой secret output/args/files/env. Никаких tools, способных изменить проект, в диагностической модели.

Bounds: step_budget=60, tool_budget=90, loop_budget=3, depth_budget=2, time_budget_ms=2400000. Срезы детей резервируют суммарно 30 tool calls внутри root90. Не более 8 inference calls, максимум 8192 output tokens и 90000ms на call; исходные пользовательские calls с cap125000 повтором с меньшим cap не объявляются. До сети — deterministic fixture qualification, prediction или diagnostic classification каждого arm. Оригинальные probes с cap125000 могут быть capture-only без отправки.

## G1: settled / open / next

✓ Наблюдения текущего исследования:

- Git branch Local_Development, HEAD research commit `5b3f56f446`; чужая dirty work сохранена.
- Actual omp18.11.1; user config default `anthropic/claude-haiku-5-5:max`, свежая session model/thinking entries подтверждают Haiku/max.
- Omp session first response: ~10.2s, TTFT~7.26s, input/cache75315, output724. Последующая session содержит compaction и abort: скорость первого ответа не равна успешному выполнению задачи.
- OpenCode historical live session20:08–20:17Z: Haiku5.5/max/adaptive/cap125000/h2. Второй шаг143.4s: thinking28832, интервал reasoning126.6s; инструменты13.6s. Сам интервал не доказывает непрерывные вычисления провайдера.
- Stored signed-empty reasoning отсутствует в последующих outbound bodies. Это подтверждённая потеря replay; влияние на latency пока UNKNOWN. Первый request без предшествующего reasoning — отрицательный контроль против универсального объяснения replay.

Текущее состояние после раунда: ✓ pre-send capture installed CLI и матрица выполнены,8/8 calls израсходованы. Open: owner transmitted wire/auth/extensions/MCP parity, отдельный причинный компонент, continuation latency. Next: qualification ремонта harness, затем новый bounded2×2 system×tools; не повторять израсходованную матрицу. Подробности и receipt — CLEAN_NEXT_STATE ниже.

Primary receipt locators: omp `C:/Users/Alexander/.omp/agent/sessions/--d--zPython-opencode--/2026-10-16T00-29-46-450Z_01a1421d-6a52-72bf-b582-05864b42239b.jsonl` (model/thinking/message/perf), `agent.db/model_perf`; OpenCode `experiments/2026-10-16_haiku-live-latency/observations.json` и его primary log/response refs. Greeting в omp — «Привет, расскажи мне о проекте»; OpenCode дополнительно несёт UTC suffix и injected context. Natural observations — НЕ matched input.

## G2: исходные кандидаты и дискриминаторы до матрицы

Это исторический snapshot отбора. Текущий измеренный статус находится в задачах P1–P5 и CLEAN_NEXT_STATE, не в первоначальных предположениях таблицы.

| Кандидат | Основание и статус | Что опровергает объяснение |
|---|---|---|
| C1 effort/cap mismatch | Config оба max; actual omp wire pending. Hypothetical/tier2 | Одинаковые effort/thinking/cap на захваченном wire |
| C2 system/tools/input | Первые provider input75315 vs123358, разные effective prompts. Inferred/tier2 | При matched body разрыв сохраняется, при нормальном prompt различается |
| C3 signed replay | Stored signatures → outbound absent, Exact как потеря данных, latency Unknown | Первая request исключает replay как причину только INITIAL задержки; continuation latency требует valid signed A/B, отсутствие эффекта на малой выборке не доказывает эквивалентность |
| C4 transport/client delay | OpenCode первый event~2–3s, основная пауза позже; source/current metrics. Inferred/tier2 | Matched byte body через native/gateway не отличается при сопоставимом stop/usage |
| C5 context/kernel composition | Оба kernel loaded по owner; byte equality не установлена. Hypothetical/tier2 | Actual prefix/contexts совпадают, latency различается |
| C6 outcome mismatch | omp first response быстро, session aborted; Exact только receipt | Оба завершили одинаковый terminal criterion с одинаковым входом |

Medoids: C1 wire settings, C2/C5 effective payload, C3 replay, C4 path. C6 проверяет допустимость сравнения. Объяснения не получают Exact от одного HTTP200, читаемого исходника или согласия двух агентов.

## Acceptance / oracle contract

1. Реальные версии и источники сравнительных наблюдений привязаны к файлам/hash/session/run ids. Заявление owner про быструю работу сохранено отдельно от наших измерений.
2. Actual omp и OpenCode payload описаны на wire layer; capture-only слой отличён от отправленного запроса. Нет передачи secret в evidence.
3. Harness квалифицирован на UTF-8/framing/error/truncation controls. Каждый arm имеет заявленные изменения, stop criterion и бюджет; неполный terminal не считается быстрым успехом.
4. Причинное объяснение требует сравнения, исключающего альтернативы. Native/full-default comparison не подменяет matched-input transport comparison и наоборот. Один ordered pair не latency benchmark.
5. Отчёт сохраняет FAIL/UNKNOWN, observed differences, уровень вывода и конкретный следующий oracle; исходный slow product не объявляется исправленным.

## Задачи

- [x] **P1** — ✓ readonly user session/config/usage receipts в `experiments/2026-10-16_haiku-omp-compare/natural-observations.json`; natural greeting/context различаются, omp full task completion не подтверждён. <!-- sv: user-receipts,model-state,completion-boundary -->
- [ ] **P2** — Частично: ✓ actual installed CLI pre-send hook qualified `20261016T004545Z_546f6c6f`, capture-only `20261016T004631Z_42dab6b9`; matrix outgoing raw hashes8/8 совпали. Остаток: точный transmitted owner omp wire и auth/extension/MCP parity. Source builder не назван runtime proof. <!-- sv: actual-wire,payload-diff,source-provenance -->
- [x] **P3** — ✓ A,B,C,D,D,C,B,A выполнены:8 HTTP200/message_stop; B15.205/8.280s vsA26.995/31.856s до первого text/tool-start. C дважды max_tokens, D не прошёл консервативный≥30% signal. Primary receipt `20261016T004948Z_970f7c8a` + `matrix-results.json` + `wire-readback.json`. Tools не исполнялись. Matrix process после final receipt остановлен из-за background timers, не clean suite PASS. <!-- sv: matched-input,causal-controls,retained-errors -->
- [x] **P4** — ✓ два readonly review plan/harness/results; parent подтвердил пределы first_action/action_ready, source/binary/capture parity и неоднозначность D. Раздел аудита evidence scope в public REPORT; старые результаты не переписаны. <!-- sv: evidence-audit,claim-scope,independent-review -->
- [ ] **P5** — Частично: ✓ public-safe REPORT/metrics/receipts сохранены, map отрендерен `20261016T005145Z_0de9d608`; routing/index/progress подготовлены к scoped commit. План ACTIVE: конкретный компонент latency и continuation причина не установлены; следующий oracle ниже. <!-- sv: measured-outcome,continuation-receipt,research-closure -->

## Smoke Tests

### Заранее заданная live matrix (diagnostic, максимум8 inference calls)

Qualification receipt: `20261016T004545Z_546f6c6f`, actual binary18.11.1: stop exit74+capture+0 independent localhost requests; send control exit0+1 request+known SSE. Первую JSON-instead-of-SSE попытку `20261016T004453Z_ad190fd4` остановили, результат UNKNOWN и retained. Actual API-key-mode CLI pre-send capture `20261016T004631Z_42dab6b9` exit74 внутри wrapper; provider inference не отправлялся. Owner extensions disabled; adm-rag MCP connection refused, поэтому tool catalog текущего capture может отличаться от owner run.

Фиксируются account(API key OpenCode), official endpoint, actual gateway h2, modelHaiku5.5, adaptive/max, output cap8192,90s deadline, одинаковый набор feature beta headers. Owner sessions не используются. Порядок A,B,C,D,D,C,B,A, два наблюдения каждого arm, выводы только exploratory.

- A: исходный первый OpenCode wire, единственное отклонение max_tokens125000→8192.
- B: current installed omp CLI payload, cap128000→8192. Весь builder bundle отличается: это natural-bundle diagnostic, НЕ однофакторный причинный oracle.
- C: A с единственной заменой tools catalog на захваченный каталог B. Исследуется catalog bundle (capabilities/описания/размер), НЕ чистое число инструментов и НЕ качество выполнения задачи.
- D: A с единственной заменой messages на захваченный первый user message B. Исследуется input-preparation bundle, НЕ только UTC suffix.

Predictions: synthetic valid/truncated/error predicates PASS/EXPECTED_FAIL. Для network A–D точный outcome неизвестен — диагностические, не предсказанный PASS. `end_turn` с непустым text либо `tool_use` с валидным JSON = action-ready, но без выполнения tools не product acceptance. `max_tokens`,90s cutoff, SSE error/EOF без message_stop — отдельные censored/failure outcomes; не считать быстрым успехом.

До runs определены метрики: headers/first byte/start/nonempty thinking/first text or tool call/complete, output/thinking tokens, cache usage и stop. Предварительный latency signal — оба повтора candidate быстрее обоих A по first-action; для некензурированных A дополнительно разница≥30% и≥2s. Это лишь основание следующей проверки, не причинная универсальность; разная cache warmth и n=2 остаются ограничениями. Если A censored, сообщается только граница времени и различие action-ready outcome, без отношения средних. Нет различия на n=2 ≠ эквивалентность. Signed replay A/B и native-vs-gateway ABBA оставлены named residual до отдельного бюджета; исходная первая request не содержит replay.

- Baseline file/control: известные synthetic request и chunked UTF-8 SSE; recorder обязан сохранить точные bytes, masked headers и terminal. Unknown/malformed/truncated fixture обязан быть отвергнут.
- Capture-only probe: сеть запрещена на уровне инструмента; запрос обязан попасть в recorder ровно один раз, real API/tools не вызываются. Если инструмент не обеспечивает это, он не квалифицирован.
- Сначала сравнение собранных bytes, потом network arms. `max` в UI/config не доказательство `max` на wire.
- Матрица network: фиксированные model/account/input/system/tools/thinking/effort/cap/display, меняется один factor. Любое несовпадение за пределами factor — diagnostic-only, не causal.
- Signed replay arm допускается только после проверки исходной подписи и неизменного prefix; prefix/signature400 означает invalid trial, не плохую скорость.
- Финализация: архив readback, JSON parse, byte hashes; public projection не содержит raw conversations/credentials. Existing product tests/build не запускаются при отсутствии product edits; исследовательский harness получает собственные decisive controls.

## Риски и остановка

Исчерпание времени/loop не означает завершения. Сохранить выполненное, failed approaches, следующий leaf и readback receipt. Нет контроля над запущенными owner sessions; не abort/restart. Не расширять исследование на ремонт kernel/governance по этой гипотезе. Старый closed plan не становится доказательством новой latency claim.

## CLEAN_NEXT_STATE — ограниченный раунд, задача открыта

Observed result: различие whole payload bundle воспроизведено на общем gateway и account; гипотезы «только max», «в omp нет kernel», «просто подставить меньший tools catalog» не дают установленного объяснения. Root cause отдельных компонентов остаётся UNKNOWN. Actual product/source/config diff=none; bin и owner sessions не менялись. Product tests/build не выдаются за causal oracle и не запускались.

Public result: `experiments_history/2026-10-16_haiku-omp-compare/REPORT.md`, controls/metrics/receipts. Private source captures и user sessions остаются по исходным адресам. Восемь разрешённых inference calls раунда израсходованы; остальные листья не превращаются в выполненные из-за закрытия процесса.

Next leaf: новый2×2 system×tools с одинаковыми messages/thinking/display/binding/context/account/headers/gateway/cap, свежим baseline и учётом cache. Continuation receipt: `20261016T004948Z_970f7c8a`, artifact finished2026-10-16T00:53:11.800Z,8calls и8 outgoing hash matches. Затем отдельный valid signed-empty A/B для continuation, не восстановление всех поздних подписей сразу.

Tool residual: починить общий stop/lifecycle research harness и action_ready predicate до следующего использования; existing metrics не объявлять schema/tool execution acceptance. Owner omp exactwire parity также не закрыт. Нет SUCCESS или full portfolio acceptance; план не архивируется в completed. Reopen/continue по этому receipt, не по пересказу предыдущего отчёта.

## Сверка ссылки владельца на migration guide

✓ Read-only audit: `experiments_history/2026-10-16_haiku-omp-compare/migration-audit.md` и `migration-audit.json`. Четыре исходных captures/три пары: system/tools стабильны, общая история отличается только cache_control (разрешено документацией); thinking в outbound отсутствует. Official contract подтверждает штатность signed-empty blocks и необходимость сохранения replay, но latency attribution остаётся UNKNOWN. Для continuation сначала отдельный valid signed replay oracle, для первого запроса — прежний system×tools. Старую матрицу не повторять; новых inference calls нет.

## Граф default reasoning по запросу владельца

Artifact: `docs/reasoning-flow.md`, source/line/hash receipts — `experiments_history/2026-10-16_haiku-omp-compare/default-flow-evidence.json`. Read-only grounding расширено до processor → stored parts → UI/history → message-v2 → provider transform → SDK. Это Inferred карта текущего кода, не runtime acceptance. Помимо signed-empty filter найдены reasoning-only gate, differentModel metadata gate и route no-echo strip. Source repair ещё не применён; следующая bounded реализация должна связывать тесты с конкретными слоями, а не объявлять все reasoning сохранёнными после правки одного фильтра.

Owner decision 2026-10-16: «ничего резать не надо»; владелец сам запускает робота. Для расследования/ремонта подготовлен [отдельный план preservation](2026-10-16_reasoning-lossless-replay.md), READY_FOR_OWNER_ROBOT, без dispatch receipt и без выполненной реализации. Исходный latency criterion здесь остаётся открытым; исполнителю не повторять израсходованную матрицу как будто это новый baseline.
