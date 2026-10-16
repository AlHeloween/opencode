<!-- intention: CodeGraph остаётся обязательной зависимостью поиска и impact -> локальная навигация по коду через Zoekt/SCIP, связанная с Fossil diff и SV, с проверенной заменой потребителей CodeGraph -->
<!-- goal_sv: Keywords: fossil-diff 0.30, zoekt-search 0.25, scip-navigation 0.20, sv-provenance 0.15, codegraph-migration 0.10
Semantic dominant: Поиск и навигация получают проверяемые адреса версий Fossil и SV до замены потребителей CodeGraph.
md5: e8a16f092bce49a5b9f4130dd7c26e84
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# Zoekt + SCIP + Fossil + SV

## Намерение и границы

Запрос владельца: клонировать sourcegraph/zoekt и scip-code/scip в external/;
«очень хочу отвязаться от codegraph и чтобы было похоже на sourcegraph как в нашем
universal search и чтобы это было заведено на дифы фоссила с нашими SV».

Первый ограниченный проход: исходники, изолированный исполняемый эксперимент,
привязки миграции. Полная замена CodeGraph остаётся целью этого плана, пока
эквивалентность требуемых функций не проверена.

## Execution envelope

ALLOW на основании запроса: READ, PLAN_WRITE, MODIFY_CANDIDATE, EXTERNAL_EFFECT
(получение публичных исходников и зависимостей). Пути: external/zoekt,
external/scip, experiments/2026-10-16_zoekt-fossil/, соответствующий архив
experiments_history/, этот план, docs/README.md, _progress_log.md и generated
body plans/MASTER_PLAN.md. Не редактировать сторонние исходники, bin/ или
production consumers. Не запускать постоянные сервисы. Чужой dirty diff сохранить.
Инструменты: git, Go, Fossil, Python, cmd_runner, node_repl, apply_patch,
read-only CodeGraph и Universal Search. Бюджет прохода: 60 шагов, 90 tool calls,
5 возвратов, глубина 3, 1800000 мс. Независимый read-only explorer: 12 вызовов,
480000 мс, без записи и сервиса.

## Стратегия

Связь с MASTER_PLAN: continuity требует воспроизводимого состояния, адреса
изменённого дерева и доказуемых результатов. Fossil check-in/hash и SV обеспечивают
версионное происхождение поиска. Связанные планы: codegraph-impact-decoupling
(потребитель impact) и project-fossil-cell (SV/comments/mlink). Их задачи здесь
не закрываются по историческим отметкам.

## Критерии и Smoke Tests

1. Клоны: origin соответствует запрошенному URL без tracking query; HEAD читается;
   git status --porcelain пуст; fsck не находит повреждений. Негативный control:
   проверка отличает несуществующий git object от HEAD.
2. Zoekt: известный текст находится по file:line в обычном Fossil checkout без .git;
   отсутствующий sentinel не находится. После check-in изменённый, удалённый и
   переименованный файлы дают актуальные результаты, прежние значения отсутствуют.
3. Provenance: результат связан с Fossil check-in, blob hash, SV из event.comment;
   no-op SV check-in различим от текстового изменения. Диапазон A..B должен работать
   через ancestry, а не сравнение mtime. Контроль — старый индекс не принимается
   за свежий после изменения дерева.
4. Архитектура: исходники и ограничения Zoekt/SCIP проверены; replacement seams
   указывают текущие символы/потребителей; отсутствие доказанного graph parity
   остаётся открытым. Ни build, ни text search не доказывают call graph.
5. Миграция: отдельные сравнительные оракулы search / definition / references /
   impact / SV/history / cancellation / unavailable. Production cutover только
   после parity на фиксированном корпусе; 5 млн сущностей — отдельный benchmark.

Предсказания: clone integrity PASS, неверный object EXPECTED_FAIL. Поиск fixture
до индекса — FAIL; после индекса — PASS. После изменения без индекса stale control
EXPECTED_FAIL; после переиндексации — PASS. Пока инструменты не квалифицированы,
их пробы diagnostic, не доказательство продукта.

## Задачи

- [x] Z1 — клонировать и проверить оба upstream checkout, записать HEAD и receipts.
  <!-- sv: source-acquisition, integrity, upstream-pins -->
