<!-- intention: подбор роботов, инициализация по SV и назначение проверяющего выполняются Codex вручную -> внешний робот кадровик-делегатор автоматически ведёт этот цикл по проверяемым досье, с отдельным проверяющим и адресуемым результатом -->
<!-- goal_sv: Keywords: robot-personnel 0.30, sv-handshake 0.25, independent-verification 0.25, evidence-dossier 0.20
Semantic dominant: Автоматизировать назначение внешних роботов и независимых проверок без подмены доказательств кадровым мнением.
md5: 25f8c07b61a94d3e8b204af59c716de2
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
-->
<!-- subgoal: s1-delegation-org-protocol — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S1 -->
# Робот кадровик-делегатор

State: ACTIVE. Основание: прямое поручение владельца 2026-10-20 о роботе, автоматически выполняющем кадровые и делегирующие задачи. Встроенные субагенты запрещены; внешние роботы исполняют и проверяют, Codex принимает адресуемые доказательства.

## Привязка к генеральной цели

Цикл поддерживает механическую преемственность из MASTER_PLAN: одна задача имеет намерение, назначения, ответы по SV, execution receipts, отдельную проверку и продолжение. Досье и история организации уже предусмотрены docs/organization-charter.md; канон поручений — org.fossil через org.py. Не создавать конкурирующую организацию или новую JSON-очередь.

Во время текущего H1 появился основной [t105 HR driver](2026-10-20_hr-delegator-driver.md), commit 5f5acd77c2 и source readback 2026-10-20. Этот план — qualification/pilot lane, t105 — механизм driver; H2/H3/H4 исполняются через общий контракт t105, без второй конкурирующей реализации. Наблюдённые здесь auto-delivery-before-SV, повторные ответы и stale-abort receipts — входы D1/E1/handshake gate t105. Текст sibling-плана не расширяет текущий execution envelope и не разрешает новые расходы/установки/роли. Активный незавершённый родительский замысел сохранён.

## Состояние и границы

CONFIRMED ✓ fs/codegraph/Protocol, 2026-10-20: существуют org.py delegate/claim/report/done/verify, orgd wakes, nonce-qualified host, scripts/codex-hooks/opencode_events.py и устав с кадровым рассмотрением. Наличие этих частей не подтверждает готовность автоматического кадрового цикла.

Модели из текущего /provider: opencode/minimax-m3.1-flash-free и opencode-go/minimax-m3.1-flash-free; альтернативный проверяющий opencode-go/muse-spark-1.3-contributor. Не подменять модели из старых skill defaults и не запускать bin/.

Текущий проход: сначала H1 READ/PLAN_WRITE; H2 получает отдельное конкретное binding после чтения H1. Нет установки службы, изменения kernel/ACL/hooks, bin/, внешних сообщений людям или произвольных поручений из backlog. Родитель DAIS остаётся открытым.

## Задачи

