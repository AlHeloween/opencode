<!-- intention: устаревший Codex kernel существует только как вручную внедряемый артефакт -> текущий Codex-вариант устанавливается штатным проверяемым pipeline в активный CODEX_HOME/AGENTS.md -->

# Codex kernel — отдельный install contract

**Status:** COMPLETED

## Границы

- Меняется только Codex host variant и его install contract.
- Claude renderer, `.claude/reasoning_kernel.md` и `addons_claude.py` не изменяются.
- Канонический kernel остаётся в `prompt_kernel/source.py`; установленный файл никогда не редактируется вручную.
- Независимая пользовательская правка `packages/opencode/src/util/plan-status.ts` не входит в задачу.

## Grounding

- ✓ Baseline (`git status --short --branch`): активная ветка — `Local_Development`.
- ✓ Baseline (`Get-FileHash` + byte census): старый receiver `C:\Users\Alexander\.codex\AGENTS.md` имел 34 621 UTF-8 bytes, 522 строки, SHA-256 `23cf3069adbe41b7b7afd119a7065e02db2ae9d5797ceceff852500e23c9f75f`.
- ✓ Baseline (renderer census): исходный Codex render имел 43 965 UTF-8 bytes, 559 строк, SHA-256 `cffc5c15b1d9a093518174283fccf7d6e058ed0268e2086c09991f897d3f2645`.
- ✓ Baseline (`20260922T132553Z_716b37cf`): прежний `python -m prompt_kernel --codex --install` возвращал exit 2.

## Claims / risks

- C1 [Inferred]: `CODEX_HOME/AGENTS.md` — активный глобальный receiver этого Codex host. Falsifier: `CODEX_HOME` указывает на иной root либо read-back после CLI пишет в другой путь.
- C2 [Inferred]: отдельный installer может повторить проверяемую схему Claude installer, но с `CODEX_GATE_ADDONS` и `DIST_CODEX`. Falsifier: временный-path тест получает не Codex render.
- R1 critical: случайно изменить Claude receiver. Containment: зафиксировать его SHA до установки и сравнить после.
- R2 critical: затереть receiver не тем вариантом. Containment: stamped artifact == `render_kernel(KERNEL, CODEX_GATE_ADDONS)` и installed SHA == candidate SHA.
- R3: задеть чужую dirty-правку. Containment: разрешённые repo paths только `prompt_kernel/**`, этот plan и `_progress_log.md`.

## Smoke Tests

### Baseline

- [x] Read-only render-vs-receiver census: receiver устарел, SHA выше.
- [x] Существующий focused Codex CLI test подтвердил прежний exit 2 (`20260922T132543Z_14ada567`, 1 passed).

### Post-change oracle

- [x] Focused Codex installer/CLI tests проходят на временном receiver (`20260922T134123Z_8c1cf810`, 8 passed).
- [x] Codex-owned subset полного suite проходит; общий suite завершился `104 passed, 2 failed` (`20260922T134142Z_d7b3afe1`). Обе ошибки — отдельные promotion gates production и Claude, не Codex.
- [x] `python -m prompt_kernel --codex --install` вернул exit 0 и напечатал путь + installed SHA (`20260922T133725Z_55e5a46c`).
- [x] Read-back `CODEX_HOME/AGENTS.md` побайтово равен свежему Codex render: 43 957 bytes, SHA-256 `e43c45d5b48c5712b1ce48d5622bbdb4fe6514f4a91157dbd57aca8401e1fa95`.
- [x] `.claude/reasoning_kernel.md` не изменён этой установкой: `git status --short -- .claude/reasoning_kernel.md` и `git diff --` пусты; текущий SHA-256 `a807d78e1f5d517e5a49e70ffb054beb1dff62dddc3eb6b87d96b4ddee0e9cda`.
- [x] Scoped git status содержит только разрешённые Codex install-contract поверхности; параллельные изменения общего kernel оставлены вне commit.

## Tasks

- [x] S1 — добавить `CODEX_KERNEL_PATH` и `install_codex_kernel()` в cutover API.
- [x] S2 — подключить `--codex --install`, обновить Codex README и тесты.
- [x] S3 — прогнать focused и полный kernel oracle.
- [x] S4 — установить Codex kernel и выполнить SHA/read-back oracle при неизменном Claude.
- [x] S5 — записать progress, закрыть plan и сделать отдельный commit без чужой dirty-правки.

## Closure

- ✓ Codex acceptance покрыт тремя независимыми поверхностями: renderer, stamped artifact и активный receiver побайтно равны.
- ✓ Claude isolation подтверждена пустыми scoped status/diff; Claude install остаётся за Claude по границе пользователя.
- ✗ Полный suite не зелёный: production receiver и Claude receiver отстают от параллельно изменённого общего kernel. Это записанный residual вне Codex install contract, а не Codex PASS-исключение.
- ✗ `cmd_runner --raw` на трёх pytest-запусках завис с `bytes_written=0` и не завершился по stop request; стабильный обход — `--no-raw`/ConPTY, которым получены все финальные oracle-логи.

## Execution envelope

- Action classes: `PLAN_WRITE`, `SELF_MODIFY`, `PROMOTE_STABLE`.
- Repo paths: `prompt_kernel/cutover.py`, `prompt_kernel/__main__.py`, при необходимости `prompt_kernel/__init__.py`, `prompt_kernel/tests/test_addons_codex.py`, `prompt_kernel/tests/test_compatibility.py`, `prompt_kernel/README.md`, `_progress_log.md`, этот plan.
- Generated candidate: `prompt_kernel/dist_codex/**`.
- Stable receiver: `${CODEX_HOME}/AGENTS.md` (сейчас `C:\Users\Alexander\.codex\AGENTS.md`).
- Prohibited: `.claude/**`, product kernel receiver, `packages/opencode/src/util/plan-status.ts`, любые push-операции.

## Rollback

- До install старый receiver идентифицирован SHA `23cf…f75f` и существует как предыдущий Codex artifact; при провале read-back установка считается FAIL и receiver восстанавливается этим проверенным артефактом через тот же atomic-write путь.
