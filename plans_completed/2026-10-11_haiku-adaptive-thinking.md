<!-- intention: Claude Haiku 5.5 отклоняет thinking.type.enabled -> совместимый adaptive thinking и effort без регрессий старых Claude -->
<!-- workflow: lifecycle COMPLETED | gate G9 -->
# Claude Haiku 5.5: совместимость thinking

Дата: 2026-10-11. **Status:** COMPLETED.

```yaml
Keywords: haiku-5.5 0.40, adaptive-thinking 0.30, sdk-wire 0.20, regression 0.10
Semantic dominant: Исправить параметры thinking Haiku 5.5 и проверить сериализацию настоящим SDK.
md5: 7ac164db203b49af985ceb70106a8d42
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Контекст и границы

✓ CONFIRMED (CodeGraph, baseline transform.ts:626–633, 919–947): до исправления `anthropicAdaptiveEfforts` не распознавал Haiku 5.5; `variants` выбирал старые `enabled`/`budgetTokens`.
✓ CONFIRMED (git status до работы): Local_Development, исходное рабочее дерево было чистое.
Требование из сообщения владельца: «Так изучи вопрос и отправь робота его разрулить». Дополнение: поиск причин выполняет Codex, локализованное кодирование — DeepSeek/Smit.
Цель фиксирована: совместимость Haiku 5.5. Остальные новые семейства Claude и полный переход API исключены из этого плана.

## Prior art

Первичный контракт: https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide , прочитан 2026-10-11; раздел Configure thinking требует adaptive и output_config.effort. Содержание источника — Inferred, не доказательство поведения данного проекта.
Переиспользуем существующий `anthropicAdaptiveEfforts` и ветви `variants`; новая архитектура не нужна.

## Приёмка и задачи

- [x] T1: ✓ CONFIRMED (независимый Codex run `20261010T194432Z_8e254dcc`, 181 pass): Smit добавил регрессионные случаи Haiku 5.5 и расширил общую классификацию. Anthropic, Vertex, gateway, Bedrock, SAP; старый Haiku 4.5 сохраняет enabled. Набор low/medium/high/xhigh/max подтверждён первичным Haiku контрактом.
- [x] T2: ✓ CONFIRMED (Codex `20261010T194432Z_8e254dcc`, 181/181; `20261010T194433Z_1740217c`, exit 0): независимые целевые тесты, SDK wire probe, diff review и typecheck.
- [x] T3: ✓ CONFIRMED (build `20261010T194523Z_4fcaf6d6`, exit 0; read-back docs): обязательный `_build.ps1`, доказательства и документация сохранены, план перенесён. Scoped commit выполняет Codex на границе G9; его subject называет этот план.

## Smoke Tests

Прогноз до исполнения: существующий transform.test.ts — PASS; новый wire.test.ts — EXPECTED_FAIL именно на thinking.type (enabled вместо adaptive); после исправления обе проверки — PASS, typecheck — PASS, build — PASS. Непредсказанный исход классифицируется отдельно.
Команды из packages/opencode, через cmd_runner:
1. `bun test test/provider/transform.test.ts` — ✓ CONFIRMED baseline PASS: 170/170, exit 0, run `20261010T193843Z_27e29073`, full log read, dropped=0/truncated=false.
2. `bun test ../../experiments/2026-10-11_haiku-adaptive/wire.test.ts` — ✓ CONFIRMED EXPECTED_FAIL: run `20261010T194005Z_deacc887`, exit 1, SDK body thinking.type=enabled; asserted adaptive. Перехват fetch настоящего Anthropic SDK, без сети и ключей владельца. Первое исполнение `20261010T193949Z_0fea7d67` было HARNESS FAIL (package resolution из experiments); imports исправлены на package node_modules, после повторной квалификации проба выполнена заново.
3. После изменения: `bun test test/provider/transform.test.ts test/provider/transform-anthropic-adaptive.test.ts` и команда 2.
4. `bun typecheck`.
5. Из корня: `pwsh -File _build.ps1 -Task build`.
Фальсификатор: SDK body содержит enabled/budget_tokens либо не содержит output_config.effort; старый Haiku меняет семантику; целевой тест/typecheck/build не завершён или red.
Живой платный запрос Haiku и установка в bin не входят в разрешение; API acceptance и работа установленного TUI не заявляются доказанными.

## Binding / ALLOW

T1, sv: haiku-5.5 0.45, adaptive-thinking 0.35, regression 0.20.
Пути MODIFY_PROJECT: `packages/opencode/src/provider/transform.ts` (anthropicAdaptiveEfforts/variants), `packages/opencode/test/provider/transform.test.ts`, новый `packages/opencode/test/provider/transform-anthropic-adaptive.test.ts`.
Codex PLAN_WRITE: этот план, `_progress_log.md`, docs/README.md и docs/haiku-adaptive-thinking.md; scratch: experiments/2026-10-11_haiku-adaptive/**; build: dist/**, packages/opencode/dist/**, .temp/** и штатные generated outputs `_build.ps1`.
Oracle: actual diff + целевые тесты + настоящее SDK body + typecheck + build, независимый повтор Codex.
Исполнитель: сервер текущего worktree через `tools/opencode_host.py`, DeepSeek deepseek-flash, одна новая сессия, без второго сервера. READ внешнего первичного источника разрешён задачей исследования.
Бюджет root: steps 60, calls 120, loops 3, depth 2, time 3600000 ms; Smit резервирует steps 24, calls 40, loops 2, time 1200000 ms. После исчерпания STOP с partial state.
Запрещено: kernel/governance/config/каталоги моделей, bin/**, чужие dirty изменения, commit/push роботом, полные suites, CPU inference, обход permission refusal. Ошибка вне binding — STOP с адресом.
Rollback: только scoped hunks текущей задачи после read-before-edit, никогда checkout целого файла поверх сторонней правки.

## Claims / risks / SVM

Claim C1: неверная классификация модели — ✓ CONFIRMED runtime SDK capture: baseline `20261010T194005Z_deacc887` EXPECTED_FAIL, body thinking.type=enabled. Источник ошибки именован; statement hash будет сохранён в evidence report.
Claim C2: ✓ CONFIRMED (Codex `20261010T194432Z_8e254dcc`): SDK wire adaptive, budget_tokens отсутствует, output_config.effort=high.
Risk R1: чужой Claude получает новый режим. Containment: точный ограниченный matcher + legacy regression.
Risk R2: SDK сериализует effort иначе. Containment: настоящий SDK с локальным fetch capture.
Risk R3: live TUI остаётся на старом бинарнике. Boundary: build только в dist, продвижение требует владельца.
SVM: turn root-haiku-20261011, parent null; goal_hierarchy level 0 = намерение; goal_vector = этот план; task_vector T1–T3 completed. Evidence_vector: source/test SHA-256 ниже, host robot session, полные cmd_runner logs. Oracle_vector: baseline existing PASS `20261010T193843Z_27e29073`, baseline wire EXPECTED_FAIL `20261010T194005Z_deacc887`; post PASS `20261010T194432Z_8e254dcc`; typecheck/build PASS; verdict локального исправления PASS. Remote API/installed TUI: Unknown/excluded.

## Закрытие

Reopen_when: новый воспроизводимый Haiku 5.5 failure либо изменение SDK/контракта, опровергающее сохранённые проверки.

## T1 implementation result

✓ CONFIRMED (git diff/read + Codex oracle): actual_diff — transform.ts, только Haiku 5.5 aliases в anthropicAdaptiveEfforts; новый transform-anthropic-adaptive.test.ts (10 cases, actual SDK capture). Остальные исходники не затронуты.
✓ CONFIRMED (host API): robot session `ses_ed8aabe9affeEv2RzS5q0Owsds`, DeepSeek `deepseek-flash`, `/session/status` idle + assistant finish=stop/completed; второго сервера нет.
✓ CONFIRMED (полный baseline log): новый regression suite до source-edit `20261010T194309Z_6efcb501` — 3 pass / 7 fail, exit 1; фальсификатор воспроизведён. Post-report робота — свидетельство; stamp берётся с повторного запуска Codex.
✓ CONFIRMED (полный независимый log): `20261010T194432Z_8e254dcc`, exit 0, 181 pass / 0 fail, bytes_dropped=0, truncated=false; stdout SHA-256 `ba758313a274ea510fc8ad2e6f83466c4819f6505a2bb2280094d564a4b44a35`.
Остаток T1: live API acceptance не измерена и в этот план не входит. Инструментный риск: root probe сначала имел неверный module-resolution base (HARNESS), исправлен и повторён целиком; robot дважды прочитал неподтверждённый .bun путь (file not found), затем использовал существующий путь; права не обходились.

## T2 / T3 stamps and closure

✓ CONFIRMED (полные logs/state): typecheck `20261010T194433Z_1740217c`, exit 0; SHA-256 stdout `e552052b9e31b7c42678a80d4335a4eefb95c23fc62b3ed98b7432332e7e51ec`.
✓ CONFIRMED (полные logs/state): `_build.ps1 -Task build`, run `20261010T194523Z_4fcaf6d6`, exit 0; bytes 51444, dropped 0, truncated false; SHA-256 stdout `308caf93e47faabdc83dfa4c5cb9debfd796b62f818583cb52684288509a704c`.
✓ CONFIRMED (SHA-256 raw bytes): post-source `transform.ts` = `b699a74abddf1c99f85015956c84db9c5d4cfce3f176ceecddb883efa818affd`; regression file = `f231ebace32e6761fcb5be8b70b78758936bc8133f20ca8842db7568e108a20c`.
Baseline source SHA-256 = `6ad34a385e4f90d385d5f549f270b263e4aa81ffd9b5d40dc58757665561411d`; EXPECTED_FAIL wire log SHA-256 = `163b444b3243f5a71cac397d5e3a7ec173e39ed039f50a3f0f6aca7631c503ae`.
Stamp serialization: UTF-8 raw artifact bytes, SHA-256; statements and their input hashes are bound in `oracle-stamp.json` scratch, not by semantic-vector labels.

CLOSURE_PROOF: приёмка локального исправления покрыта; 181 tests + SDK wire + typecheck + build PASS; critical risks 0. Live API и продвижение в bin — explicitly excluded, Unknown. `--version` нового кандидата — дополнительная диагностика запуска, не доказательство API acceptance.
✓ CONFIRMED (candidate diagnostic `20261010T194742Z_104a8d0b`): exit 0, version 10.0.1270, credential env names blocked; binary SHA-256 `83c977cff7352a887ce4fecc798a606d46a58f01729e3f8f772c8df1f33ab843`.
Build retained signals: Rust future compatibility syn 0.11.11; Cargo metadata/LICENSE warnings; Vite mixed dynamic/static imports и крупные chunks. Exit 0, ни одного build error; эти предупреждения не исправлялись в плане thinking.
Tools: CodeGraph дал blast radius, но тестовые callback assertions пришлось читать напрямую, поскольку symbol slice их не включал. cmd_runner state/logs — без dropped/truncated. Host API завершил observable robot session; файловые not-found и HARNESS FAIL записаны, не зачтены за доказательства.
Stop_reason: bounded requested source repair verified. Residual route: live installed Haiku smoke после разрешённого продвижения владельцем; reopen только по воспроизводимому отказу либо изменению зависимостей.