- [~] H1 — квалифицировать внешнего кадровика на расшифровке SV и трёх прикладных ТРИЗ-сценариях; получить исполнимую схему цикла и точные bindings. Candidate Muse сохранён; независимая проверка не выдала обязательные артефакты в ограниченный проход, приёмки нет. Продолжение: t105 D1/E1 и anchor-scoped observer; receipts ниже. <!-- sv: robot-personnel, sv-handshake, qualification -->
- [ ] H2 — реализовать минимальный автоматический цикл на существующих организационных/host инструментах с долговечной адресацией. <!-- sv: delegation-cycle, event-handoff, evidence-dossier -->
- [ ] H3 — отдельный робот другой модели исполняет оракулы, отрицательные контроли, проверяет ограничения и возвращает пакет доказательств. <!-- sv: independent-verification, refusal-controls, receipts -->
- [ ] H4 — провести один разрешённый пилот на конкретном остатке DAIS; обновить досье по фактам и завершить цикл с подтверждённой приёмкой либо точным остатком. <!-- sv: dais-pilot, dossier-feedback, whole-goal -->
  **t135 addendum 2 (2026-10-22): H2–H4 are class (b) — robot-finishable, H1 stays [~] (its candidate exists, its independent acceptance does not).** H2 = the minimal automatic cycle on the existing org/host tools (binding after H1); H3 = a DIFFERENT model executes the oracles (independent verification); H4 = one permitted pilot on a DAIS residual with an addressed Codex decision. The t105 driver (D1/E1, handshake gate) is the mechanism H2–H4 run through — no second implementation (this plan's own lane rule).

## Smoke Tests

H1 prediction: расшифровка сохраняет намерение и не запускает исполнение; решение трёх сценариев различает исполнителя/проверяющего, подтверждённый результат/свидетельство, отсутствие квалификации/успех. Проверка — первичные сообщения и выполненные ограничения, не красота текста. До оценки ответы не считаются Exact.

Для H2/H3 до исходников требуется baseline и отдельный контракт: запрет приказа до ответа по SV; запрет общей личности исполнителя и проверяющего; предпочтение разных моделей; отсутствие квалифицированной пары даёт явный остаток; защита от повторной выдачи после timeout/restart; смена nonce/версии/артефакта аннулирует применимость; ошибки/отрицательные результаты сохраняются. Точный набор команд и controls определяется по bindings H1. Приёмка не равна ответу модели «готово».

H4: один cycle заканчивается артефактом, независимыми receipts и адресным решением Codex; без них пилот не принят. Перенос DAIS consumer, пять миллионов сущностей, полная семантическая корректность и рост прибыли не заявляются.

## Execution envelope H1

READ: owning docs, plans и обнаруженные symbols по CodeGraph; PLAN_WRITE: experiments/2026-10-20_robot-personnel/H1-report.md и H1-bindings.json. Сессия внешнего робота имеет право читать через штатные инструменты, но не менять product code, планы других задач, runtime config или организационные назначения. Никаких дочерних запусков на H1. Root budgets: step_budget=60, tool_budget=80, loop_budget=4, depth_budget=2, time_budget_ms=1800000; H1 reserve step_budget=12, tool_budget=16, loop_budget=1, depth_budget=0, time_budget_ms=600000. Неподтверждённые выходы не закрывают H1.

## Continuation

### Разрешённый первый инженерный срез — 2026-10-21

Boundary09:09UTC — CONFIRMED ✓ independent Muse ses_ea257aef4ffeoip045y1kmEslU report.md/json прочитаны:15контролей на копиях, fixture verdict CONFIRMED; исходный final27tests/15scenario. Parent read-back сырых state/logs сохранил промежуточные harness failures и исправленный fresh-key rollback exit6/rows0. Адрес: experiments/2026-10-21_hr-dataset/verification/report.json. Production D2 остаётся открытым: никакой live DDL/установки/квалификации моделей/whole-H2. Следующий лист — заново pinned source/schema binding и bounded production integration, затем независимая проверка. Current root deadline09:12UTC не обновляется; round2 hook acceptance отдельна и не подменяет D2.

Владелец: «Точно, можешь отправлять роботов на дело)))» после обсуждения раннего
кадровика/SV/TRIZ correction. Общий target сохранён. Parent envelope с08:27UTC:
160steps/230calls/4returns/depth1/2700000ms, READ/PLAN_WRITE/MODIFY_CANDIDATE,
live host API для внешних SV+direct orders. Не более3 активных роботов, free
MiniMax + разрешённый Muse; новые paid models/hosts/services/install не разрешены.
Два независимых oracle scope: MiniMax isolated D2 candidate в
experiments/2026-10-21_hr-dataset/** и read-only Muse verification E4 под
experiments/2026-10-21_hook-report-delivery/verification/**. Они не меняют одну
поверхность и не разделяют verdict. Child budgets и binding в отдельных order.md.
Главный driver plan t105 сохраняет D2 FIRST TO BUILD; H1/H2/C1/P1 policy не
объявляются принятыми. Production store integration — последующий binding после
fixture evidence и независимой проверки, не скрытая миграция runtime.
Приёмка isolated D2: raw fields/identity roundtrip, restart, idempotency/conflict,
правильный outcome join, retained correction rounds, negative scope/config
controls, coverage с явным знаменателем. Prediction missing behavior до кода,
post-change удовлетворяет указанным invariants; actual runtime qualification и
whole-H2 остаются открыты. Task SVd6873e194a2b40f5b6c8091e3d752af6.

CONFIRMED ✓ catalog/nonce health fresh, fleet перед запуском0busy. MiniMax
SV-init ses_ea269719cffea8CU1T5HCeROF4 / msg_15d968e71001RwS4wHgPNsV8b6,
dataset-init.json SHA2561b8cd01fabbb119387d4a9f5907f17e3a3de27092ff4f36dc645225207fa11ed.
Actual decode msg_15d96cf4d0018A9tQrAWdrlPSa прочитан полностью, tools0,
model opencode/minimax-m3.1-flash-free xhigh. Parent уточнил A1/A2/A3/A4/A5/A7,
различие raw значения/provenance и SV labels/real SHA256 в прямом приказе.
Init event COMPLETE report d24881aeed23b0c0c1f8f916c69b5a8c, init-event.json.
Graph вернул старый archived dispatch.py, не текущий HR store; не делается
absence claim. Robot обязан найти current storage owner/schema и отделить
production migration binding от исполняемого fixture candidate.

CONFIRMED ✓ direct D2 candidate order отправлен после полного decode и поправки
assumptions: anchor msg_15d995ef5001gD7GTcPx0UoPz0, session
ses_ea269719cffea8CU1T5HCeROF4. dataset-order.json SHA256
0c638821e9788d5d444bdafd9969a8e997db6934880f9d34ee39b55cb05c5ff2,
brief4c9912287b6e075a7246b888e6edd57fefbbed85c712552048f2a7e9c83c5509.
Actual API readback: exact user row, first MiniMax xhigh, busy11tools; общий
fleet3busy, новых запусков сверх cap не делать. SSE observer
20261021T083548Z_1d3a5cfa, собственные logs в candidate/logs/,1100s+runner1110s;
stop только observer при terminal/отмене. При timeout читать same anchor и
артефакты, приказ не повторять. E4 checker observer20261021T083549Z_40e4e703,
verification/logs/,600s+runner610s. Execution results пока pending. H2/H3 и t105 D2
не закрываются по receipt запуска; позже независимый candidate verifier.

CONFIRMED ✓ D2 candidate MiniMax завершён, final msg_15da4567e001H256VZvcK59pLY.
Report SHA256c7893994f75fca5437093831f0dd360096d43b5a5e752b955ed122ab71aaef32;
11artifact pins совпали при parent readback. Полный final log/state
20261021T084523Z_5f3ef816: exit0,27tests OK/15scenario steps PASS,4762B/drop0,
stdout SHA256677dc4171b40ac58a6e8760f29725eddc790c9ec1e4a57dc18447f75ee6dce57.
Это isolated prototype, not installed; production D2 остаётся OPEN. Не принимать
proposed migration paths/hand-edit gen entry по словам автора — отдельная проверка.

CONFIRMED ✓ независимый Muse SV decode msg_15da89a740024N68RnMx4x2HZg прочитан,
tools0; parent уточнил lineage (task parent65db41e8c9024af3b1760d9e75a2c830),
отсутствие выдачи допуска и fixture-vs-live denominator. Direct check anchor
msg_15daa25ad0015tKbdyc2bpHk4f/session ses_ea257aef4ffeoip045y1kmEslU,
check-order.json SHA25617f985617ca2ff022a1d4896bc1c305dd23245750887aa0706998fcee2a5b82b,
brief28488aa4e1cfb7950f5b8d337edfb462d71409f1aa3c81f780a9b60d2ab2e7f2.
API actual Muse low12tools. Correct observer20261021T085355Z_34f5a319 / verification/logs,
600s+runner610s, target same actual anchor. Erroneous root observer
20261021T085315Z_bdeb5b0b used PLACEHOLDER: result inadmissible. Stop request
address read back using CMD_RUNNER_LOG_ROOT (custom start log-root is not the
default action store); child prompt/model was not replayed, only observer replaced.
Await stop terminal readback on bad observer; keeper action is pending, not stopped
by request alone. Root actor fault, not model failure. No whole-H2/D2 acceptance.

CONFIRMED ✓ bad observer final state теперь finished/exit-1, stopped source PID28744
после проверки Win32_Process.CommandLine на wait_result.py + PLACEHOLDER + exact
checker session. Runtime PID1680 и оба роботных задания не затронуты. Native
cmd_runner stop request был записан, но terminal ack не пришёл до forced own-PID
stop; readback state finished_utc2026-10-21T08:58:07Z. Это обход сбоя управления
собственным observer, не исправление cmd_runner. Custom log-root actions требуют
CMD_RUNNER_LOG_ROOT per --help; source контроль/qualification отдельный residual.
Next standard: до запуска observer прочитать actual anchor из dispatch receipt и
отклонить placeholder; прежний invalid observer result не считать worker verdict.

Следующее действие: SV-only initialization внешнего MiniMax, чтение расшифровки, затем отдельный H1 brief; независимая оценка на другой модели перед H2. Receipts добавляются по фактическим результатам. Rollback H1: удалить только непринятые candidate artifacts; первичные сообщения/неудачи сохраняются.

### H1 initialization — 2026-10-20

CONFIRMED ✓ org.py delegate receipt: ticket 117dce113ac8cf31448b28fd59c9bc1902d9f245, slug robot-personnel-h1, assignee smit-opencode, no-wake. MiniMax session ses_ea8378fceffeUDa0FUZ8SPFgye, initial user msg_38d3c42d65a14cd3b75c0ddb578f38fd, first answer msg_157c8d9e4001RdQBK3PzgS610i: actual provider/model opencode/minimax-m3.1-flash-free, finish=stop, zero tool parts. Independent Muse session ses_ea8367dd7ffeyrnZVMsbq11uHC; actual model opencode-go/muse-spark-1.3-contributor; answer msg_157cb1012001QxgjOY32WDj16z, zero tool parts. Первичные сообщения сохранены в experiments/2026-10-20_robot-personnel/*-20261020T053148876739Z.json.

Инициализацию нельзя считать квалификацией на исполнение H1. Наблюдение: повторные assistant replies без нового user после finish=stop; обе созданные root сессии остановлены POST /session/<id>/abort с true и read-back отсутствия из busy map. Причина повторов ещё не классифицирована; initial event wait не выдаётся за штатный успешно завершённый цикл. Никакие чужие сессии не остановлены. Root прочитал расшифровки; H1 direct brief отдельно сужает ошибочную оговорку о разрешённых встроенных explorer и лишние SV ритуалы.

CONFIRMED ✓ штатный applyRender: run 20261020T052921Z_990e86af, exit0,217bytes,drop0; plan named in MASTER_PLAN read-back=true. Генератор показал существующие пробелы портфеля (3 plan vectors,118 task vectors,175 manifests); этот проход их не закрывает.

H1 direct order: run 20261020T053310Z_282b18f4, anchor msg_1e0604a0bf214ffb8dc19bf96d4d3ad3. Событийный collector завершился FAILED за1.285s, report d5bd9cf7e863a2ec9b12b1dbe9bd24d2: прочёл старый Aborted assistant, явно предшествующий новому anchor. Это отказ инструмента наблюдения, не доказательство отказа нового поручения: API readback 20261020T053402362549Z показывает новый assistant msg_157cd545f001fJXJsfSuXw3U1m после anchor, actual MiniMax и busy. Приказ не переотправлялся. Workaround — повторно подписаться на исходный anchor после наблюдённого старта нового assistant; полный автоматический цикл не принимается, пока этот класс отказа не квалифицирован.

### Поправка атрибуции H1

REFUTED ✗ гипотеза root о единственном исполнителе H1: org.py delegate сам создал сессию `ses_ea8376c59ffeCdsitRqN2e29np`, title `ticket 117dce113a`. API readback и архив `ticket_resident-20261020T053705523078Z.json` устанавливают модель opencode-go/muse-spark-1.3-contributor; org chat70/71 PRESENCE и72 HEARTBEAT связывают resident с ticket. Именно этот resident создал H1-report/H1-bindings; вручную назначенный MiniMax остановлен до записи своих выходов. У H1 один фактический автор Muse, не MiniMax. Дублирование возникло на маршруте root, не считается пригодностью кадрового автомата.

H1-report SHA256 `5dc808cc81e86593c05e64c81d84c0408f0e9d79eb588c9f8e64d48c3123621a`, H1-bindings SHA256 `3736038c1e4d5e988cb74c9639d7ede507810f6911e8fa857466defa2b33883b` — candidate на момент чтения, не принят. Проверять его должна другая модель: MiniMax после НОВОЙ SV-инициализации. Muse-review не запускается, поскольку был бы проверкой той же модели, что фактический автор. В будущем выбран ровно один канал выдачи: ticket delivery ИЛИ ручной dispatch с нейтрализованной auto-delivery, никогда оба.

Ticket 117dce113a отменён root штатным cancel, чтобы не допустить автоматическую повторную выдачу после прерванного дублирующего маршрута; это не VERIFIED и не отмена общей цели. Артефакты Muse и technotes H1-report/H1-bindings сохраняются. Фактические report/done/claim resident находятся в первичном архиве и должны оцениваться против границ H1, не замалчиваться.

Новый независимый reviewer: `ses_ea82cfdefffeK1oSkNCIGg0KnA`, actual opencode/minimax-m3.1-flash-free. SV-only ответ `msg_157d34f42001ySj4nYalA0UqJk` прочитан root: различает автора, первичное требование, квитанции и границы проверки, zero tools. Последующий прямой приказ на локальную проверку двух candidate-файлов отправлен отдельным сообщением; run `20261020T054344Z_b8e79ceb`, deadline360s, brief H1-review-brief.md. Предыдущие aborted сессии не используются для нового доказательства завершения. H1-review artifacts и executed controls ещё pending; H2 не начинался.

### CLEAN_NEXT_STATE ограниченного прохода

CONFIRMED ✓ новая ошибка observer воспроизвелась без старого aborted transcript: при прямом приказе в занятую fresh session пришёл `session.error MessageAbortedError` от прерванного предыдущего ответа, collector `9eeeb902160e6f6f756e12aecdbf8dcc` объявил FAILED за1.366s, хотя после нового anchor уже исполнялся новый reviewer. Полный ошибочный run `20261020T054344Z_b8e79ceb` сохранён. Это основание для anchor-scoped terminal/error predicate, не для повтора приказа.

CONFIRMED ✓ повторное ожидание того же anchor `msg_f9e73385b85c4792b0ca9e1b9a026fdf`, run `20261020T054509Z_ddf9771a`, завершилось TIMEOUT за300.029s, report `f8ed25883c1a3acb75c348f9f7ee4b0f`, exit2,621bytes,drop0. В проходе reviewer12tool calls,0tool errors,0завершённых финальных ответов; оба обязательных H1-review.md/H1-review.json отсутствуют (прямой stat ENOENT при существующем контрольном H1-report.md). Шестиминутный предел задания исчерпан; root остановил только свою reviewer session, API abort=true и status_after=null. Свежий архив `fresh_reviewer-20261020T055041156616Z.json` sha256 `4d2e8afe7a0030efb3649c0afc27aea5452574247abd309a4152a2e64586fec3`. Candidate hashes неизменны. Timeout означает непринятое исполнение этого конкретного прохода; не общую оценку модели.

Completed: существующие компоненты привязаны, два SV-only ответа прочитаны, candidate Muse и три сценария сохранены, реальные отказы автоматического назначения/наблюдения воспроизведены и адресованы. Residual: независимая приёмка H1 и весь работающий HR driver не подтверждены. Next route G9→G2: t105 D1/E1, минимальный leaf — одним внешним роботом квалифицировать idle/send/stop и классификацию terminal/error строго относительно текущего anchor на сохранённых сценариях; другой моделью проверить исправленный инструмент. Затем возобновить H1 review по этим двум неизменным candidate pins. Никаких новых служебных назначений, rollout или установки в этом проходе. Роботы этого пилота остановлены; source history и неудачи сохранены.

Термин «кадровик» здесь — машинный диспетчер моделей, не human-resources роль. SV дешифрует модель; человек не является декодером или обязательным посредником рабочего цикла. Уточнение владельца 2026-10-20: «humans cannot decode SV».
