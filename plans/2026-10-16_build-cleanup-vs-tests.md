<!-- intention: _build.ps1 стирает .temp/test/ под живыми тестами других роботов (t73: 0/6 llm.test.ts) -> чистка пропускает живые тест-диры (pid-маркер + возраст), мёртвые/старые по-прежнему удаляются (80 ГБ) -->
<!-- goal_sv:
Keywords: build-cleanup 0.30, live-test-dirs 0.25, pid-marker 0.20, scratch-age-fallback 0.15, fixture-oracle 0.10
Semantic dominant: Чистка _build.ps1 пропускает живые тест-диры, мёртвые и старые удаляет как раньше.
md5: 7f3a9c1e5b2d4f6a8c0e1d3b5a7f9c2e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t74 — чистка `_build.ps1` против живых тестов (2026-10-16)

## Goal

`t73` замерил (отчёт в `plans_completed/2026-10-16_cantopen-race-and-promote-argv.md`): ~11:01Z шесть параллельных
`llm.test.ts` легли 0/6 (5× ENOENT в `ensureGitignore` + `SQLITE_CANTOPEN errno 14`), пока чужой робот выполнял
обязательный `_build.ps1`. Первая фаза билда чистит `.temp/test/` (`_build.ps1:97,153` через `Clear-ScratchDir`),
а лок `t58` (`scripts/build-lock.ps1`) сериализует только билды между собой, но не билды против тестов.
`t73` закалил код переживать снос; дыра в процессе осталась: один робот своим билдом удаляет скратч чужих
идущих тестов в том же дереве.

Оба правила владельца сохраняются: билд чистит temp (80 ГБ, владелец 2026-10-03 «Темп 80гиг это слишком»)
И ничей живой тест не теряет свой каталог посреди прогона.

## Grounding (G1)

- `_build.ps1:63-86` `Clear-ScratchDir` — удаляет КАЖДУЮ запись `.temp/test/` (`Remove-Item -Recurse -Force`),
  survivor только при отказе удаления (залоченный файл). Вызывается в `Invoke-Check:97` и `Invoke-Build:153`
  ДО любой работы. Живой тест-дир удаляется молча и полностью — вот дыра.
- `scripts/build-lock.ps1` — эксклюзивный лок билдов (`.opencode/data/build/build.lock`, pid-liveness
  `Test-ProcessAlive`, stale-takeover, t55 maintenance-marker, seams `BUILD_LOCK_DIR`/`BUILD_MAINTENANCE_MARKER`
  для фикстур). Билд против тестов не сериализует — by design, не чинить его.
- `packages/opencode/test/fixture/fixture.ts:17,54` — `TEST_TEMP = OPENCODE_TEST_TEMP ?? os.tmpdir()`,
  `tmpdir()`/`tmpdirScoped()` создают `opencode-test-<random>`; маркера владельца нет.
- `packages/opencode/test/preload.ts:13-18` — `OPENCODE_TEST_TEMP = <repo>/.temp/test`, на процесс
  `opencode-test-data-<pid>` (pid уже в имени — предикат прочитает его без правок preload).
- `docs/build-and-run.md:10-24` — зачем чистка: каждый тест-дир несёт свой `.opencode/node_modules`
  (24–26 МБ), 1 731 дира за день ≈ 43 ГБ; чистка живёт в билде намеренно.
- Замерённые длительности (не гадание): потолок файла 60 с (`setDefaultTimeout(60_000)` в `llm.test.ts:38`,
  `build-lock.test.ts:19`), стена 121 с под 6× contention (`llm.test.ts:35-37`), полный сюит 18 мин
  запрещён (AGENTS.md). Порог рецентности N=60 мин = 30× стены файла и 3× запрещённого сюита;
  масса 80 ГБ — часы/дни — под него не попадает и уходит как раньше.

## Decision — какое исправление и почему

**pid-liveness маркер-РЯДОМ + возрастной фолбэк** (а не только возраст, и не билд-лок против тестов):

- Только возраст N: тест дольше N всё равно теряет дир (гонка осталась, лишь сужена). Отклонено.
- Лок «билд ждёт тесты»: тесты идут минутами, билд обязан бежать после тестов/изменений у каждого робота;
  сериализация билда против чужих тестов = чужие тесты блокируют мой обязательный билд. Отклонено.
