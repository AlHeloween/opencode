<!-- intention: K01-K10 expose divergent receivers, incomplete guards and unbound grounding/closure contracts -> kernel and host addons are repaired under regression oracles, then the ADID_Python resident updates its canonical bundle, releases and installs it with independent per-receiver verification -->
<!-- goal_sv: kernel-contracts,host-bindings,delegation,release-verification -->

# Ремонт контрактов кернела и доставка через ADID

**Status:** ACTIVE. Основание: запрос владельца «Окей, давай приведем кернел в порядок, потом отправь робота в ADID_Python чтобы обновил, зарелизил и установил, проверь что все прошло гладко.»

## Стратегия мастера

План является стратегией цели `MASTER_PLAN.md:24`: механическая непрерывность требует согласованных исполнимых контрактов и доказанного завершения. K01–K10 из завершённого аудита — premise handles, не новая печать текущего состояния; их исходники и воспроизводители перечитаны перед работой. Доставка ADID переносит проверенный контракт на уже настроенные receivers, не меняя цель мастера.

```yaml
Keywords: kernel-contracts 0.35, host-bindings 0.25, delegation 0.20, release-verification 0.20
Semantic dominant: Согласованный кернел доставляется через резидента ADID и независимо проверяется на установленных receivers.
md5: d86170bc94f642da8b2f03ae5179cd68
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Авторизация и envelope

Продолжение по новому прямому запросу владельца «Продолжай»: прежнее окно run прошло, работа не объявлена SUCCESS. Continuation start2026-10-12T10:32Z: step_budget180/tool_budget260/loop_budget4/depth_budget3/time_budget_ms7200000; это новый external continuation envelope для оставшихся R1b–A2, не увеличение ребёнком собственного reserve. Выполненные S0/R1a stamps перечитаны. Прежний host исчез до claim R1b, pid27236 отсутствует, ticket READY; нынешний bridge возвращает500 с пустым body. Квалифицированный omp резерв заменяет локальный исполнитель; ADID по-прежнему RESIDENT.

ALLOW на основании прямого запроса владельца: SELF_MODIFY исходника кернела; MODIFY_PROJECT его validator/addons/tests и связанного explorer prompt; PROMOTE_STABLE только declared renderer/installer pipelines; EXTERNAL_EFFECT — org tickets и bounded robot prompts, штатный ADID release/install. Финитные бюджеты от старта этого run: step_budget=240, tool_budget=360, loop_budget=6, depth_budget=3, time_budget_ms=7200000. Общий host-enforced chat deadline отсутствует; leaf-команды и child leases ограничиваются инструментом. Повтор не расширяет бюджет.

Локальные bindings: `prompt_kernel/{source,model,validate,render,addons,addons_claude,addons_codex,addons_cursor}.py`, `prompt_kernel/tests/`, `packages/opencode/src/agent/prompt/explore.txt`, релевантное описание explorer в `agent.ts`; `docs/`, этот план, MASTER_PLAN hand-owned head, `_progress_log.md`, dated `experiments/`/`experiments_history/`. Receivers: production reasoning_prompt.txt, `.claude/reasoning_kernel.md`, `.cursor/rules/reasoning-kernel.mdc`, глобальный Codex AGENTS.md — только pipeline. Baseline pin — metadata hand-edit по фактическому renderer SHA после install; CLI сам baseline.json не обновляет (прочитан cutover.install_production). Rollback pointer сохраняется.

R1d instrument prerequisite binding: `packages/opencode/src/codegraph/sqlite-pack.ts:extractPathsFromText` и `test/codegraph/sqlite-pack.test.ts`. Native empty Python pack классифицирован, CodeGraph impact и реальные tests прочитаны. Expected diff — path extraction сохраняет все поддержанные index paths вне fixed directory names; falsifier — indexed Python path потерян между MCP и pack. Parent tests/typecheck/build обязательны; это prerequisite существующего CodeGraph контракта.

R1d дополнительный существующий reproducer: description-integrity дважды отверг loaded bash contract из-за description field; actual owner `bash.ts:679` выбирает `powershell.txt` на этом host. Binding ровно `packages/opencode/src/tool/powershell.txt`, required description field из Parameters:70; expected one explicit parameter line, oracle тот же real catalogue factory. READ CodeGraph caller до edit; shell implementation/ACL не меняются.

R2 instrument qualification продолжает R1d: `mcp-client.ts:modeToMcpCall/mcpTouchQueryThenSqlitePack` фильтрует relative packed paths абсолютным opts.path и подменяет projectPath подкаталогом. Binding — эти functions + `test/codegraph/mcp-client-args.test.ts`; expected project root сохранён отдельно от relative query scope, root/subdirectory/file scopes не теряют пути, вне worktree scope отвергается. Concrete seam/callers прочитаны CodeGraph; qualification не ограничивается удачным Python extension fixture.

ADID_Python — read-only для Codex; изменение/сборка/релиз/установка принадлежат его RESIDENT robot через org ticket. Он открывает собственные AGENTS/docs/procedуры и конкретизирует локальный binding до изменения. `_release.cmd` — единственный release entrypoint. Пользователь разрешил release/install; робот не получает разрешения на посторонние fixes, account/permission changes, bypass или force push.

`D:/zPython/opencode/bin/**` не редактируется, не заменяется и не продвигается; исключение запуска codegraph sync/status сохраняется. Чужие dirty `dialog-model.tsx` и `agi_workout/2026-10-12_org-epoch-cas-and-argv-residual.md` исключены. OpenClaw follow-up остаётся исключённым по действующему решению владельца; отчёт установки явно называет покрытые roots и остатки.

## Нормативный diff до implementation

R1e concrete binding: новый `prompt_kernel/evidence.py`, CHECK primitive в model.py, producer/consumer fields и Rule/FSM guards source.py; filesystem fixtures в tests/conftest.py и test_evidence_gates.py. Существующий kernel baseline/правила source.py и model._eval_predicate перечитаны через CodeGraph. STRUCTURAL_EVIDENCE содержит scope/method/query-or-reason/source pins/result pin/owner; PLAN_STRATEGY связывает plan digest с фиксированным master-goal digest и contribution evidence; PORTFOLIO_AUDIT перечисляет ВСЕ текущие root plans, independent explorer report и parent verification, strategy на каждую запись, unaccounted/unaligned. Consumer G6 проверяет выбранный plan и structural receipt; G9 SUCCESS проверяет portfolio независимо от counters. Pins перечитываются с диска; изменённый source/goal/inventory инвалидирует. Законный non-success stop доступен. Python FSM guards и нормативный prompt не объявляются runtime ACL всей модели; live child tool path — отдельная R2/A1 квалификация.

- K02/K03: validator отвергает недопустимые edges и malformed FSM; действующий конституционный core не ослабляется.
- K04/K05: машинное представление сохраняет оговорку малого исчерпывающего пространства и lawful non-PASS closure, не превращая stop в SUCCESS.
- K06: общий binding проверяется во всех четырёх registries; host differences остаются объявленными.
- K07–K09: capability→реальный runtime instrument, без вымышленных Hub/LSP/AST/Eval API; refresh имеет владельца и evidence; структурный MCP идёт до scanners на индексированном коде.
- K10: plan является стратегией master goal, lexical presence недостаточна. Explorer перепроверяет существующие планы по source/oracle evidence; parent независимо проверяет report. SUCCESS требует подтверждённого portfolio audit, включая отсутствие неподчинённых планов. Indexed-code grounding/plan binding содержит релевантный graph result либо проверенную причину fallback. Это обязательные inputs/conditions, а не ещё одно advisory повторение.
- Переход к non-success terminal при реальном blocker/budget exhaustion остаётся законным; правило не создаёт бесконечного run.

## Задачи и smoke

- [x] S0 — STABILIZE K01. ✓ CONFIRMED: baseline `20261012T035647Z_115e1035` 142 PASS/3 receiver FAIL; четыре install-команды и hash readback соответствуют renderer, production pin обновлён, rollback pointer сохранён. Parent suite `20261012T040338Z_b8877528` 145 PASS, exit0; `_build.ps1` `20261012T040415Z_b857b088` finished/exit0, candidate10.0.1281, drops0/truncatedfalse. Отдельный named checkpoint до R1. <!-- sv: receivers,baseline -->
- [x] R1a — K02/K03 validator. ✓ CONFIRMED: retained RED `logs/cmd_runner/20261012T041415Z_44b06fff` 9 FAIL/2 PASS; parent `20261012T041753Z_44b90e0a` 45 PASS/exit0; build `20261012T042145Z_994998da` exit0/candidate10.0.1282, drops0/truncatedfalse. Diff ограничен validate.py и новым test_validation_guards.py. Независимый explorer review не состоялся: сервис вернул out-of-credits; parent перечитал весь diff и реальные mutation fixtures. Runtime normative source/addons не менялись. <!-- sv: topology,validation -->
- [x] R1b — K04/K05 FSM. ✓ CONFIRMED: parent49PASS/1 stale SPEC fixture FAIL (`20261012T103729Z_0bfcd555`), дополнительные3 parent falsifiers RED (`20261012T103848Z_9553b601`); после ручного исправления полного пути stop и terminal whitelist —53PASS (`20261012T103931Z_fcee1bb2`). COUNT_GE считает actual sequence, numeric comparisons не меняются; constitution fake-count fixture superseded по K04. Build104002 finished/exit0/candidate10.0.1285, drops0/truncatedfalse. OMP report не печать:46 tool calls превысили reserve40; unsupported «не исчерпан» опровергнут event counter. Parent завершил artifact independently. <!-- sv: decomposition,bounded-closure -->
- [x] R1c — K06 parity. ✓ CONFIRMED: guard во всех четырёх registries, mutation/deletion/empty registry и exact telemetry tail;9PASS (`20261012T104520Z_01036c96`) после retained RED. Shared normative clauses выровнены, один точный product telemetry suffix не скрывает изменение нормы. Build104522 finished/exit0/smoke10.0.1286, drops0/truncatedfalse. Receivers до R2 считаются stale, SOURCE-only checkpoint. <!-- sv: host-parity -->
- [x] R1d source/contract guards — K07–K09 actual Codex APIs, optional tools require discovery, Cursor structural MCP before scanners, all hosts name parent/tool refresh owner; explorer prompt/description corrected. ✓ CONFIRMED: Python28PASS (105643), real TS path fixture RED→4PASS (104909→105122), typecheck exit0 (105214), agent tests51PASS; catalogue description field fixed against real schema. Captured build110113 exit0/smoke10.0.1290; one overlapping test invalidated by build cleanup (HARNESS retained), now sequential test→build. Live child tool-order claim перенесён в R2/A1, не выведен из строковых tests. Prefix measured max62026B/8405 normalized tokens; fixed price ceilings updated to next bands for requested contract scope, recorded guards retained. <!-- sv: host-bindings,codegraph -->
- [x] R1e — K10 mandatory evidence consumers. ✓ CONFIRMED: retained RED110844 15FAIL/2PASS; final target set113225 98PASS, FS pins/goal/inventory перечитываются, каждый checked box имеет source/oracle evidence. G9 Rule и FSM используют ОДИН G9_SUCCESS. Explicit unsupported strategy, отсутствие audit/parent, stale source/goal и omitted plan запрещают SUCCESS. Lawful stop и open aligned backlog разрешены. Документировано: Python predicates/нормативный prompt не являются runtime ACL всех model calls; live scenario остаётся R2/A1. <!-- sv: strategy,explorer-audit,closure -->
- [ ] R2 — reviewed render/install всех вариантов, focused regression + kernel suite + typecheck для TS изменений + обязательный `_build.ps1`; scope commit, sealed handoff manifest. <!-- sv: receivers,regression,release-verification -->
- [ ] A1 — после R2: ticket и visible resident ADID_Python, canonical update, `_release.cmd`, installer и полный отчёт по delivery roots. <!-- sv: delegation,release-verification -->
- [ ] A2 — независимые release/receiver/version/hash/semantic checks; документация, план в completed и named commits только после доказательства. <!-- sv: installed-readback,closure -->

Baseline prediction S0: suite содержит 142 PASS / 3 receiver FAIL (тот же classified reproducer, не waiver). S0 после pipeline: suite PASS. R1 новые behavioral predicates/mutation tests до реализации — FAIL на отсутствующем поведении, а не HARNESS; после — PASS. Дополнительные branches не допускают bypass, валидный канон проходит. Без portfolio audit, graph evidence или доказанной связи хотя бы одного плана SUCCESS запрещён; полное валидное свидетельство проходит. No-index/empty-portfolio случаи требуют явного доказательства и не подменяются безусловным skip.

R2 expected: родительский kernel suite PASS, generator/receivers равны, immutable source snapshot; tests run from package directory, полный captured log. Build доказывает только сборку. Новый запуск/fixture проверяет требуемые observable agent paths; model behavior не выводится из строкового теста.

A1/A2 oracle: release manifest и installer outputs, текущие binaries/skills/governance digest во ВСЕХ согласованных roots, delivery failures поимённо, preservation локально изменённых owned skills. Exit0/HTTP204/robot «done» не равны успеху. Readback должен доказать соответствие source→bundle→installed receiver, а не только совпадение двух старых копий.

## Риски и rollback

Нормативная правка L2; guards восстанавливают уже объявленные конституционные условия, не меняют authority structure. Новый closure input по прямому запросу владельца, с mutation/regression tests. Installed prefixes не меняются внутри текущих запущенных turns; новый kernel активируется на новых запусках. Перед promotion сохраняются прежние artifact/hash и rollback pointers. Никакого ручного редактирования generated receivers и source-writing scripts.

Robot не коммитит локальный opencode repair; Codex проверяет и коммитит. ADID resident может выполнить только собственный установленный release/commit process в разрешённой части (обязан указать commits), без push за пределами штатного release workflow. Secret tokens берутся read-only внутри bridge client, не выводятся/не пишутся в brief/log/arguments.

## Grounding

✓ CONFIRMED (`git status`): Local_Development, чужая dirty область исключена. ✓ CONFIRMED (API): root host live с nonce, funded DeepSeek/HF entries доступны; ADID host отсутствует, его новый visible TUI понадобится только перед dispatch A1. ✓ CONFIRMED (CodeGraph status/explore): индекс актуален, source читается; sync refused из-за lock живого node19468, lock не удалён. Parent refresh/tool-owned fresh query фиксируются, вместо обхода чужого процесса.

S0 после проверок коммитуется отдельным verified checkpoint до R1. Прочитанные tests импортируют реальный пакет через conftest, без mocks; source/transcript pins перечитываются после изменения.

Pending: source/receiver stamp и delivery evidence. ✓ CONFIRMED (BOM-aware config readback): delivery-roots.json фиксирует текущие 31 configured rows/30 unique roots; после действующего исключения OpenClaw — 30 rows/29 unique roots. Дубликат link-redirector сохраняет flags, installer не выбирает охват сам. Исторический registry содержит 2650 записей, включая test fixtures, и не подменяет configured delivery source.

Организация: root task `4695566a9179750f9eae9bafdac01181e49aa5e6`, codex claim epoch1/lease7200s. R1a child `6eeceb317ccd4f8bf37e454d6c127730101aafb2`, session `ses_ed1b4c028ffey71HMGdhGGm0gA`; prompt ещё не отправлен до S0 commit. Bridge при каждом connect перепроверяет новый host nonce; root host сменился с55624 на59150, новая session создана один раз, дубля prompt нет.
