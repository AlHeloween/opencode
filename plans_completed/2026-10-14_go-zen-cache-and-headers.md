<!-- intention: последние изменения сломали Go/Zen -> исправить подтверждённый контракт кеша и привести заголовки Go/Zen к оригиналу 1.19.0 -->
<!-- goal_sv: provider-contracts 0.40, wire-evidence 0.30, header-parity 0.20, continuity 0.10 -->
# Go/Zen: контракт кеша и заголовки — 2026-10-14

State: COMPLETED (scoped source repair and candidate smoke). User authority: «Окей давай править. Потом поправь заголовки чтобы были как в оригинале».

Revision 2 / continuation authority: «Ок, давай доделаем» (2026-10-15). После отказа child runtime `workspace is out of credits` продолжение ведёт parent BUILD_MODE; границы исходников и acceptance неизменны. Оставшийся envelope: steps=40, tools=60, loops=4, depth=1, time_budget_ms=1800000; не запускать нового writer одновременно с parent. HARNESS receipt `20261014T160220Z_8781c02f`: 31 PASS / 7 FAIL, fixture models не найдены, header predicate не достигнут; не засчитывается как RED продукта. Исправленный harness использует существующий registry fixture для provider binding и явную модель на входе настоящего LLM stream (catalog discovery не является acceptance этого теста).

## Направление и границы

Поддерживает MASTER_PLAN: запрос агента должен опираться на проверенный контракт, а не на одинаковое имя семейства провайдеров. SOURCE-only ремонт, без установки в `bin/`, изменений kernel, gateway.jsonc или пользовательских настроек. Сохранить чужие dirty changes.

Envelope: MODIFY_PROJECT (provider transform, request headers и их тесты), PLAN_WRITE (этот план, MASTER_PLAN renderer, одна scoped запись progress), MODIFY_CANDIDATE (experiments, dist, .temp), EXTERNAL_EFFECT (до 12 bounded provider probes). Budgets: steps=60, tools=100, loops=6, depth=2, time_budget_ms=2700000. Авторизованная цель неизменна; один implementation task одновременно.

## Основания и опровержения

✓ CONFIRMED (прочитанные HTTP receipts): `experiments/2026-10-14_prompt-cache-options-2026-10-14T15-33-29-937Z/summary.json` и raw responses: Go/GLM-5.3-Flash через Perplexity отвергает prompt_cache_retention и ttl=24h; implicit/30m принят HTTP200 и cached_tokens=4480. Go/GLM-5.3 через Fireworks принял implicit/24h, повтор cached_tokens=7839/7840. Это не доказательство 24-часового хранения или применения TTL Fireworks.

✓ CONFIRMED (reference read): external/opencode-1.19.0/packages/opencode/src/session/llm/request.ts:187-205; default client=cli в core/flag/flag.ts:75-76. Go/Zen headers: x-opencode-session-id; x-opencode-session; x-opencode-request; x-opencode-project; x-opencode-client; User-Agent=opencode/<наша реальная версия>; parent names x-opencode-parent-session-id и x-parent-session-id. SDK suffix допустим только после wire capture. Third-party tuning и internal TDA не удалять ради внешнего сходства.

✓ CONFIRMED (runtime response): полный accounts/fireworks/models/glm-5p3-flash через Go с обязательным session header получил HTTP400 Model is unavailable. Не объявлять выбор Fireworks Flash выполненным и не подменять модель GLM-5.3 без Flash.

Structural grounding: CodeGraph queries 2026-10-14 по transform/message/options, opencode-go-cache.test.ts, llm.ts; impact consumers — session/llm, providerOptions, focused provider tests. External query вернул parent-tree source: wrong-tree result retained as tool limitation; external read напрямую по точному пути. Перепроверить current source hashes перед apply.

## Задачи