- Маркер `<dir>.owner.json` `{pid, started}` РЯДОМ с каждым `tmpdir()` + предикат живости pid (переиспользует приём `t58`: `Test-ProcessAlive` + takeover мёртвых): живой pid не удаляется НИКОГДА, независимо от возраста; мёртвый/без маркера удаляется, кроме свежих (< N мин — живые диры старого кода без маркера и фикстуры `build-lock/`, которым секунды от роду). Оба правила владельца выполнены точно, а не приблизительно.
- Маркер именно РЯДОМ, а не внутри диры (первый черновик): внутри ломает `git status --porcelain` чистым (`test/git/git.test.ts:19`) и точные листинги ripgrep (`test/file/ripgrep.test.ts:158,177`), замерено t74 при граундинге. Соседний маркер не виден ни одному тесту: тесты перечисляют свою диру, а не корень скратча.

## Tasks

- [x] S1-red <!-- sv: scratch-cleanup-oracle,live-pid-red,fixture-layout -->
  Тест `packages/opencode/test/clean-test-scratch.test.ts` в layout `t58` (реальный `scripts/test-scratch.ps1`
  через фикстурный `TEST_SCRATCH_DIR`, реальный `.temp/test` не трогается): дир с живым owner-pid переживает
  чистку. Receipt: RED до фикса (хелпера нет — `pwsh` exit 64): run `20261016T115105Z_52d0543c`, 0/5.
- [x] S2-helper <!-- sv: test-scratch-helper,live-predicate,fixture-seam -->
  `scripts/test-scratch.ps1`: `Test-ScratchEntryKeepReason` (живой owner-pid из соседнего `.owner.json` · имя
  `opencode-test-data-<живой pid>` · `LastWriteTimeUtc` моложе N=60 мин) + `Clear-TestScratch` (позaписно,
  честный отчёт skipped-live/cleaned/failed как `Clear-ScratchDir`). При dot-source — только функции;
  CLI `-Clean` для теста (образец: `build-lock.ps1:135`). Сценарии T6/T7: сирота-маркер и мёртвый pid уходят.
- [x] S3-wire <!-- sv: build-wiring,fixture-marker,ready-surface -->
  `_build.ps1` `Clear-ScratchDir` делегирует в `Clear-TestScratch` (сигнатура/вызовы не меняются);
  `fixture.ts` пишет соседний `<dir>.owner.json` в `tmpdir()` и `tmpdirScoped()` (один хелпер + удаление
  на dispose). `preload.ts` не трогается (pid уже в имени диры).
- [x] S4-green <!-- sv: green-cleanup,regression-build-lock,red-to-green -->
  Тот же файл GREEN (T1 живой пережил, T2 мёртвый удалён, T3 свежий без маркера пережил, T4 старый без маркера удалён, T5 `opencode-test-data-<живой pid>` пережил, T6 сирота-маркер убран, T7 мёртвый маркер убран с дирой); регрессия `build-lock.test.ts` GREEN.
- [x] S5-close <!-- sv: docs-update,progress-log,private-index-commit,build-smoke -->
  `docs/build-and-run.md` (поведение skip-live), `_progress_log.md` (append, BOTH при конфликте), коммиты
  только своих путей через `scripts/commit_own.py`, финальный `_build.ps1` через cmd_runner + `state.json`.

## Claims

- C1: чистка удаляет живой тест-дир сегодня. Фальсификатор: S1 RED не воспроизводится (сентинел пережил
  старую `Clear-ScratchDir` — тогда дыры нет и задача закрывается как OUT_OF_SCOPE с этим receipt).
- C2: после фикса живой owner-pid переживает чистку, мёртвый/старый удаляется. Фальсификатор: S4 GREEN
  по всем пяти сценариям + регрессия t58.
- C3: 80 ГБ концерн покрыт: порог 60 мин не щадит массу часов/дней. Фальсификатор: T4 (старый без
  маркера удалён) RED.

## Risks

- R1: два робота в том же дереве на disjoint-путях — только свои пути (`git add <path>`, никогда `-A`),
  коммиты через `commit_own.py`, `_progress_log.md` через `--shared`+патч; чужой `index.lock` → ждать 5 с.
- R2: полный `bun test` запрещён — ОДИН файл за вызов через cmd_runner из `packages/opencode`.
- R3: старый код без маркера под чисткой — покрыт возрастным фолбэком 60 мин (резидуал: живой дир старше
  60 мин без маркера; все живые диры нового кода маркированы — остаток только у старого кода).
- R4: `bin/` не трогается, `--no-verify` никогда, ядра нет.

## Smoke Tests

- S-red: `cmd_runner start --cwd packages/opencode -- bun test test/clean-test-scratch.test.ts` → RED до S2.
- S-green: та же команда → GREEN после S3 (7/7 сценариев).
- S-regression: `bun test test/build-lock.test.ts` → GREEN (t58 не сломан).
- S-build: `pwsh -NoProfile -File _build.ps1` через cmd_runner из корня, `state.json` прочитан, exit 0.
