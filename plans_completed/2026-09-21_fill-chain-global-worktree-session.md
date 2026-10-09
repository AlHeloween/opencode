# 2026-09-21 — Цепь наполнения `global → worktree → session` (спека владельца)

<!-- intention: a selection resolves differently in each layer and the read paths disagree -> one fill chain, checked at session start, so every surface reads the same value and after creation only the session is written -->

## Спека (владелец, 2026-09-21, дословно)

> «Все что дергается идет в глобал если он не задан, глобал копируется в worktree если оно не задано,
> при сплеше — берем из worktree и создавая сессию копируем все из worktree. Тогда все выборы совпадут.
> Все операции дальше только с session. Global можно редактировать — когда это возымеет действие — когда
> будет новый worktree, worktree можно редактировать — когда это будет иметь значение — в новой сессии.
> Автозаполнение как чекер при старте сессии — если global не заполнен — заполнить, если worktree не
> заполнен — заполнить, если session не заполнен — заполнить.»

Разложение на обязательства:

- **F1** — global заполняется (из объявления агента / build-модели), если пуст.
- **F2** — worktree копирует global, если пуст.
- **F3** — session копирует worktree **при создании** (сплеш).
- **F4** — **после создания все операции пишут ТОЛЬКО session.**
- **F5** — правка global действует на новом worktree; правка worktree — на новой сессии. Ретроактивного
  распространения нет: это не баг, а контракт.
- **F6** — автозаполнение = **чекер при старте сессии** (три «если не заполнен — заполнить» по порядку).
- **F7** — следствие, которое и было требованием владельца: **все выборы совпадают** — футер, строка
  статуса, `/agents` и сервер читают одно значение.

## Дельты против текущего кода (G6, пины прочитаны)

| # | Спека | Что в коде | Пин | Действие |
|---|---|---|---|---|
| D1 | F1: global заполняется | функции заполнения global НЕТ — `fill-layers.ts` реализует только worktree (`fillWorkspaceAgents`) и session (`fillSessionAgents`) | `fill-layers.ts:102,82` | добавить первое звено; сейчас оно неявное |
| D2 | F1 неявно | падение в global спрятано в `fillSourceFor`: объявление агента → `opencode/big-pickle` | `local.tsx:465-471` | провал обязан быть виден как `unresolved`, а не как молчаливая подстановка |
| D3 | F4 — **прочтение спорно, см. «Открытый вопрос Q1»** | `model.set` пишет worktree **всегда** для агентного выбора (комментарий «the worktree ALWAYS learns the pick») | `local.tsx:1052` (блок `:986-1068`) | **МОЯ правка** (2026-09-21). НО: `fill-layers.ts:12-14` фиксирует F4 как «читатель берёт ОДИН слой; родитель обходится только на ЗАПОЛНЕНИИ» — то есть F4 про ЧТЕНИЕ, и тогда безусловная запись не нарушает её. Пины в первой редакции плана (`:1124-1145`) были **неверны**: это `layer.value`, а не `model.set` |
| D4 | F3: сессия получает значение копированием при создании | старт-аргумент `--model` пишет **и** worktree, **и** session напрямую | `local.tsx:349-379` | привести к F3: worktree — да, session — через создание |
| D5 | F7: все выборы совпадают | `forAgent` гейтнут `isModelValid` по списку **подключённых** провайдеров (`/config/providers`), сервер принимает любую пару со слешем ⇒ 4 входа в variant умирают молча | `local.tsx:448-453` + `:61-64` | развести «хранимое валидно» и «провайдер подключён» |

## Конфликт, который надо назвать, а не обойти

F1 буквально («заполнить global») сталкивается с правилом 3 парадигмы хранилищ («lazy write-back:
сгенерированное состояние никогда не переписывает рукописный конфиг просто потому, что процесс
запустился»). **Разрешение, которое беру:** «заполнить global» = материализовать **разрешённое**
значение (объявление агента / build-модель) в **worktree** — сгенерированный слой, — **не трогая
`bin/opencode.jsonc`**. Иначе автозаполнение при каждом старте переписывало бы рукописный конфиг.

