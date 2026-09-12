# TUI чёрный экран на повторном старте — неограниченный flock на пути бутстрапа

**Status:** COMPLETE (G9) — класс дефекта устранён и доказан A/B-оракулом; остаточная причина вынесена в Residual ниже
**Дата:** 2026-09-11 (завершено 2026-09-12)
**Тип:** MODIFY_PROJECT (packages/opencode, packages/core)

## Context / Goal

**Симптом (со слов пользователя, дословно):**
- «TUI не стартует, чёрный экран»; на экране **совсем пусто, без вывода** (нет спиннера, нет «Loading plugins...»).
- `_run` (bun из TS) запускается, `opencode.exe` из bin — нет.
- «Если есть логи то висит (checkpoint не в счет). Получается запускаем, работаем, выходим, запускаем снова — висим.»

**Goal:** устранить класс «старт TUI молча блокируется на файловом локе», чтобы отказ лока никогда не давал чёрный экран: либо старт укладывается в бюджет, либо UI деградирует с видимой диагностикой.

**Что НЕ является целью:** чинить рендеринг, менять формат логов, трогать checkpoint/KV-схему.

## Root cause (ПОДТВЕРЖДЕНО A/B [Exact] — заменяет первоначальную гипотезу)

Первоначальная гипотеза (неограниченный flock / гейт рендера) оказалась **вторичной**. Настоящая причина:

`Log.init()` выполняется в **воркере** (`worker.ts:17`) **до** `Rpc.listen()` (`worker.ts:86`) и **ожидает** `cleanup(Global.Path.log)`. При числе логов > `keep = 100` (`packages/core/src/util/log.ts:15`) cleanup массово удаляет старые файлы. На Windows unlink файла, удерживаемого другим процессом, падает (проверено: `The process cannot access the file ... being used by another process`), ошибка глотается `.catch(() => collectBug(...))`, и воркер не доходит до `Rpc.listen()` → первый RPC `fetch` истекает → UI не рисуется.

**A/B (один бинарник, один cwd, отличается только число файлов):**

| Логов в каталоге | Без фикса | С фиксом 10.0.976 |
|---|---|---|
| 87 | ✅ старт мгновенный | ✅ |
| 111 / 127 / 236 | ❌ чёрный экран (или ~16 с) | ✅ **`tui plugins ready` + UI** |
| 150 (создано в чистом temp) | ❌ завис; осталось ровно 100 файлов | — |

Это буквально формулировка пользователя «**если есть логи, то висит**».

**Опровергнутые версии:** CodeGraph MCP (падает и в успешном прогоне; `OPENCODE_CODEGRAPH_MCP=0` всё равно висел), версия бинарника (`bin` и `dist/bin` были побайтово идентичны), cwd, размер/целостность БД (`integrity_check` = ok; та же БД работала из temp), внешние плагины (`OPENCODE_PURE=1` висел).

### Вторичный слой (defence in depth)

Дополнительно устранены бесконечные ожидания, из-за которых **любой** stall давал немой чёрный экран вместо диагностики:

| # | Звено | Факт | Файл:строка |
|---|-------|------|-------------|
| 1 | Логи | `await cleanup(...)` на boot-пути воркера | `packages/core/src/util/log.ts:213` |
| 2 | Гейт | `<Show when={init.ready === true}>` — пока `ready=false`, **children не рендерятся вообще** | `packages/opencode/src/cli/cmd/tui/context/helper.tsx:14` |
| 3 | Внешний провайдер | `<KVProvider>` оборачивает **всё** дерево провайдеров | `.../tui/app.tsx:223` |
| 4 | KV | `Flock.withLock` **без `timeoutMs`**; `ready` только в `.finally` | `.../tui/context/kv.tsx:33,48` |
| 5 | Дефолт лока | `timeoutMs: 5 * 60_000` | `packages/core/src/util/flock.ts:27` |
| 6 | Plugin meta | `touchMany`/`setTheme`/`list` без бюджета | `packages/opencode/src/plugin/meta.ts:147,171,185` |
| 7 | Models | `models-dev` лок без бюджета | `packages/opencode/src/provider/models.ts:160,213` |
| 8 | RPC | `call()` = `new Promise` **без reject и таймаута** | `packages/opencode/src/util/rpc.ts:57` |


