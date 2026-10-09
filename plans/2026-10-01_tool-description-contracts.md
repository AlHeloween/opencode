# Tool description contracts — every published promise is true and pinned

<!-- intention: 36 tool descriptions ride the KV-stable prefix and make promises the code does not always keep (multiedit atomicity, grep's line format, recall's reach); the work fixing them ran under a parent-goal anchor no plan declared -> one line of work that owns that anchor, where every promise in a description is either pinned by a test that fails without it or removed from the text -->

- **plan_id:** 2026-10-01_tool-description-contracts
- **revision:** 1
- **state:** ACTIVE
- **owner decision (2026-10-01):** «Давай!» — on the proposal to give the robot's tool-contract work its own
  plan instead of zeroing its `parent-goal-md5`, and to source coupling labels from plan headers
  (that second half: `plans/2026-10-01_coupling-labels-from-plan-headers.md`).

```yaml
Keywords: tool-description-contracts 0.30, falsifiable-promise 0.24, pinning-tests 0.18, kv-prefix-descriptions 0.14, anchor-declared 0.14
Semantic dominant: Каждое обещание в описании тула либо закреплено тестом, который без него краснеет, либо вычеркнуто из текста — и у этой линии работы наконец есть собственная метка.
md5: d99945d67a57440775f414e816c78773
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Why this plan carries THIS md5

`d99945d67a57440775f414e816c78773` is not new. ✓ (Grep over `*.md`, 2026-10-01) it is the `parent-goal-md5` of
three completed plans — `plans_completed/2026-09-30_tool-catalog-trim.md`,
`plans_completed/2026-09-30_multiedit-atomic-application.md`,
`plans_completed/2026-09-30_drop-penalty-sampling-params.md` — and of the robot's turns on grep / glob /
messagesearch / recall, yet no plan or map ever declared it as a label. The coupling watcher
(`src/memory/spine.ts:235`) therefore reported every one of those turns as `vector-off-plan` (15 findings in the
robot's session). An `@SV_FORMAT` md5 is a LABEL, not a checksum, so this plan adopts the existing anchor: the
three completed children and the robot's chain resolve to it without rewriting any of them.

Declaring it is necessary but NOT sufficient — ✓ (Grep, 2026-10-01) the watcher's label source,
`.opencode/data/memory/reasoning.md`, holds zero `md5:` lines, so no label resolves today. That defect is the
companion plan, not this one.

## Contract rule (from AGENTS.md § Bug Policy, restated as the acceptance)

A description is a set of claims. For each claim, exactly one of:
1. a test in `packages/opencode/test/tool/` that FAILS when the promised behaviour is removed (mutation check
   recorded), or
2. the claim is deleted or corrected in the `.txt`, with the reason in the commit.

Never the reverse direction: behaviour is not bent to fit a test, and a test is not softened to go green.

## Tasks

- [x] ✓ **C0 — prior work under this anchor.** `b95c2524a5` (applypatch unregistered, fake-green `continue`
      removed), `ed713f3779` (multiedit atomic), `ad1900af5c` (penalty params dropped) — all three plans in
      `plans_completed/`. Artifact: `git log --since=2026-09-29 -- packages/opencode/src/tool/` (2026-10-01).
- [x] ✓ **C1 — grep, glob, recall.** Commits `8051467cf4` (grep address + bounded window),
      `eaf562f4c8` (no silent regex re-meaning, no pipe rewrite — grep/glob/pattern), `18fe82c426` (recall
      reaches a `file` part, still refuses a `text` part), `75f1033ee7` + `80c352e0a3` (binary-file report
      withdrawn). Robot live check 2026-10-01: range recall and the text-part refusal both held on the live
      binary. Artifact: `bun test test/tool/grep.test.ts test/tool/glob.test.ts test/tool/pattern.test.ts
      test/tool/recall.test.ts` from `packages/opencode`, 2026-10-01 — **38 pass, 0 fail, 4 files**, exit 0.
- [x] ✓ **C1b — messagesearch: the claim WAS already pinned, in the shared compiler.** `eaf562f4c8` changed
      `messagesearch.txt` by 2 lines and there is indeed no `test/tool/messagesearch*` file — but the claim is
      not a messagesearch-local behaviour: `messagesearch.ts:103` compiles through `optionalPattern` →
      `compilePattern`, and `test/tool/pattern.test.ts` (written the same day, 6 cases) pins exactly what the
      text promises — the long form `\p{Script=Han}` matches, the lone form `\p{Han}` THROWS with the
      `Script=` hint instead of returning an empty result, and a pattern whose meaning does not move still
      falls back. Artifact: the four-file run cited in C1 (`38 pass / 0 fail / 108 expect`,
      `20260930T231334Z_176e119d`, 2026-10-01) and `git log -- packages/opencode/test/tool/pattern.test.ts`.
      **What this does NOT pin, named rather than glossed:** the WIRING — that `messagesearch` calls
      `optionalPattern` at all. Deleting that call leaves every test green while the tool searches with no
      filter. Pinning it costs a messagesearch instance driven with a malformed pattern; the residual is
      recorded here instead of being left implied.
- [ ] **C2 — file tools:** `read`, `write`, `edit`, `multiedit`, `ls`/`list`, `restore`, `treediff`, `compare`.
      **Перегрунтован на код 2026-10-01** — и это окупилось дважды:
      - **БАЗА БЫЛА КРАСНОЙ, и красное — наше.** `test/tool/edit-exact.test.ts` падал тремя случаями с
        `Missing key at ["files"]` (`20261001T052355Z_7c3c83cb`): схема уехала на пакет (H6), а этот файл
        остался на старой форме ✓ Первым делом СТАБИЛИЗИРОВАНО, как велит контракт: перенацелено на
        `files: [{ filePath, edits? }]`, те же три стороны, провенанс — в самом файле ✓ → **26 pass / 0 fail
        / 34 expect**, exit 0 (`20261001T052620Z_7a54b258`).
      - **МЁРТВЫЙ СЛОЙ назван боксом, а не починен здесь:** три блока того же файла держат `replace`,
        `replaceRange`, `replaceWithStage` и десять ступеней `Replacer` — замерено: **в `src/` ни одного
        вызова**, единственный потребитель — этот тест ✓ Удаление — бокс **H8** плана
        `plans_completed/2026-10-01_hash-addressed-edits.md`, и оно обязано быть ОДНОЙ правкой (тесты и код вместе ✓): снять
        сначала тесты — оставить мёртвый код вообще без наблюдателя ✗ **H8 DONE 2026-10-01:** код и три блока
        сняты вместе (`edit.ts` −683, `edit-exact.test.ts` −118), 151 / 0.
      - **`compare` — ДВА ложных обещания** (замерено чтением `compare.ts`): (а) `Parameters.ignore`
        («Additional glob patterns to ignore») **не читается `execute` ни разу** — параметр требуют и
        выбрасывают, тот же класс, что старый дефект `from`/`to`/`expect`; (б) текст обещает «`same` —
        identical», а код сравнивает `size` И `mtime` ⇒ два побайтово равных файла с разными метками
        попадают в **changed** ✓ Текст утверждает про СОДЕРЖИМОЕ там, где код имеет МЕТАДАННЫЕ ✓ Плюс:
        первые две строки `compare.txt` побайтово одинаковы (шов копипасты), а пример «between branches» —
        то, чего тул не умеет (он сравнивает две директории на диске, не ветки ✓)
      - **`ls.txt` (тул зарегистрирован как `list`) — обещание, которого вывод не держит:** «Cap: 100 entries
        (truncation notice on overflow)» — `truncated` считается и уезжает **только в `metadata`**, в `output`
        уведомления не дописывает ни одна строка ✗ Это собственное правило проекта наоборот: перечисление,
        которое СКРЫВАЕТ пути, не может поддерживать «absent» ✓ Ещё: «absolute paths» ложно для записей
        (`path.basename`; абсолютна только корневая строка ✓), и **у `list`/`compare` нет ни одного теста** ✗
      - **`write.txt`** всё ещё несёт кернел-прозу, которую `edit.txt` сбросил сегодня (Mutation class, G7,
        claim ledger, Gate 8) — правило, сказанное дважды, оплачивается дважды, а описание тула едет в
        KV-стабильном префиксе ✓
      - **`restore.txt`** ссылается на снятый тул: «written automatically by the `edit` / `multiedit` tools» ✓
      - `read.txt` / `edit.txt` / `multiedit.txt` приведены к правде сегодня же (`4a768738da`, `53bea05cfa`,
        серия H3/H6) — это ГОТОВАЯ половина C2 ✓
      **ХОД 2 (2026-10-01): compare / ls / write / restore / treediff — приговоры и ОДИН НАСТОЯЩИЙ ПИН.**
      Контракт требует по каждой фразе ровно одно из двух: тест, который без неё краснеет ✓, либо
      исправление/удаление ✓. Приговоры (полностью — в теле коммита):
      - **`compare`** — `Parameters.ignore` **УДАЛЁН из схемы** вместе со строкой в тексте: `execute` не
        читал его НИ РАЗУ ✓ (параметр требуют и выбрасывают ✓). «`same` — identical» **ИСПРАВЛЕНО** на
        «same size AND same mtime» + явная оговорка, что содержимое НЕ ЧИТАЕТСЯ (код: `compare.ts:94` ✓).
        «between branches» убрано — тул сравнивает две директории на диске, не ветки ✓. Назван точный
        список шумовых папок вместо «etc.» ✓ ПИНОВАНЫ самим кодом: «differs by size/timestamp» и
        «changed» ✓ — но теста у `compare` нет ✗ (остаток ниже).
      - **`ls`/`list`** — обещание «truncation notice on overflow» было **ЛОЖНО** ✗: `truncated` уезжал
        только в `metadata` ✗. **ПОВЕДЕНИЕ ИСПРАВЛЕНО** (`ls.ts`): вывод заканчивается
        `(TRUNCATED at 100 entries — the tree holds MORE …)`. **НОВЫЙ ПИН** `test/tool/list.test.ts`, ДВА
        случая: уведомление обязано появиться, когда усечение ДЕЙСТВИТЕЛЬНО (сначала
        `metadata.truncated === true` и `count === 100` ✓), и **молчать**, когда его не было ✓ —
        уведомление, срабатывающее всегда, это крикун ✗. Fallibility: RED до реализации — падение ровно
        на `list.test.ts:84` (`20261001T053334Z_b174ee16` ✓); мутация (снят `+ notice`) — падение на ТОМ
        ЖЕ адресе (`20261001T053431Z_afd8ec1f` ✓), откат подтверждён контрольным `grep` (`renderDir` → 3
        попадания, маркера `MUTATION` нет ✓); GREEN `20261001T053410Z_96b212df` ✓. Ещё: «absolute paths»
        было ложно для записей (basename ✓) — ИСПРАВЛЕНО ✓
      - **`write`** — кернел-проза (Mutation class, G7, claim ledger, Gate 8) **УДАЛЕНА** ✓; вместо
        «Diff … stored for tracking/undo» названо наблюдаемое — `metadata.filediffs` ✓; дихотомия
        «Write = new / Edit = sections» ИСПРАВЛЕНА: `edit` с `content` создаёт файлы с H2/H6 ✓. BOM и
        diagnostics уже ПИНОВАНЫ (`write.test.ts:127/143/298` ✓)
      - **`restore`** — `multiedit` (снятый тул ✗) заменён: `writeBackup` зовётся из `edit.ts:480` ✓;
        G7-проза удалена ✓
      - **`treediff`** — кернел-метка «(G1 observe)» удалена ✓; обещания **ПИНОВАНЫ**:
        `treediff.test.ts:69` (exit-код 1 = различия, не провал ✓) и `:93-94` (`context` клампится к 100 ✓)
      - **Префикс (пункт 5):** замер — `experiments/2026-10-01_tool-txt-bytes/count.mjs` ✓
        (`20261001T053727Z_03f0c2a0`). **HEAD (LF) 73 560 B → дерево 74 476 B, дельта +916 B** ровно по ПЯТИ
        моим файлам: `compare` +553, `ls` +276, `write` +141, `restore` −17, `treediff` −37 ✓. Рабочее
        дерево КАК ХРАНИТСЯ — 75 305 B (CRLF включён ✓). База плана 67 618 B **УСТАРЕЛА** ✓: C1 и прочее
        приземлились после неё (+5 942 B закоммиченного ✓) — названо, а не списано ✓
      - **КЛАСС, оплаченный этим пробником (и снятый здесь же):** он показал «изменения» у СЕМНАДЦАТИ
        файлов, которых никто не касался ✗ — потому что `git show HEAD:<path>` отдаёт BLOB (LF ✓), а
        рабочее дерево — CRLF ✓, и «дельта» оказалась **ЧИСЛОМ СТРОК файла** (`skill.txt` 19 строк →
        «+19» ✓, `fossilgrep.txt` 41 → «+41» ✓). `git status`, который сравнивает ЧЕРЕЗ фильтр, считал их
        чистыми и был прав ✓ Первый вывод — «чужая незакоммиченная рука» — был **ЛОЖНЫМ** ✗ и снят здесь
        же ✓ Приём: байтовое сравнение с git-блобом обязано нормализовать переводы строк, иначе оно
        измеряет ФОРМАТ, а не изменение ✓
      - **(б) ЗАКРЫТ (второй заход):** `compare` и `list` были **отсутствуют в сьюте схем** ✗
        (`parameters.test.ts` знал 15 тулов, этих двух нет ✓) ⇒ возврат `ignore` не покраснел бы ✗
        ИСПРАВЛЕНО — и **с ОТКЛОНЕНИЕМ ОТ БУКВЫ БОКСА, названным честно**: бокс говорил «добавить в
        снапшот-сьют», а сделано **именованное утверждение на НАБОР ИМЁН ПОЛЕЙ** ✓ — снапшот схемы это
        картинка, которую читает только тот, кто уже подозревает ✗, тогда как имена полей и есть обещание
        тулу модели ✓ `propertyNames()` через ту же `toJsonSchema`, что эмитит схемы в промпт ✓:
        `compare` — ровно `[pathA, pathB, verbose]`, `list` — ровно `[dates, directoriesOnly, gitignore,
        ignore, path]` ✓
        Оракулы: GREEN **53 pass / 0 fail** (`20261001T054026Z_78a77d68` ✓ — 51+2, и СЧЁТ подтверждает, что
        добавились именно два ✓); **мутация** (возврат `ignore` в `compare.Parameters`) — **RED ровно на
        моём пине**: `parameters.test.ts:65`, `Received` несёт `+ "ignore"`, а 52 прочих (включая 15
        снапшотов) не шевельнулись ✓ (`20261001T054043Z_417766b6` ✓) ⇒ упало ИЗМЕРЕНИЕ, а не харнесс ✓;
        откат доказан **контролем в том же дыхании**: `MUTATION` — ноль ✗, а `verbose` (обязан совпасть)
        — 2 попадания ✓ (фильтр видит файл ✓), плюс `git status -- packages/opencode/src/` пуст ✓;
        GREEN на финальном дереве **55 pass / 0 fail** (`20261001T054118Z_5aef656d` ✓, вместе с `list.test.ts` ✓)
      - **(а) ЗАКРЫТ 2026-10-01 (третий заход):** три флага, чьи описания обещали ПОВЕДЕНИЕ, теперь
        пинуются — `list`: `dates` (дефолт реально штампует ✓, иначе «dates: false его скрывает» пусто ✗)
        и `directoriesOnly` (каталог ПРИСУТСТВУЕТ ✓ И файл ОТСУТСТВУЕТ ✓ — одна лишь пустота
        удовлетворила бы отсутствие ✗); `compare`: `verbose` ✓ — а с ним и два остальных его обещания:
        «различие решают size и mtime, содержимое НЕ читается» ✓ (два байт-идентичных файла с разными
        метками обязаны попасть в `changed` ✓ — проверка различает именно тот класс, который текст
        ИСПРАВЛЯЛ ✓) и фиксированный шумовой список ✓ `compare.test.ts` — **ПЕРВЫЙ тест у тула за всю
        историю** ✓ GREEN 3 pass / 0 fail / 13 expect (`20261001T090412Z_b55ab98a` ✓); `list.test.ts`
        GREEN 4 pass / 0 fail (`20261001T054311Z_96f82c23` ✓)
      - **ОСТАТОК, из-за которого бокс остаётся `[ ]` (назван, а не спрятан):** мутация для `compare.test.ts`
        **ВЫПОЛНЕНА 2026-10-09** ✓ (t23-compare-mutation) — три пина, три локальные мутации, каждый RED пришёл ПО
        СВОЕМУ адресу, каждый откат доказан в том же дыхании (`git diff --stat -- packages/opencode/src/` пуст ✓,
        контроль `MUTATION` → 0 попаданий ✓, строки-обещания снова на :9 / :95 / :129 ✓):
        (1) снят `params.verbose`-гард (`compare.ts:129`) → RED `compare.test.ts:115` (`20261009T002428Z_583d3123` —
        quiet-вывод напечатал `--- Identical (1) ---` и `twin.txt`); (2) равенство ЧИТАЕТ содержимое
        (`readFileSync` вместо size/mtime, `compare.ts:95`) → RED `compare.test.ts:92` (`20261009T002501Z_8bbba0d3`
        — `changed` 1→0: байт-идентичные близнецы с разными метками уехали в `same`); (3) `node_modules` выброшен
        из `SKIP_DIRS` (`compare.ts:9`) → RED `compare.test.ts:137` (`20261009T002529Z_a041dcf3` — вывод показал
        `node_modules/pkg/x.js`). Ни один пин не остался зелёным — усиливать утверждения не потребовалось ✓.
        GREEN до и после (база `20261009T002348Z_a659411b`, восстановленное дерево `20261009T002551Z_1ce704b6` —
        3 pass / 0 fail / 13 expect), `bun typecheck` exit 0 (`20261009T002603Z_3b580b1e`);
        (в) **ПЕРЕПРОВЕРЕНО 2026-10-09 — состояния больше нет** ✓: `git status --short` по дереву пуст, названные
        `.claude/skills/aicall/SKILL.md` и `.claude/skills/opencode-bridge/` ушли вместе с чужими коммитами;
        (г) `grep` на НЕВАЛИДНОМ регексе отвечает «No matches found» вместо ошибки ✗ — **воспроизведено заново
        2026-10-09**: `MUTATION|const notice|+ notice` → «No matches» ✗ (класс инструмента, вне C2) — бокс `[ ]`
        держит теперь ровно он
- [ ] **C3 — shell tools:** `bash`, `cmd`, `powershell`, `run`.
- [ ] **C4 — search / memory tools:** `codegraph`, `dbread`, `fossilgrep`, `logsearch`, `sessionread`,
      `summaryedit`, `universalsearch`, `webfetch`.
- [ ] **C5 — control / agent tools:** `task`, `skill`, `todowrite`, `question`, `plan-enter`, `planexit`,
      `compact`, `aicall`, `cua`, `imagerender`, `lsp`.
- [x] ✓ **C6 — NUL bytes in grep output on binary files.** REPRODUCED 2026-10-08 against the runtime's own rg
      (15.1.0, the `C:\Windows\rg.exe` that `which("rg.exe")` resolves): the leak is REAL on the FILE-TARGET
      shape — `grep(path: <a file whose matched line holds a NUL>)` printed one raw 0x00 (`NEEDLE\u0000TAIL`,
      pre-fix run `20261008T113310Z_c69b7656`). A DIRECTORY search is clean and rg emits NO event for the
      binary file at all (`--no-messages` or not: runs `20261008T113248Z_c16d4de5`, `20261008T113444Z_10e6d0d2`);
      `end.binary_offset` = 15 on the file target and no `end` at all on the directory — the target shape,
      not the decoder, is why the withdrawn counter read 0. FIX: `tool/grep.ts` `matchWindow` MARKS the byte
      U+2400 instead of dropping it (a drop would silently join the halves it keeps apart; the address is
      computed from the raw hit, untouched), pinned in `test/tool/grep.test.ts` — RED `20261008T113600Z_674ee1b2`
      (1 fail) → GREEN `20261008T113627Z_1477239a` (7 pass / 0 fail / 26 expect); mutation check — fix
      reverted → RED `20261008T113644Z_a1154448`, restored → final green `20261008T113720Z_fe97495a`.
      `test/file/ripgrep.test.ts` 12/0 (`20261008T113720Z_0e75481a`); `bun typecheck` exit 0
      (`20261008T113735Z_b0c3f6ca`); no `.txt` touched (prefix cost unchanged). Commit names this box
      (t21-grep-nul-reproducer). The withdrawn REPORT (a directory search NAMING binary files) stays
      withdrawn — rg gives no signal there; the measured runs are recorded in `file/ripgrep.ts` and the test.
- [ ] **C7 — recall of an attachment, live.** Unit-proven (`18fe82c426`, 20/4 red → 24/0 green); the robot's
      session held no `file` part, so no live run exists. Owner recipe: paste an image or document, take its
      part id, `tempenable` with a short span; after the span the wire note names the attachment id and
      `recall` returns the payload. Waits on the owner's run — the robot cannot produce a `file` part itself.

`applypatch.txt` stays out of scope: the tool is unregistered (`b95c2524a5`), the file is kept only for the
CLI/heredoc path and a one-line re-registration.

## Smoke Tests

Per batch C2–C5, before the box:
1. **Baseline:** the named `test/tool/<tool>.test.ts` files run green on the unchanged tree (a red baseline is
   STABILIZE, fixed and committed first).
2. **Inventory:** every claim in each `.txt` of the batch listed in the commit body with its disposition
   (pinned by `<test name>` / corrected / deleted).
3. **Fallibility:** for each NEW pin, one mutation check — revert the promised behaviour locally, the test goes
   red, restore. Recorded in the commit body.
4. **Post-change:** the same named files green; `bun typecheck` from `packages/opencode` exit 0.
5. **Prefix cost:** `src/tool/*.txt` total bytes before/after (baseline 67,618 B across 36 files, measured
   2026-09-30) — a description change is a KV-prefix change and is reported as one.

Never the whole package suite (AGENTS.md § Full package test suite).

## Out of scope (owned elsewhere)

- The coupling watcher's empty label source — `plans/2026-10-01_coupling-labels-from-plan-headers.md`.
- `svm: MISSING` for robot-installer I0 — `plans/2026-09-30_robot-installer.md`.
- Three unarchived experiments — their own plans' closure (experiments → `experiments_history/`).