## Smoke Tests

Все — файловые, детерминированные, без GUI; артефакт читается обратно.

| # | Проверка | Ожидание |
|---|---|---|
| S1 | Новая сессия: `.opencode/data/sessions/<sid>.jsonc` → `agent.<name>.model` | == `model.json` `workspaceAgent.default.<name>`; **≠** `bin/opencode.jsonc` |
| S2 | После старта: `model.json` `workspaceAgent.default` покрывает **все** агенты реестра | нет пропусков (D1/D2) |
| S3 | Выбор на `scope=worktree` | меняется `model.json`; файл сессии **НЕ** меняется (F5) |
| S4 | Выбор на `scope=session` | меняется файл сессии; `model.json` **НЕ** меняется (**F4** — здесь сейчас КРАСНО, это и есть D3) |
| S5 | `variant.set` на агенте, чья пара отсутствует в `/config/providers` | либо запись, либо `warn("bug:…")` + тост; **тишины быть не должно** (D5) |

**Baseline обязателен:** S3/S4 прогоняются на текущем дереве ДО правки и обязаны быть красными на S4
(и зелёными на S3) — иначе тест неспособен упасть и, по @ORACLE, не доказывает ничего.

Оракул: `bun test` из `packages/opencode` (не из корня). Плюс `bun typecheck` как гигиена, **не** как
доказательство поведения.

## Residuals (чекап, который просил владелец)

| R | Что НЕ закрывается этой работой | Почему остаётся |
|---|---|---|
| R1 | Согласованность имён агентов: `canonicalIdentity` (`build → build_mode`) имеет **ноль** вызовов в TUI и пять на сервере; `local.tsx:469` хеджирует `x.name === "build" \|\| x.name === "build_mode"` | отдельная ось; цепь наполнения её не лечит — два имени ключуют разные записи |
| R2 | `agent.<name>.variant` **model-blind**: вариант, выбранный для одной модели, отвечает за другую | `sessionAgentVariant` (`session-settings.ts:184-186`) |
| R3 | `sessionPayload` кладёт карты `variant`/`agentVariant` (слой S1) внутрь файла сессии ⇒ «Clean variant state» чистит `model.json`, но не файл сессии | `local.tsx:253-254, 281` |
| R4 | Живой рантайм-штамп: правки C1/C5/утечки CAPABILITIES и этой работы — `Inferred` без штампа, пока не снят смок на пересобранном бинаре | сборка/подмена — действие владельца |
| R5 | **ЗАКРЫТ 2026-09-22 — вопрос был и снят.** mermaid: ветвь отрисовки и бюджет 512 px **доказаны** | `88204c8680`: ветвь — symbols (half-block) при `mode:"none"`, native/sixel после ответа `CliRenderEvents.CAPABILITIES`; бюджет 512 px подтверждён владельцем там же; тест «flip to sixel → native `<image>` appears with a frame attached» + живой прогон `702a2da02d` на 10.0.1058 («Verified live… owner: works»). Пиксельный прибор применён |

## Открытый вопрос Q1 — что значит F4

«Все операции дальше только с session» читается двумя способами, и они дают **противоположные**
реализации одной и той же строки `model.set` (`:1052`):

- **Q1-a — F4 про ЧТЕНИЕ.** Читатель берёт один слой (session); родитель обходится только на
  заполнении. Зафиксировано в `fill-layers.ts:12-14`. Тогда `:1052` **не** расходится со спекой,
  снимать нечего.
- **Q1-b — F4 про ЗАПИСЬ.** После создания сессии писать можно только в session, а worktree правится
  отдельно (scope=worktree, `copyFromParent`). Тогда `:1052` нарушает F4 и снимается.

Цена ошибки в каждую сторону:

| | Ошибка даёт |
|---|---|
| выбрали Q1-b, а верно a | возвращается исходная жалоба владельца: выбор из сессии теряется в следующей — worktree не узнал |
| выбрали Q1-a, а верно b | `scope=session` перестаёт отличаться от `scope=worktree`: подсказка обещает «this session's own value», а пишется и в worktree |

**Довод в пользу Q1-a (рекомендую):** сохранённый дефолт скоупа — `config.scope: "session"`
(`.opencode/data/state/kv.json`). При Q1-b **дефолтный** выбор никогда не переживает сессию, то есть
исходная жалоба владельца становится нормой, а не дефектом. При Q1-a различимы оба поведения и
исходная жалоба закрыта.

Решает владелец: это продуктовое направление, репозиторий его не содержит.

## Shelf triage 2026-10-09 (t27-shelf-triage-slice2)

**Verdict: CLOSED — moved to `plans_completed/`.** Q1 is answered by the owner's spec of 2026-09-26; every delta is resolved or carried by the ACTIVE successor plan; S1–S5 are pinned by suites re-run today. No live remainder is owned by this file.

- **Q1 — answered, by the owner's third semantics (2026-09-26), and implemented as predicates:** a pick's reach is decided by its SCOPE, in `cli/cmd/tui/util/agent.ts` — `shouldUpdateSessionModelOnPick` (`:27-32`): an open session receives every non-global pick; `writesWorktreeOnPick` (`:50-52`): only `worktree`-scoped or unscoped (`undefined` — hotkey/`/model`/`--model`) picks write the worktree; `readLayer` (`:66-68`): the read layer is chosen by the ROUTE. Pinned: `test/tui/agent-selection.test.ts` 17/0/51 run `20261009T033723Z_5f926c58` (incl. a structural pin that `local.tsx` calls `writesWorktreeOnPick(options.scope)`).
- **R1 — stale as the shelf suspected:** `canonicalIdentity` IS used in the TUI now (`local.tsx:512`; the comment names the removed hedge) — pinned by `fill-layers.test.ts` «one authority for an agent NAME, not a hedge between two spellings».
- **R2 — fixed:** the agent variant is keyed by agent+MODEL (`session/session-settings.ts:184-193` — the entry key is `agent/model`), so a variant chosen for one model no longer answers for another.
- **R3 — not this file's remainder:** the variant residual (B: `sessionPayload()` carrying the worktree variant maps into the session file) is tracked by the ACTIVE plan `2026-09-26_unified-settings-layers` (`_progress_log.md` 2026-10-08 00:55Z, «Still open (explicitly out of scope)»).
- **R4 — the owner's build action**, by the plan's own words; nothing runnable here.
- Deltas: D2/D5 closed in code (`fillSourceFor` reports `unresolved` instead of guessing; `isModelValid` sits at choice sites, not on the read); D3 superseded by the same 2026-09-26 spec; **D1 (the global-fill link) is owned by the active successor** — `2026-09-26_unified-settings-layers` cites «global fill — нет» as its basis and its T1 builds it (`seedGlobalLayer` `local.tsx:679` is part of that work). Nothing competes: this file completes; the live surface work lives in the active plan.
- Wiring re-measured: the three fills fire together — `seedGlobalLayer()` / `fillWorktreeLayer()` / `refreshSessionSettings()` (`local.tsx:428-430`); fill functions `session/fill-layers.ts:82,103`.
- **S1–S5 pinned today** (cmd_runner, one file per call, all exit 0): `fill-layers.test.ts` 19/0/54 `20261009T033644Z_1cb3222a` (S3/S5 + one-layer read) · `agent-selection.test.ts` 17/0/51 `20261009T033723Z_5f926c58` (S4 scope rules) · `session-settings-smoke.test.ts` 6/0/44 `20261009T034321Z_58b83954` (S1 file read-back + copy-not-link) · `session-settings-persist.test.ts` 28/0/50 `20261009T034330Z_59d73995`.
