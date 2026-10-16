<!-- intention: flaky llm.test.ts под нагрузкой (SQLITE_CANTOPEN) и сломанный relaunch promote_bin при quoted argv[0] -> воспроизводимый критерий для гонки + фикс без ослабления теста, и корректный argv-сплит с фикстурными тестами без касания реального bin/ -->
<!-- goal_sv:
Keywords: cantopen-race 0.30, dispose-late-open 0.25, argv-split 0.20, fixture-oracle 0.15, no-bin-touch 0.10
Semantic dominant: Убрать flaky llm.test под нагрузкой и чиненый relaunch promote_bin с воспроизводимыми оракулами.
md5: a1b2c3d4e5f60718293a4b5c6d7e8f90
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t73 — cantopen-race + promote argv (2026-10-16)

## Goal

1. `packages/opencode/test/session/llm.test.ts` падает 33/34 под нагрузкой с `SQLITE_CANTOPEN`, зелен 34/34 в тишине,
   плавающий кейс (opencode-go / opencode). Адрес t68: `tmpdir` → `Instance.provide` → `projectUse` — гонка
   dispose-vs-late-open. Сначала репликация с критерием, потом фикс в фикстуре или коде. Направление одностороннее:
   тест подстраивается под требование, никогда не ослабляется.
2. `scripts/promote_bin.py`: хост, запущенный как `"D:\zPython\opencode\bin\opencode.exe"` (quoted argv[0] без args),
   записал всю строку в ARGUMENTS и реланчнул `...opencode.exe "D:\...\opencode.exe"` → опенкод принял свой путь за
   project dir. Чинить argv-сплит (quoted/unquoted × с/без args) + фикстурные тесты в существующем layout (t55/t60).
   Реальный `bin/` в тестах не трогать.

## Grounding (G1)

- `packages/opencode/test/session/llm.test.ts` — каждый кейс `await using tmp = await tmpdir({init})` + `Instance.provide({directory: tmp.path, fn})`,
  без `Instance.dispose`, без сериализации. Фикстура `packages/opencode/test/fixture/fixture.ts:20` прямо пишет:
  boot мутирует процесс-глобальные пути/логи — живые кейсы не должны пересекаться; сериализация есть только в
  `provideTmpdirInstance` через `tmpdirInstanceLock` (Semaphore 1) + финализатор с `Instance.dispose` + `Log.reopen`.
  `llm.test.ts` этот путь обходит — под нагрузкой (параллельные файлы/процессы, общий `OPENCODE_TEST_TEMP`)
  глобальные пути, `Instance.cache` и `pathClientCache` (`packages/opencode/src/storage/db.ts:22`) гонят друг за другом;
  `await using` удаляет каталог, а закэшированный клиент/поздний `getProjectDb` открывает файл под удалённым деревом → `SQLITE_CANTOPEN`.
- `Instance.dispose` (`packages/opencode/src/project/instance.ts:167`) чистит `disposeInstance` + `cache`, но НЕ `Database.close()`
  (только `disposeAll`); `closeProjectDb` — no-op. Кэш `pathClientCache` растёт без выселения на каждый tmpdir.
- `scripts/promote_bin.py:358` `parse_cmdline_args`: наивный `cmdline.split()`; quoted argv[0] без args
  (`'"D:\\...\\opencode.exe"'`) возвращается как `['"D:\\...\\opencode.exe"']` и уходит в `relaunch_command` как ARGUMENTS.
  Условие `len(parts) > 1` не покрывает одиночный exe-токен. Запись инцидента:
  `.opencode/data/promotion/promotion-20261016-180629.json:12` — `"cmdline": "\"D:\\zPython\\opencode\\bin\\opencode.exe\""`.
- Существующий layout: `packages/opencode/test/promote-bin.test.ts` (t55, тёплые сценарии через фикстуру),
  `packages/opencode/test/promote-bin-cold.test.ts` (t60, холодный кейс). Реальный `bin/` не трогается (`--fixture-dir`).

## Tasks

- [x] L1-repro <!-- sv: cantopen-replication,parallel-criterion,red-receipt -->
  Критерий репликации: N параллельных прогонов `llm.test.ts` (или инжектированная задержка, форсирующая late open
  после dispose) даёт RED с `SQLITE_CANTOPEN`. Receipt: RED-лог под критерием до фикса.
- [x] L1-fix <!-- sv: fixture-serialization,instance-dispose,db-eviction -->
  Фикс гонки в фикстуре или коде (сериализация через существующий lock-путь / `Instance.dispose` после каждого кейса /
  выселение DB-клиента удалённого tmpdir — по факту репликации, минимально). Направление: тест под требование.
  Receipt: GREEN под ТЕМ ЖЕ критерием.
- [x] L2-fix <!-- sv: argv-split,quoted-exe,windows-quoting -->
  `parse_cmdline_args`: Windows-точный сплит с кавычками (правила `CommandLineToArgvW` для `\"`), одиночный exe-токен → `[]`.
  Матрица: quoted/unquoted argv[0] × с/без args (+ bare `opencode` / `opencode.exe`).
- [x] L2-tests <!-- sv: fixture-tests,promote-argv-oracle,no-bin-touch -->
  Фикстурные тесты в существующем layout (новый `packages/opencode/test/promote-bin-argv.test.ts`, стиль t55/t60 —
  вызовы `parse_cmdline_args`/`relaunch_command` через `python`, только fixture-пути). Receipt: RED до фикса, GREEN после.
- [x] L9-close <!-- sv: progress-log,private-index-commit,build-smoke -->
  `_progress_log.md` (append, keep BOTH при конфликте), коммиты только своих путей через `scripts/commit_own.py`,
  `_build.ps1` через cmd_runner + `state.json`, финал: что менялось (пути+хэши), что запускалось (команда/run id/exit),
  что не закрыто.

## Claims

- C1: гонка — dispose-vs-late-open через несериализованный `Instance.provide` + удаление tmpdir при живом кэше DB.
  Фальсификатор: RED под критерием не содержит `CANTOPEN` / не привязывается к dispose-окну.
- C2: quoted argv[0] без args возвращается как ARGUMENTS. Фальсификатор: `parse_cmdline_args('"D:\\x\\opencode.exe"') == []`
  уже сегодня (до фикса — ожидается `['"D:\\x\\opencode.exe"']`).

## Risks

- R1: параллельные прогоны задевают чужих роботов в том же дереве — только чтение + свои tmpdir под `.temp/test/`,
  коммиты только своих путей через `commit_own.py`, никакого `bin/`, никакого `--no-verify`.
- R2: полный `bun test` без пути запрещён — только ОДИН файл за вызов через cmd_runner из `packages/opencode`.

## Smoke Tests

- S-L1-red: критерий репликации → RED (`SQLITE_CANTOPEN`) до фикса.
- S-L1-green: тот же критерий → GREEN после фикса.
- S-L2: `bun test test/promote-bin-argv.test.ts` → RED до / GREEN после; регрессия
  `bun test test/promote-bin-cold.test.ts` GREEN.
- S-build: `pwsh -NoProfile -File _build.ps1` через cmd_runner, `state.json` прочитан.