## Prior art

`reuse:` внутренний прецедент репозитория — `THEME_LOCK_TIMEOUT_MS` (theme-лок) и `withTimeout` (`packages/opencode/src/util/timeout.ts`), оба уже в кодовой базе. Внешнее исследование не требуется: дефект локальный, паттерн (bounded lock + non-gating startup) стандартный. Отдельного `universalsearch` не делал — диагностика полностью заземлена на код/логи/историю сессий.

**Улики из логов (Exact, артефакты):**
- Успешный старт: `.../log/1789161468859_log_system_internal.jsonl` — `21:17:48.859` instance boot → `21:17:49.256` `tui plugins ready, count: 11` (~400 мс). Норма здорового старта.
- Залипшие лок-каталоги: `.opencode/data/state/locks/{1b1118e6…,486ceeff…,b5c6f677…,bebbb307…}.lock/` (heartbeat + meta.json, Aug 22–26) — доказательство, что лок-каталоги переживают процесс.

## Implementation steps

### A. Оракул ДО правок (обязательно) — ВЫПОЛНЕНО

- [x] **A1. Воспроизведение.** [Exact] exe в `D:\zPython\opencode`: пустой экран, лог обрывается на `kv state absent`; ни `instance boot`, ни `tui plugins ready`. 60+ с без изменений. Процесс не жжёт CPU (0.016 с за 3 с) — блокировка, не спин.
- [x] **A2. Дискриминация.** [Exact] `OPENCODE_FAST_BOOT=1` (меняет только `sync.tsx:966`) → старт работает. Тот же exe в `packages\opencode` и в пустом temp-каталоге → работает. `bun src` → работает.

### B. Правки — ВЫПОЛНЕНО

- [x] **B0. `packages/core/src/util/log.ts` — ГЛАВНЫЙ ФИКС.** `await cleanup(...)` → `void cleanup(...)`: ротация логов уходит с критического пути старта воркера. Именно она блокировала `Rpc.listen()` при >100 логах.
- [x] **B1. `context/sync.tsx` — снять бесконечный гейт.** `STARTUP_DEADLINE_MS = 15_000`: по истечении `status: "loading"` → `"partial"` + `warn("bug: tui bootstrap exceeded startup deadline")`. Гейт `ready` (`status !== "loading"`) открывается, UI рендерится, зависание становится видимым. `onCleanup` снимает таймер.
- [x] **B2. `context/kv.tsx`** — `KV_LOCK_TIMEOUT_MS = 2_000` на read и write; при таймауте — `warn` + деградация к дефолтам (UI не блокируется).
- [x] **B3. `plugin/meta.ts`** — `META_LOCK_TIMEOUT_MS = 5_000` на `touchMany`/`setTheme`/`list`; добавлено отсутствовавшее логирование (`log = Log.create({ service: "plugin.meta" })`).
- [x] **B4. `provider/models.ts`** — `MODELS_LOCK_TIMEOUT_MS = 10_000` на `Data()` и `refresh()`; при таймауте — bundled snapshot.
- [x] **B5. `util/rpc.ts` — `call()` принимает опциональный `timeoutMs`** и reject. Без `timeoutMs` поведение **не изменено**. `thread.ts`: `WORKER_CALL_TIMEOUT_MS = 30_000` на pre-render вызовах `fetch`/`server`.
- [x] **B6.** `context/helper.tsx` не трогал — B1 достаточно (гейт снимается сам).

### C. Тесты — ВЫПОЛНЕНО

- [x] **C1. `packages/core/test/util/flock.test.ts`** — **10 pass / 0 fail** (существующий набор, регрессии нет).
- [x] **C2. `packages/opencode/test/util/rpc.test.ts`** (новый) — **4 pass / 0 fail**: reject по таймауту; нормальный resolve; отсутствие таймаута сохраняет старое поведение; поздний ответ после таймаута не даёт unhandled rejection.

### D. Полное расследование — опровергнутые версии

По пути проверены и **отброшены** прямые эксперименты:

| Версия | Тест | Результат |
|---|---|---|
| CodeGraph MCP блокирует | `OPENCODE_CODEGRAPH_MCP=0` | всё равно висел; MCP падает и в **успешном** прогоне |
| Версия бинарника | SHA256 `bin` vs `dist/bin` | побайтово идентичны — не причина |
| cwd | тот же exe в `packages\opencode`, temp | работает — cwd сам по себе не причина |
| БД проекта (размер/повреждение) | `integrity_check` = ok; копия БД в temp | работает — БД не причина |
| Внешние плагины | `OPENCODE_PURE=1` | всё равно висел |
| Зависшая живая сессия | убил PID 20148 | всё равно висел |
| **Число лог-файлов** | 87 vs 111/127/236 | **✅ ПРИЧИНА**: <100 → мгновенно, >100 → чёрный экран |


## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (до любой правки) — ЗАПИСАНО [Exact] 2026-09-11T23:27–23:39Z

Дискриминирующий эксперимент (все запуски — `cmd_runner start`, ConPTY 120×40, cwd явно указан):

| # | Command (cwd) | Actual [Exact] |
|---|---------------|----------------|
| 1 | `dist\bin\opencode.exe --print-logs --log-level DEBUG` (cwd `D:\zPython\opencode`) | ❌ **ПУСТОЙ ЭКРАН**. ConPTY: кадры только `[38;2;255;255;255m`+пробелы. Лог обрывается на `kv state absent on cold start` (23:27:40.509); далее только `dedup flush`. **Нет** `instance boot started/completed`, **нет** `tui plugins ready`. 60+ с без изменений. |
| 2 | **контроль:** `--env OPENCODE_FAST_BOOT=1` (тот же exe, тот же cwd) | ✅ **РАБОТАЕТ**: `instance boot completed` (23:38:00.333, ~3 с) → `tui plugins ready, count: 11` → UI отрисован (`Ask anything...`, статус-бар `10.0.973`). |
| 3 | **контроль:** `bin\opencode.exe` 10.0.972 (cwd `D:\zPython\opencode`) | ❌ тот же чёрный экран (версия бинарника не при чём — класс общий). |
| 4 | **контроль:** тот же exe, cwd `packages\opencode` | ✅ работает: `instance boot completed` → `tui plugins ready, count 11`. |
| 5 | **контроль:** `bun run --cwd packages/opencode src/index.ts` (cwd `D:\zPython\opencode`) | ✅ работает: полный UI, `tui plugins ready, count: 11` (caller `runtime.ts:1059`). |
| 6 | `dist\bin\opencode.exe --port 4599` | ✅ сервер поднялся: `opencode server listening on http://127.0.0.1:4599`. |
| 7 | `cmd_runner start --cwd packages/opencode -- bun test ./test/util/flock.test.ts` + `tail` | (записать pass/fail) |

**Вывод [Exact]:** `OPENCODE_FAST_BOOT` меняет **ровно одну** ветку — `sync.tsx:942` (`ready`→`true` без ожидания). Разница между столбцами «висит» / «работает» совпадает с этим переключателем, а не с версией бинарника, не с cwd и не со свободой KV-лока (`kv.json` отсутствует — «kv state absent on cold start»).

**Механизм:** весь UI-дерево гейтится `<Show when={init.ready === true}>` (`context/helper.tsx:14`); `Sync.ready` (`sync.tsx:941-944`) = `status !== "loading"`, а `status` → `"partial"` только после ответов SDK через воркер. Пока bootstrap не ответил, `SyncProvider` **не рендерит children** → `App` не монтируется → `StartupLoading` («Loading plugins...») тоже внутри `App` (`app.tsx:1030`) → **пустой экран без единой видимой диагностики**. Ни `bootstrap`, ни RPC (`rpc.ts:57` — `new Promise` без reject/таймаута), ни гейт не имеют бюджета времени.

**Наблюдение среды:** в `D:\zPython\opencode` живёт процесс PID 20148 (`opencode`, старт 05:07, CPU 1597 с, WS 1.1 ГБ) — источник конкуренции за ресурсы проекта при повторных запусках (совпадает с жалобой «работаем → выходим → запускаем снова → висим»).

