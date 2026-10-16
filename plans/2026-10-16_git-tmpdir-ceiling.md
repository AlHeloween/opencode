<!-- intention: красный test/git/git.test.ts «branch returns nothing for non-git directories» (t74-резидуал, доказан зондом) -> фикстурный «не-git» каталог, где git действительно не находит репозиторий, ассерт не ослаблен -->
<!-- goal_sv:
Keywords: git-ceiling 0.35, nonrepo-tmpdir 0.30, undiscovered-repo 0.20, assert-intact 0.15
Semantic dominant: Тестовый не-git каталог честно вне репозитория через потолок обнаружения.
md5: 9e4b7c2d1a3f4e5b8c0d2e4f6a8b9c0d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t74-S6 — не-git tmpdir под потолком обнаружения (2026-10-16)

Лист t74 (план `plans_completed/2026-10-16_build-cleanup-vs-tests.md` — все боксы закрыты,
файл уехал в `plans_completed/` чужим reconcile, не трогаю). Остаток: `test/git/git.test.ts`
«branch returns nothing for non-git directories» красный 4/5 — по AGENTS.md pre-existing нет,
нашёл и доказал зондом я, чиню я.

## Grounding (G1)

- Требование теста: вне git `git branch` умирает non-zero. Ассерт (`exitCode not 0`) требование кодирует
  верно — лжёт посылка: фикстурный tmpdir лежит ВНУТРИ worktree (`.temp/test` repo-local с preload),
  git идёт вверх и находит `Local_Development` (зонд: `git -C .temp/test branch --show-current` →
  `Local_Development` exit 0, без фикстуры и маркеров).
- Семантика потолка замерена парой проб: без `GIT_CEILING_DIRECTORIES` — `Local_Development`;
  с потолком на предке — `fatal: not a git repository`, non-zero. Потолок на СТАРТ-каталоге не держит
  (старт всегда обыскивается), потолок на предке держит — поэтому потолок ставится на родителя tmpdir.
- Выбор с обоснованием (владелец просил): (а) каталог вне дерева — отклонено: ломает repo-local
  переносимость preload (права профиля Windows); (б) глобальный потолок в фикстуре/preload —
  отклонено: меняет обнаружение git для ВСЕХ потребителей в процессе (разрешение worktree в Instance
  идёт вверх — load-bearing, не замерено); (в) потолок на один спавн в этом тесте — принято:
  требование живёт в этом спавне, там же и потолок; blast radius = 1 вызов, фикстура не тронута,
  ассерт побайтово тот же. Порог N=60 и маркеры t74 не задеты.

## Tasks

- [x] S6-red-green <!-- sv: ceiling-probe,scoped-env,assert-intact -->
  RED: `bun test test/git/git.test.ts` 4/5 exit 1 на закоммиченном дереве
  (`20261016T121346Z_50cfecd3`, тот же кейс). Фикс: `.env({ GIT_CEILING_DIRECTORIES:
  path.dirname(tmp.path) })` на спавн + комментарий; ассерт не тронут.
  GREEN: 5/5 exit 0 (`20261016T121547Z_d8b370c3`). Receipts: оба state.json прочитаны.

## Claims

- C1: красный — ложная посылка «вне git», а не регрессия t74. Фальсификатор: RED без моих правок
  (зонд без фикстуры + RED на коммите `b42d6ed506`) — оба есть.
- C2: потолок чинит посылку, не ослабляя ассерт. Фальсификатор: GREEN 5/5 тем же файлом.

## Risks

- R1: `GIT_CEILING_DIRECTORIES` scoped на один спавн — соседние тесты/процессы не видят.
- R2: чужой reconcile плана (D + ?? в дереве) — не моё, не коммичу, не трогаю.

## Smoke Tests

- S-red: `cmd_runner start --cwd packages/opencode -- bun test test/git/git.test.ts` → 4/5 до фикса.
- S-green: та же команда → 5/5 после.