- [x] C1 Исправить default cache options по проверенным моделям/SDK, убрать универсальный opencode* retention=24h; сохранить явные корректные настройки и обычные провайдеры. ✓ CONFIRMED: baseline17/0 `20261014T154848Z_2b40c7ca`, RED3/10 `20261014T155641Z_480561c2`, post20/0 `20261014T155835Z_89f4fcc3`; полные runner logs без drops/truncation. Actual diff: transform.ts + cache regression test; native SDK wire capture и Anthropic regression PASS. Duration TTL остаётся Unknown. <!-- sv: cache-contracts,model-specific-options,sdk-wire -->
- [x] H1 Привести Go/Zen identity/correlation headers к reference 1.19.0; сохранить third-party tuning, explicit overrides и TDA consumption. ✓ CONFIRMED: qualified RED `20261014T180612Z_403502da`32/6 (missing session-id/parent-id, все HTTP cases достигнуты), post `20261014T180708Z_25360fe9`239/0. Actual diff: llm.ts + llm.test.ts; настоящее LLM/service → compatible Go и native OpenAI Responses Zen → loopback HTTP, parent/no-parent/overrides, Novita и OpenRouter controls, TDA и response-cache regressions. Связь теста с registry discovery не заявлена; синтетическая модель — явный StreamInput. <!-- sv: header-parity,identity,correlation -->
- [x] V1 Независимые focused regression, typecheck, обязательный _build.ps1, source/live request проверка и EXPECTED_FAIL controls. ✓ CONFIRMED: 239/0 `20261014T180708Z_25360fe9`, typecheck exit0 `20261014T180708Z_d12e9228`, build1342 exit0 `20261014T180811Z_340fe7fa`; полный candidate Zen/Muse `20261014T181257Z_8201227a` и Go/Flash `20261014T181445Z_d5e194da` оба OK/stop/exit0. Parent и explorer независимо прочитали полные logs и SQLite message/part; no error. Негативные SDK-only403 и HARNESS failures сохранены в архиве, не объявлены поведением полного клиента. <!-- sv: wire-oracle,regression,candidate-build -->
- [x] D1 Обновить docs/index, progress, master renderer; explorer recheck; scoped commit с именем плана; переместить по фактическому outcome. ✓ CONFIRMED: docs/index + archive23 files readback/secret check; архивные index blobs побайтно совпадают с исходниками (`-text -whitespace`). Source commit receipt `20261014T182156Z_26c7d288`exit0, commit cbd3349aa2, mandatory hooks PASS; финальный amend включает закрытый план, его routing link и только собственные progress записи. Render из repo cwd сохраняет3 чужих manifests; parent/explorer независимо проверили candidate DB/parts. <!-- sv: documentation,plan-closure,evidence -->

## Smoke Tests

Baseline: текущий opencode-go-cache.test.ts должен PASS как воспроизведение прежнего кода, но его blanket-retention assertions superseded raw HTTP400. Новые требования прежде source edit: тест Flash ожидает prompt_cache_options implicit/30m и отсутствие prompt_cache_retention; baseline EXPECTED_FAIL на прежнем source. Аналогично missing x-opencode-session-id и wrong Go universal headers: новый wire test EXPECTED_FAIL до header edit.

Post-change: focused cache + wire-params + relevant transform/header tests PASS; SDK сериализует exact expected fields; native OpenAI SDK использует camelCase options; обычные сторонние API не получают opencode-owned headers. Provider probes считаются принятыми только по HTTP body, model и upstream response headers; 200 без usage не доказывает cache. Срок TTL отдельно Unknown.

Тесты из packages/opencode через cmd_runner; не запускать полную package suite. Полные state.json/stdout_text.log сохраняются. Build default task не запускает full suite; check task запрещён без scope.

## Rollback и остаток

Rollback только scoped patch, не git reset/checkout чужих dirty files. Header parity не обещает устранить FreeTierError: acceptance только по реальному ответу Muse; отказ остаётся именованным residual. Fireworks Flash через Go и фактический TTL=24h остаются непроверенными до отдельных инструментальных receipts.

## Фактическая граница результата

✓ CONFIRMED: полный compiled10.0.1342 в isolated stand реально получил OK/finishstop через Muse и GoFlash; критерий живого ответа Muse исполнен. Отдельный SDK probe с opencode/local получил403: другая request/runtime layer, без причинного вывода о роли одних headers. Cold Go MISS не квалифицирует TTL. Полные source pins, state/stdout digests и controls: `experiments_history/2026-10-14_go-zen-request-repair/evidence.json` и REPORT.md. bin promotion не входил в envelope; keep-warm20min — следующий измеримый idle/control опыт, пока без реализации.

Portfolio recheck: explorer `/root/plan_audit` перечитал source/test/доказательства и независимо readOnly DB подтвердил оба candidate результата. Три старых SVM manifests восстановлены штатным render из правильного repo cwd; чужие источники не менялись. Полный исторический portfolio SUCCESS не заявлен: ранее выявленные unrelated metadata/qualification gaps остаются вне этого ремонта.

```yaml
Keywords: provider-contracts 0.40, wire-evidence 0.30, header-parity 0.20, continuity 0.10
Semantic dominant: Подтверждённый ремонт Go/Zen ограничен контрактом кеша и проверяемыми заголовками.
md5: 58a7d129ec684b1fa50e63d8b2914c07
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```