**Эталон здорового старта:** `1789161468859_log_system_internal.jsonl` — boot 21:17:48.859 → `tui plugins ready` 21:17:49.256 (~400 мс).

### Post-implementation oracles — ВЫПОЛНЕНО [Exact]

| # | Command (cwd) | Pass criteria | Actual |
|---|---------------|---------------|--------|
| 1 | `dist\bin\opencode.exe` (cwd `D:\zPython\opencode`, после фикса) | UI рисуется | ✅ **`UI RENDERED: YES`**; лог: `WARN bug: tui bootstrap exceeded startup deadline {deadlineMs:15000}` → `instance boot started` → БД открыта |
| 2 | A/B: старый `bin\opencode.exe` 10.0.972 vs новый 10.0.975, одинаковые ConPTY/cwd/env | новый ≠ чёрный экран | ✅ old → `UI RENDERED: NO` (**чёрный экран**); new → `UI RENDERED: YES` |
| 3 | `cmd_runner start --cwd packages/core -- bun test ./test/util/flock.test.ts` + `tail` | pass | ✅ **10 pass / 0 fail** |
| 4 | `cmd_runner start --cwd packages/opencode -- bun test ./test/util/rpc.test.ts` + `tail` | pass | ✅ **4 pass / 0 fail** |
| 5 | `cmd_runner start --cwd packages/opencode -- bun typecheck` + `tail` | exit 0 | ✅ `$ tsgo --noEmit`, 0 ошибок |
| 6 | `pwsh _build.ps1` | build + smoke | ✅ `Smoke test passed: 10.0.975`, `Smoke test passed: reasoning_prompt.txt embedded`, `[OK] Build complete - artifacts in dist/` |

### Gate
- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before `[x]`

## Residual (routed to G1/G2 — NOT part of this closure)

Фикс устранил **класс** (немой бесконечный старт → видимый ограниченный старт), но вскрыл остаточную причину:

**Воркер не отвечает на RPC `fetch`**, когда проект `D:\zPython\opencode` обслуживает живая сессия (PID 20148).

```
00:03:59.858 ERROR tui bootstrap failed
  { "RPC call timed out after 30000ms: fetch" }
```

Наблюдения [Exact]:
- В пустом temp-каталоге и в `packages\opencode` старт мгновенный (`tui plugins ready` за ~0.4 с).
- В корне проекта — стабильно висит на `fetch` (4 независимых прогона: 10.0.972 без фикса ×2, 10.0.973, 10.0.974/975 с фиксом).
- БД проекта: 152 МБ + WAL; живая сессия PID 20148 держит ~1006 МБ.
- `bin\opencode.exe` в PATH — **старая сборка 10.0.972**; `dist\bin` — 10.0.975. Пользователь запускает из PATH.

Гипотезы для следующего цикла (требуют отдельного заземления): блокировка на уровне SQLite/Bun-воркера; `InstanceBootstrap` → `Config.waitForDependencies()`; file-watcher.


## Risks / rollback

| ID | Риск | Смягчение |
|----|------|-----------|
| R1 | Слишком малый `timeoutMs` → KV-настройки «теряются» при медленном диске | Деградация к дефолтам + `warn`; бюджет настраиваем; запись идёт в фон |
| R2 | Изменение `rpc.ts` ломает существующих вызывающих | Таймаут **опциональный**, дефолт сохраняет текущее поведение |
| R3 | Реальная причина — не flock, а другое звено (worker spawn в exe) | A1 сначала доказывает/опровергает механизм; при опровержении — back_move G8→G2 |
| R4 | Правки затрагивают startup-путь → KV-инвариант | Smoke #2 (эталон 400 мс) как регрессионный оракул |

**Rollback:** изменения локальны по файлам; откат — `git checkout -- <path>`; fossil-снапшот доступен.

## Открытый вопрос (для G4)

Подтверждение причины требует запуска TUI из **бинарника** (`dist/bin/opencode.exe`) с удержанным локом. В `plan_mode` мутация и запуск бинарника недоступны — нужен переход в build_mode.
