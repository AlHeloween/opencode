<!-- intention: REWARD_FUNCTION утратил численную формулу при сокращении -> точное историческое определение награды возвращено и проверено во всех четырёх локальных вариантах -->
<!-- goal_sv: reward-contract 0.55, semantic-preservation 0.25, installation-parity 0.20 -->
# Восстановить формулу награды и добавить завершение задач — 2026-10-15

State: ACTIVE. Authority: прямое «Верни назад»; SELF_MODIFY source и штатные generated receivers, MODIFY_PROJECT tests/docs, MODIFY_CANDIDATE dist/experiments, PLAN_WRITE. bin/ и ADID consumers вне scope. Новые stop-claim rules не откатываются. Последующее обсуждение BLOCKED сохраняется как отдельный вопрос; статус всей группы из наблюдения одной попытки здесь не вводится.

Envelope: source.py REWARD_FUNCTION + utf8 budget, validate.py ceiling/error, test_addons_claude.py word cap, новый test_reward_restoration.py, baseline.json, generated product/Claude/Cursor/Codex through pipeline; docs/index/progress/MASTER renderer/закрытый план. Budgets: steps40, tools80, loops4, depth2, time_budget_ms2700000. Native coder выполнил только tests; parent выполняет source и oracle. Один source task одновременно.

✓ Основание: Git ff4e679fa3^ содержит точную формулу646 chars; ff4e679fa3 удалил её, 067d9cad2d заменил delta_R на evidence measure. Current rule169chars. Baseline kernel `20261014T185933Z_f16fbd0b`217/0. Новый requirement oracle `20261014T190208Z_f026630c`18 FAIL/1 PASS — source/render не содержат исторический контракт; все failures относятся к утрате текста, harness исполнился.

✓ Размер в памяти (настоящие render_kernel, правильные host identity addons): prod65185B/8673 normalized words, Claude65057B/8750, Codex64976B/8696, Cursor65018B/8772. Точное восстановление требует byte cap66000 и Claude word cap8800 (прочие word caps без изменений). Не оплачивать восстановление удалением чужих норм. Hard ceiling validator обновляется вместе с объявленным budget; boundary остаётся конечной и проверяется.

Structural evidence: CodeGraph source.py/tests/model/render/validate, consumers render_kernel→four installs→compiled prompt. Исторический Gitliteral — независимый fixture; old BP остаётся прежним (готовый reward>0 AND loop_progress_holds), автоматический calculator не добавляется. Aicall capability не применяется: user G8 явно не связывает изолированный model call; реальный literal/render/mutation oracle доступен.

Revision 2 — прямое дополнение владельца: «И добавь в ревард - task_done/((101-%)^2)». Фиксированная цель теперь исторический контракт + отдельное аддитивное слагаемое `task_done/(101 − done_percent)^2`. task_done — число oracle-confirmed завершённых задач; done_percent=100·task_done/total_tasks в том же фиксированном scope. Undefined term omitted по прежнему контракту; новое слагаемое не разрешает эффектов. Исторический fixture сохраняется без изменений, full-rule expectation дополняется новым suffix с отдельными mutation controls. Нужные пределы product/Codex words измерить до применения; maximum finite next band8800. Additional envelope по новой прямой команде: те же пути + test_dedup.py/test_addons_codex.py при необходимости, tools25/steps15/loops2/depth1/time900000ms. Нет нового runtime calculator или изменения BLOCKED.

## Tasks

- [x] R1 Вернуть rule.text byte-exact к ff4e679fa3^; сохранить predicate и все прочие правила; необходимые конечные caps. ✓ full235PASS3stale receiver (1910), after install237PASS1stale baseline (191224), repin+26compatibility/variantPASS (191259), all4actualreceivers exactrender (191330). <!-- sv: reward-contract 0.6,regression 0.3,variant-parity 0.1 -->
- [x] R1b Добавить слагаемое завершения задач по revision2. ✓ RED14FAIL12PASS191247, after26PASS191530, historical fixture неизменён. Native coder manualpatch; parent independentoracle. Product65381/8700,Claude65253/8777,Codex65172/8723,Cursor65214/8799: поднят только Codex word cap8800. <!-- sv: task-completion 0.6,reward-contract 0.3,regression 0.1 -->
- [x] R2 Install4 через pipeline. ✓ install191531exit0; repin4bf6f129...; allkernel243PASS191618; actualreadback4PASS191619. <!-- sv: generated-receivers 0.6,persistent-readback 0.4 -->
- [x] R3 Обязательная _build.ps1. ✓ build20261014T191704Z_63084943exit0, fullstdout/state read, no dropped/truncation; candidate10.0.1343 version smoke и BunFS embedded reasoning_prompt passed. Никакой promotion bin. <!-- sv: candidate-build 0.5,embedded-prompt 0.5 -->
- [x] R4 Docs/index/progress, read-only explorer recheck, MASTER renderer из repo cwd. ✓ Initial source commit a8bae13f6d, runner192817exit0 hooksPASS. План переносится в completed в том же final amended commit; scoped index сохранил unrelated dirtywork. <!-- sv: closure 0.5,evidence 0.3,documentation 0.2 -->

## Smoke Tests

Predictions: original full suite217 PASS; new19tests RED18/1 (captured). Restored text21/0 with boundary cases, mutation-controls reject shortened text and removed clauses. Revision2 adds canonical completion suffix; separate controls reject its lost clauses. Before install full suite may FAIL only stale receiver/baseline pins; classify each, no skips. After install all PASS. Four reward sections preserve byte-exact historical literal plus canonical completion suffix; full receiver bytes == corresponding canonical renderer; other rules unchanged against pre-edit snapshot. Caps finite:66000B,product8700words,otherhosts8800; declared66001 rejected. Build exit0 + version/embedded prompt smoke. Prefix changes deterministically through installation; current sessions stay frozen until ordinary reload.

✓ Read-only explorer reward_restore_tests audit: current source/4receiver pins verified, scoped strategy SUPPORTED against mastergoal, earned R1b/R2 confirmed. Whole active portfolio remains Unknown; no global completion claim. Its missing master reference is resolved by renderer and hand-owned route at closure. Audit artifact: experiments_history/2026-10-15_restore-reward-formula/REPORT.md.

Rollback: scoped patch and pipeline only, never reset unrelated dirty files or manually edit receivers. Preserve failed runs and capture tested artifact hashes. This restores the normative formula, not a new numerical runtime. No reward alone grants authority; historical uncontained-risk execution veto retained literally.

```yaml
Keywords: reward-contract 0.55, semantic-preservation 0.25, installation-parity 0.20
Semantic dominant: Восстановить точную формулу награды без сокращения остальных решений кернела.
md5: 617f4b0ae28149d0a8c369bec5724f13
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 39e651278b7448aa90cd17624f7850e3
```
