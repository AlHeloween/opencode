<!-- intention: isolated kernel and addon defects are known but correctness of the current contracts and host bindings is unverified -> a bounded audit identifies reproducible defects, records passing controls and states the uncovered behavioral scope without changing or installing the kernel -->
<!-- goal_sv: kernel-correctness,host-bindings,evidence,closure -->

# Аудит корректности кернела и addons

**Status:** COMPLETED — завершён аудит по запросу владельца от 2026-10-12. Исправление и установка кернела не входили в задачу; K01–K10 остаются результатом для отдельного ремонта.

## Связь с MASTER_PLAN

Стратегия относительно цели `plans/MASTER_PLAN.md:24`: проверить, что механические контракты непрерывности и доказанного завершения соответствуют своим исходникам, а привязки инструментов могут быть исполнены на заявленных хостах. Результат — адресуемые дефекты и различающие проверки для дальнейшей реализации.

```yaml
Keywords: kernel-correctness 0.35, host-bindings 0.25, evidence 0.25, closure 0.15
Semantic dominant: Проверка согласованности контрактов кернела и исполнимости его host addons.
md5: 8bc145d307fa49ea91c25d6e403f872b
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Контракт и границы

- READ: `prompt_kernel/`, связанные исходники, тесты, документы и host capabilities.
- PLAN_WRITE: этот план, отдельный отчёт аудита, запись `_progress_log.md` и ссылка в ручной части мастер-плана.
- MODIFY_CANDIDATE: изолированные probes и журналы в `experiments/2026-10-12_kernel-audit/`, pytest temp; штатная кандидатная сборка в `dist/` и `packages/opencode/dist/` после проверок.
- Допустим отдельный локальный коммит артефактов аудита штатным hook; без push и обхода hook. Source fixes, установка kernel receivers, изменение runtime config, live `bin/`, внешняя публикация и изменение чужих незакоммиченных hunks запрещены.
- Бюджет: step_budget=60, tool_budget=90, loop_budget=3, depth_budget=2, time_budget_ms=1200000. Проверки ограничены timeout инструмента; общий лимит контролируется по часам, отдельного host deadline для всего чата нет.

## Приёмка

1. Прочитаны core, четыре реестра addons и их проверки; выводы привязаны к конкретным исходникам.
2. Прогнан существующий структурный suite; полный результат, skips и ошибки сохранены без ремонта baseline ради зелёного результата.
3. Существенные найденные противоречия перепроверены независимо минимальными контрпримерами с положительными controls; отдельно указано, что они доказывают о модельном поведении.
4. Отчёт содержит приоритет, механизм, адрес, falsifier, границы и дальнейшую проверку. Проверены собственный diff и сохранность чужой работы.
5. По каждому из трёх исходных вопросов отдельно проверены объявленное правило и его consumer: explorer-перепроверка завершённости, использование CodeGraph, стратегическое подчинение каждого плана как условие SUCCESS. Фальсификаторы: closure без отчёта, grounding без релевантного результата графа, closure с одним orphan plan. Если runtime fixture не запускалась, это явно указано.

## Задачи

- [x] A1 — core: topology, predicates, prose, states, validator и tests. ✓ CONFIRMED: CodeGraph/read-only explorer и независимый probe `20261012T033203Z_08c660d1`, полный stdout/state, exit=0. <!-- sv: kernel-correctness,evidence -->
- [x] A2 — addons: права, инструменты, различия хостов, paths, делегация и closure. ✓ CONFIRMED: все четыре registry прочитаны и отрендерены; усиленный parity probe `20261012T033408Z_55f17333`, exit=0. Реальное поведение хостов ограничено ниже. <!-- sv: host-bindings,evidence -->
- [x] A3 — независимые probes, suite, отчёт и закрытие аудита. ✓ CONFIRMED: пять полных stdout/state пар, FAIL suite сохранён, build exit=0; независимый explorer сверил отчёт с JSON, исходниками и хешами. Root readback: 15 source hashes и пять log hashes без divergence; 10 findings, парные fences. План архивирован, ссылка обновлена; артефакты готовы к scoped commit, его stamp проверяется при handoff. <!-- sv: evidence,closure -->

## Smoke Tests

- Baseline prediction: существующий `pytest prompt_kernel/tests/` завершается PASS; несовпадение записывается как найденный baseline-дефект, без продуктовой правки.
- Инструмент runner: независимая fixture печатает уникальную строку, exit=0; stdout/state должны совпасть, bytes_dropped=0 и truncated=false.
- Контрпримеры: для каждой гипотезы сначала фиксируются expected predicate и положительный control; запуск доказывает лишь указанную границу.
- Readback: source/receiver SHA-256 до/после; исходники и установленные receivers должны остаться неизменными. Новые артефакты должны существовать и содержать адреса результатов.
- После тестов штатный `_build.ps1 -Task build`; кандидатная сборка не является оракулом корректности кернела и не устанавливается.

## Исходные сведения и риски

✓ CONFIRMED (`git status`, начало аудита): ветка Local_Development; чужие dirty `AGENTS.md`, `plans/MASTER_PLAN.md`, `agi_workout/2026-10-12_org-epoch-cas-and-argv-residual.md`.

✓ CONFIRMED (CodeGraph sync): индекс обновлён перед запросами. Raw reads используются для непоказанных участков и документов.

Риск ложного переноса структурного PASS на поведение модели: containment — отдельная граница в каждом выводе. Риск загрязнения live prefix: containment — никаких install-команд. Необязательные удалённые инструменты не вызываются ради проверки наличия.

## Результат

Actual product-source diff: none. План находится в `plans_completed/`, ссылка мастера обновлена. Закрыта только задача аудита, не корректность кернела и не устранение выявленных дефектов. Перед handoff требуется scoped commit с именем этого плана; stamp проверяется по Git history.

## Отчёт — 2026-10-12

✓ CONFIRMED (suite и независимые probes): текущая система не проходит собственный контракт синхронности receivers; в валидаторе и машинной транскрипции правил найдены воспроизводимые дефекты. Структурная корректность оставшейся части и поведение модели не объявляются доказанными.

### Проверки и результаты

| Инструмент / run | Наблюдение | Что покрывает |
|---|---|---|
| Runner fixture `20261012T032722Z_ee8984a4` | ✓ exit=0, точная контрольная строка; dropped=0, truncated=false | запуск/capture/завершение Python |
| `python -B -m pytest tests -q -ra -p no:cacheprovider`, cwd=`prompt_kernel`; `20261012T032745Z_83c5c288` | ✗ 3 failed, ✓ 142 passed; exit=1, завершённый suite, skips=0 | существующие структурные и receiver guards; FAIL сохранён |
| Независимый core/receiver probe `20261012T033203Z_08c660d1` | ✓ exit=0, семь контрпримеров и независимые положительные controls | результаты функций IR и сравнение файлов с renderer |
| Усиленный parity probe `20261012T033408Z_55f17333` | ✓ exit=0; одинаковая мутация одного slot проверена в каждом host | точный blind spot одного parity guard; состав registry сохранён |
| `_build.ps1 -Task build`, `20261012T033204Z_10b89f8f` | ✓ exit=0, кандидат 10.0.1278, embedded-prompt smoke и version smoke завершены | сборка кандидата; НЕ корректность норм/модели и НЕ установка |

✓ CONFIRMED (все пять state.json): статус finished; bytes_dropped=0 и truncated=false. Pytest сам сокращает отображение diff, поэтому отдельный probe сохранил полные receiver diffs. Build log прочитан целиком инструментом; 667 строк / 50 474 UTF-8 bytes в stdout_text.log, сырой runner bytes_written=51 444. Разница единиц сохранена; это не сообщение о потере данных.

✓ CONFIRMED (полный build log): сохранены сообщения Rust `syn v0.11.11` о future incompatibility, отсутствующие optional Cargo fields/LICENSE, Vite mixed dynamic/static imports и chunk-size advisory. Build PASS не закрывает эти сообщения; они вне вывода о кернеле.

### Реестр находок

Приоритет задаёт порядок ремонта; это не оценка доказанного live exploit. **Exact** ниже означает воспроизведение указанной функции/файла, а не доказанную корректность поведения модели. **Inferred** означает адресуемое чтение источника с ещё не выполненным behavioral falsifier.

#### K01 — P1: исходник и четыре receiver-файла расходятся

✓ CONFIRMED (suite FAIL + независимый receiver probe, Exact): OpenCode production, `.claude/reasoning_kernel.md`, глобальный Codex `AGENTS.md` и Cursor `.mdc` отличаются от текущего render. В каждом diff один hunk: `VCS_ROLES` ещё содержит `$HOME/.org`, порт 8079 и прямой `fossil wiki export`; исходник уже содержит `$ORG_HOME`, `$ORG_PORT` и `org.py protocol`.

Pins: `prompt_kernel/addons.py:89`, `addons_claude.py` / `addons_codex.py` / `addons_cursor.py` — slot `G1/VCS_ROLES`; `tests/test_compatibility.py:40`, `tests/test_variant_parity.py:96,129`. Suite проверяет три receivers; глобальный Codex receiver дополнительно проверен probe, а существующий Codex тест проверяет только последний dist artifact.

Фальсификатор после согласованной установки: каждый выбранный receiver совпадает с render своего registry, baseline pin совпадает с production. Изменение source-only без продвижения receiver не закрывает находку. Граница: наличие файлов проверено; system-prefix на provider wire и роль `developer_instructions` этого аудита не измерялись.

#### K02 — P1: validator принимает недопустимые дополнительные рёбра

✓ CONFIRMED (независимый probe, Exact): добавление side-рёбер `* → G7`, `G0 → G7`, `SUCCESS → G7` оставляет `validate_kernel(...) == []`; renderer публикует их. Control `MISSING → G7` отклоняется, поэтому это не неработающий валидатор целиком.

Pins: `prompt_kernel/validate.py:28-45`; `tests/test_architecture.py:32` проверяет только неизменённый канон. Объявленные требования: wildcard только interrupt→G9; авторизация до мутации; терминал завершает run.

Фальсификатор ремонта: мутации wildcard, authorization bypass и исходящего terminal edge отвергаются до render; законные back/side/interrupt edges остаются допустимыми. Граница: действующий канонический граф этих рёбер не содержит; live обход ACL не доказан.

#### K03 — P1: внутренне некорректный FSM не отклоняется

✓ CONFIRMED (независимый probe, Exact): `G0.fsm.initial_state="UNDECLARED"` вне declared states проходит validator; render остаётся тем же. Pins: `model.py:89-101`, `validate.py:20`.

Фальсификатор ремонта: неизвестные initial/accepting states и endpoints переходов отклоняются. Граница: отсутствие FSM в текстовом render само по себе не признано дефектом — renderer сохраняет каноническую прозу. Пробел — отсутствие валидации объявленного IR.

#### K04 — P2: машинный G2 теряет условие «when the space permits»

✓ CONFIRMED (независимый probe, Exact): `GENERATE_CANDIDATES → CLUSTER_MEDOIDS` отвергает единственного допустимого кандидата, а пять кандидатов пропускает. Текст `MANHATTAN_L1` допускает малое пространство; FSM и rule predicate требуют ≥5 без исключения.

Pins: `source.py:232,485`; `tests/test_constitution.py:154-159` закрепляет безусловный порог, включая fixture со списком из одного элемента и `candidate_count=5`.

Фальсификатор ремонта: исчерпывающее малое пространство проходит; неготовое большое — нет; count не противоречит списку. Граница: факт относится к machine representation, не к измеренному поведению LLM.

#### K05 — P1: G9_FSM не допускает предусмотренное закрытие non-PASS

✓ CONFIRMED (независимый probe, Exact): при `oracle_passed=False`, определённом residual и исчерпанном бюджете переход `CHECK_ORACLE → CHECK_RISKS` запрещён. PASS control проходит. Глобальный граф допускает вход в G9 после recorded non-PASS, а bounded-stop rule требует запись частичного закрытия.

Pins: `source.py:336`, `source.py:664`, edge G8→G9 около `source.py:1040`.

Фальсификатор ремонта: exhausted non-PASS достигает записи partial closure и законного non-success terminal; SUCCESS по-прежнему требует PASS и критические риски 0. Граница: use-site FSM в live runtime этим аудитом не установлен.

#### K06 — P1: common-spelling guard видит лишь два registry

✓ CONFIRMED (усиленный независимый parity probe, Exact): изменение одного `G1/VCS_ROLES` binding в памяти сохраняет все addon slots. `test_shared_bindings_keep_one_spelling` ловит мутацию Codex/Cursor и пропускает идентичную мутацию OpenCode/Claude. Pins: `tests/test_variant_parity.py:35,75-83`.

Фальсификатор ремонта: мутация общего slot в любом из четырёх host даёт адресуемый FAIL; declared host differences остаются допустимыми. Граница: доказана слепота конкретного guard, не утверждение «весь suite пропускает любую произвольную мутацию».

#### K07 — P1: Codex addon не связан с текущим каталогом capabilities

✓ CONFIRMED (чтение addons и текущего runtime catalog, Inferred): registry буквально требует `Hub`, `LSP`, `AST Edit`, `Task`, `Browser through Eval`, тогда как этот host предоставляет `exec_command`/sessions, `apply_patch`, `node_repl`, `collaboration`, `cua_repl`. Capability `READ`, например, исполнена в этом аудите через filesystem API; отсутствие имени `Read` не доказывает отсутствие capability.

Pins: `addons_codex.py:141,163,171,198,252`; `tests/test_addons_codex.py:25-45` закрепляет слова, а не исполнимые bindings. Пробел — нет наблюдаемой таблицы capability→instrument и квалификации альтернатив, хотя `CAPABILITY_ABSTRACTION` этого требует.

Фальсификатор: каждую обязательную capability связать с реальным инструментом/ACL и квалифицировать на primitive fixture либо записать unavailable с маршрутом приобретения. Граница: наличие других инструментов не считается полным функциональным эквивалентом Hub/LSP; они не квалифицированы здесь.

#### K08 — P2: freshness-требование CodeGraph не распределено по исполнителям

✓ CONFIRMED (чтение источников, Inferred): G1 требует CLI `codegraph sync` перед первым запросом task; explorer запрещены shell/exec инструменты. Builtin `codegraph` делает MCP touch, но addon не задаёт, является ли это выполнением sync-требования и кто передаёт child свидетельство свежести.

Pins: `addons.py:46`, `addons_claude.py:43`, `addons_codex.py:34`; `agent.ts:338-355`; `tool/codegraph.ts:85`. В этом аудите parent выполнил sync, child получили это в brief — это наблюдённый маршрут, а не доказательство автоматического поведения продукта.

Фальсификатор: новый explorer с устаревшим индексом получает и подтверждает свежий релевантный ответ разрешённым инструментом; sync/touch/parent-refresh имеют явного владельца. Граница: live stale-index fixture не запускалась; не объявляется доказанный отказ самого CodeGraph.

#### K09 — P2: Cursor ladder оставляет структурный MCP вне маршрута

✓ CONFIRMED (чтение источника, Inferred): `addons_cursor.py:58-59` связывает цепочку с Codebase→Web→Grep и допускает MCP refresh, но структурный запрос при подключённом CodeGraph MCP не включён первым instrument; G6 `:109` снова ведёт в Codebase/Grep.

Фальсификатор: host fixture с подключённым индексированным CodeGraph направляет структурное исследование в MCP, а fallback начинается после адресуемого empty/refusal. Граница: настоящий Cursor host отсутствует в текущем каталоге; его поведение не измерено.

#### K10 — P1: три исходных требования не стали обязательными входами closure/grounding

✓ CONFIRMED (чтение consumer-кода, Inferred): DELEGATION остаётся advisory (`source.py:692-700`); G9 SUCCESS не требует explorer-аудита existing plans (`source.py:650-651`). `masterPlanCoverage` использует `text.includes(file)` (`util/plan-status.ts:581-597`), а hygiene predicates не учитывают даже этот результат (`:690-709`). Это проверка присутствия, а не стратегического подчинения.

✓ CONFIRMED (чтение `agent/prompt/explore.txt:5` и `agent.ts:358`): инструкция «BEFORE codegraph queries: call codegraph» тавтологична; описание explorer рекламирует поиск файлов/ключевых слов. Его CodeGraph ACL уже разрешён и проверяется существующим agent test; дополнительный тест наличия не докажет использования.

| Исходный запрос | Текущая граница | Требуемый различающий сценарий |
|---|---|---|
| Explorer перепроверяет завершённость существующих планов | обязательный отчёт не входит в closure inputs | closure без отчёта не проходит; отчёт содержит plan/task/source/oracle/evidence и перепроверяется родителем |
| Агенты используют CodeGraph | callable tool + текстовое требование, receipt не обязателен | child ищет indexed symbol; saved tool parts подтверждают релевантный запрос и caller, fallback имеет причину |
| Любой план является стратегией мастера, иначе цикл не завершён | lexical coverage; strategy predicate отсутствует | один orphan, даже упомянутый по имени, блокирует SUCCESS до доказанной связи либо согласованного исключения |

Граница: fixtures живого agent cycle не запускались. Новое нормативное условие не установлено и не объявляется проверенным продуктовым поведением.

### Что не признано дефектом

✓ CONFIRMED (тесты/код): структурные tests действительно существуют и ловят receiver divergence, неизвестные nodes и другие проверенные мутации. Поэтому вывод «всё декоративно» не следует из результатов.

✓ CONFIRMED (источники): host registries могут различаться, advisory protocol не является ACL, generated prompt не редактируется вручную, а source core и host addon отвечают за разные уровни. Эти решения не отменяются аудитом.

✓ CONFIRMED (прочитанный aicall skill и addon): недоказанная изоляция CLI сама по себе не опровергает Codex binding «no isolated call bound». Рабочий outside behavioral oracle в этом аудите отсутствует.

### Порядок следующего ремонта

Предлагаемые отдельные bounded tasks: (1) синхронизация выбранных receivers после review diff; (2) validator/FSM guards с mutation tests; (3) представление G2/G9 в согласии с каноническими условиями; (4) четыре-host parity и реальные capability adapters; (5) proof-bearing explorer/CodeGraph/strategy inputs и живые closure scenarios. Это предложения, не разрешение на install либо SELF_MODIFY.

### Доказательства, свежесть и остаток

Evidence: `experiments_history/2026-10-12_kernel-audit/` — два probe scripts, JSON results, четыре полных receiver diffs, пять stdout/state пар и `evidence-manifest.json` с source/лог SHA-256. Скрипты измеряют функции и создают только audit artifacts; никакие source fixes не применяют. Для нового контекста запуска нужен новый scratch-каталог, чтобы не переписать сохранённый снимок.

✓ CONFIRMED (hash readback): исходные десять source/receiver hashes после suite, probes и сборки не изменились. Git HEAD во время аудита переместился из-за параллельной работы; её два коммита и изменения не присваиваются этому аудиту. Ссылка этого плана в мастере уже попала в чужой коммит; исходник кернела остался тем же.

Остаток: исправление K01–K10, actual host/agent behavioral scenarios, актуальный wire-prefix и полная oracle-перепроверка каждого плана. Отсутствие этих измерений не заменено suite/build PASS. Аудит конечен; корректность кернела не объявлена.

Инструменты: CodeGraph отвечал по текущему коду с явными gaps; непоказанные участки дочитаны filesystem API. Большие текстовые ответы и pytest diff были явно сокращены; доказательства сохранены полностью, решения основаны на ограниченных контрпримерах/полных diffs. Runner во всех пяти прогонах завершился и не потерял captured bytes. Общий chat deadline host-ом не обеспечивается, как отмечено в контракте.