- [ ] Z2 — квалифицировать Zoekt build/index/query и Fossil diff/SV на изолированном fixture;
  сохранить команды, полные логи, реальные результаты и проигрывающие controls.
  <!-- sv: zoekt-search, fossil-diff, sv-provenance, differential-oracle -->
- [x] Z3 — записать grounded migration design с текущими consumers Universal Search/CodeGraph,
  Fossil/SV и ограничениями SCIP; независимый explorer и проверка источников родителем.
  <!-- sv: migration-seams, source-grounding, scip-navigation -->
- [ ] Z4 — реализовать локальный adapter/service и сравнительный oracle на реальном корпусе.
  Начать отдельным binding после Z2/Z3; production mutation вне первого envelope.
  <!-- sv: local-service, fossil-cursor, reproducible-parity -->
- [ ] Z5 — заменить CodeGraph consumers после проверенной parity; убрать обязательную зависимость,
  проверить critical flows, отмену, свежесть, отсутствие сервиса и rollback.
  <!-- sv: codegraph-migration, consumer-parity, regression -->

## Риски / rollback

- Unknown: Windows portability и стоимость сборки Zoekt. Изолированная сборка,
  никаких установок в bin/; ошибка сохраняется с полным журналом.
- Inferred: SCIP — формат, не готовый универсальный call graph. Проверить schema
  и indexer ownership до выбора graph модели.
- Unknown: инкрементальность Zoekt на уровне shard/repository. Не выдавать список
  mlink за доказательство частичного reindex.
- Inferred: mlink одного check-in не покрывает произвольный диапазон/ветви/undo.
  До production нужны ancestry и атомарная публикация индекса с revision cursor.
- Rollback первого прохода: остановить только свои процессы; удалить только
  собственные candidate artifacts при необходимости; runtime не меняется.

## Состояние доказательств

CONFIRMED ✓ git status: Local_Development, чужие dirty изменения присутствуют.
CONFIRMED ✓ fs.stat: external/zoekt и external/scip отсутствовали перед клонированием.
CONFIRMED ✓ git check-ignore: обе цели external и experiment исключены из Git.
CONFIRMED ✓ Z3: [отчёт и дизайн](../experiments_history/2026-10-16_zoekt-fossil/REPORT.md),
read-only explorer `/root/search_architecture`, независимое совпадение 7 source hashes
родителем. Review выявил повреждённую text diagram и 2 сокращённых адреса;
оба дефекта исправлены. Inventory — 6 швов, не полный список consumers.
CONFIRMED ✓ readonly SQLite: 496 check-ins, 272 signed на момент чтения,
последний signed check-in `cf64f467b5b2d6deed2bcb38d88740397a3dd32aa794f3f93a60f4bd5ca19b7a`,
полный SV и 3 mlink rows. Primitive control `absent_control` → EXPECTED_FAIL.
CONFIRMED ✓ первоначальные wrapper-вызовы были отклонены до запуска;
подробное основание не возвращено. Вывод о запрете самого cloning REFUTED:
обычный `git clone` через exec_command успешно создал оба checkout.
CONFIRMED ✓ Z1: Zoekt HEAD `74e1e85839697c4c4eb8a6223cc3971e6c26da45`,
SCIP HEAD `e26a0b0fc83424dbfe6c703c0437d4703aec4aa0`; origin совпадает с запросом,
git status --porcelain пуст, git fsck --full --no-reflogs exit 0 у обоих;
absent-path cat-file control exit 1 EXPECTED_FAIL.
[Receipts](../experiments_history/2026-10-16_zoekt-fossil/RECEIPTS.md).
Z1 закрыт, Z2 остаётся открытым. Настройки политик не менялись.

## CLEAN_NEXT_STATE

План ACTIVE, целевая замена CodeGraph не выполнена. Z3 закрыт как read/design
deliverable, actual_diff production = none. Z1 выполнен прямым Git CLI.
Следующий шаг Z2: изолированный Zoekt/Fossil/SV oracle на полученных исходниках.
Z4/Z5 следуют только после этих доказательств. Исторический receipt отказа сохранён;
никакой фоновый clone/job не работает. Полный portfolio audit не выполнялся;
SUCCESS по целому плану не заявляется. Следующий маршрут: G6 qualification
build/index/query instruments для Z2; Full Access не является открытым blocker.
