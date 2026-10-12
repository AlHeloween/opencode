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

ALLOW на основании прямого запроса владельца: SELF_MODIFY исходника кернела; MODIFY_PROJECT его validator/addons/tests и связанного explorer prompt; PROMOTE_STABLE только declared renderer/installer pipelines; EXTERNAL_EFFECT — org tickets и bounded robot prompts, штатный ADID release/install. Финитные бюджеты от старта этого run: step_budget=240, tool_budget=360, loop_budget=6, depth_budget=3, time_budget_ms=7200000. Общий host-enforced chat deadline отсутствует; leaf-команды и child leases ограничиваются инструментом. Повтор не расширяет бюджет.

Локальные bindings: `prompt_kernel/{source,model,validate,render,addons,addons_claude,addons_codex,addons_cursor}.py`, `prompt_kernel/tests/`, `packages/opencode/src/agent/prompt/explore.txt`, релевантное описание explorer в `agent.ts`; `docs/`, этот план, MASTER_PLAN hand-owned head, `_progress_log.md`, dated `experiments/`/`experiments_history/`. Receivers: production reasoning_prompt.txt, `.claude/reasoning_kernel.md`, `.cursor/rules/reasoning-kernel.mdc`, глобальный Codex AGENTS.md — только pipeline. Baseline pin — metadata hand-edit по фактическому renderer SHA после install; CLI сам baseline.json не обновляет (прочитан cutover.install_production). Rollback pointer сохраняется.

ADID_Python — read-only для Codex; изменение/сборка/релиз/установка принадлежат его RESIDENT robot через org ticket. Он открывает собственные AGENTS/docs/procedуры и конкретизирует локальный binding до изменения. `_release.cmd` — единственный release entrypoint. Пользователь разрешил release/install; робот не получает разрешения на посторонние fixes, account/permission changes, bypass или force push.

`D:/zPython/opencode/bin/**` не редактируется, не заменяется и не продвигается; исключение запуска codegraph sync/status сохраняется. Чужие dirty `dialog-model.tsx` и `agi_workout/2026-10-12_org-epoch-cas-and-argv-residual.md` исключены. OpenClaw follow-up остаётся исключённым по действующему решению владельца; отчёт установки явно называет покрытые roots и остатки.

## Нормативный diff до implementation

- K02/K03: validator отвергает недопустимые edges и malformed FSM; действующий конституционный core не ослабляется.
- K04/K05: машинное представление сохраняет оговорку малого исчерпывающего пространства и lawful non-PASS closure, не превращая stop в SUCCESS.
- K06: общий binding проверяется во всех четырёх registries; host differences остаются объявленными.
- K07–K09: capability→реальный runtime instrument, без вымышленных Hub/LSP/AST/Eval API; refresh имеет владельца и evidence; структурный MCP идёт до scanners на индексированном коде.
- K10: plan является стратегией master goal, lexical presence недостаточна. Explorer перепроверяет существующие планы по source/oracle evidence; parent независимо проверяет report. SUCCESS требует подтверждённого portfolio audit, включая отсутствие неподчинённых планов. Indexed-code grounding/plan binding содержит релевантный graph result либо проверенную причину fallback. Это обязательные inputs/conditions, а не ещё одно advisory повторение.
- Переход к non-success terminal при реальном blocker/budget exhaustion остаётся законным; правило не создаёт бесконечного run.

## Задачи и smoke

- [x] S0 — STABILIZE K01. ✓ CONFIRMED: baseline `20261012T035647Z_115e1035` 142 PASS/3 receiver FAIL; четыре install-команды и hash readback соответствуют renderer, production pin обновлён, rollback pointer сохранён. Parent suite `20261012T040338Z_b8877528` 145 PASS, exit0; `_build.ps1` `20261012T040415Z_b857b088` finished/exit0, candidate10.0.1281, drops0/truncatedfalse. Отдельный named checkpoint до R1. <!-- sv: receivers,baseline -->
- [ ] R1a — K02/K03 validator: недопустимые рёбра и malformed FSM, `tests/test_validation_guards.py`; child reserve step=35/tool=45/loop=2/time=900000. Parent oracle — новый файл + test_architecture/test_constitution. <!-- sv: topology,validation -->
- [ ] R1b — K04/K05 FSM: исчерпывающее малое пространство и lawful non-PASS closure; differential cases в `test_contract_repair.py`; reserve step=30/tool=40/loop=2/time=900000. <!-- sv: decomposition,bounded-closure -->
- [ ] R1c — K06 parity: одно изменение slot проверяется во всех registry; oracle `test_variant_parity.py`; reserve step=15/tool=20/loop=1/time=300000. <!-- sv: host-parity -->
- [ ] R1d — K07–K09 host bindings/explorer: capability table, refresh owner/evidence, graph-before-scanners; oracle addon tests + observed child tool parts; reserve step=35/tool=45/loop=2/time=900000. <!-- sv: host-bindings,codegraph -->
- [ ] R1e — K10 mandatory inputs/conditions: Rule/FSM/PLAN_BINDING/CLOSURE_PROOF contracts и scenario/mutation tests; новое свидетельство имеет consumer в G6/G9. New-session scenario отдельно проверяет tool parts/отказ; строковая проверка не является runtime ACL proof. Reserve step=40/tool=60/loop=2/time=1200000. Runtime TS guards не входят в эту правку без отдельного concrete binding. <!-- sv: strategy,explorer-audit,closure -->
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

Pending: concrete robot task ids, source/receiver stamp, замороженный delivery root list и evidence. До A1/installer список берётся из configured ADID delivery source, фиксируется parent-ом с исключениями; ребёнок не выбирает собственный охват.

Организация: root task `4695566a9179750f9eae9bafdac01181e49aa5e6`, codex claim epoch1/lease7200s. R1a child `6eeceb317ccd4f8bf37e454d6c127730101aafb2`, session `ses_ed1b4c028ffey71HMGdhGGm0gA`; prompt ещё не отправлен до S0 commit. Bridge при каждом connect перепроверяет новый host nonce; root host сменился с55624 на59150, новая session создана один раз, дубля prompt нет.
