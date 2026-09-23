<!-- intention: новая TUI-сессия показывает DeepSeek и выбор Sol не меняет активную модель -> выбор Sol для активного агента действует на следующий запрос и согласованно сохраняется -->
# Выбор модели в TUI и активная сессия

Статус: ACTIVE. Ветка: `Local_Development`.

## G1: основание и критерии

- ✓ Наблюдение пользователя: новая сессия показывает DeepSeek; Sol есть в списке моделей, открытом из `/agents`, но после выбора модель не меняется. Отдельной команды `/models` в TUI нет.
- ✓ Кодовый путь: `DialogModel.performSelect` вызывает `local.model.set(..., scope)`. Сохранённый `config.scope` = `worktree`; в `local.tsx:1092` текущая сессия обновляется только при `scope !== "worktree"`, а `local.model.current()` читает запись сессии. Модель `build_mode` в `model.json` уже `openai/gpt-5.6-sol`, одна из последних записей сессии всё ещё `deepseek/deepseek-flash`.
- ✓ Граница владения: `packages/opencode/src/cli/cmd/tui/context/local.tsx`, `util/agent.ts`, `test/tui/agent-selection.test.ts`; серверное разрешение модели в `session-settings.ts`. CodeGraph до правки назвал `setSessionAgentModel` и `setWorkspaceAgentModel`, их потребителей и тесты. `test/session/fill-layers.test.ts` требует CRLF-независимого разделителя для чтения `local.tsx`.
- ? Не установлено, какая именно сессия была открыта у пользователя в момент выбора; постороннюю сессию и глобальный конфиг не менять.

| Приёмка | Поверхность | Оракул | Фальсификатор |
|---|---|---|---|
| C1: выбор в `worktree` меняет модель активного агента сразу в открытой сессии | `local.model.set`, session settings, `Prompt.submit` | RED→GREEN тест решения о записи и чтения результата; трасса `Prompt.submit → local.model.current() → sessionAgentModel`; read-back реальной сессии при доступном TUI | worktree Sol, сессия DeepSeek после выбора |
| C2: выбор для другого агента из `/agents` не переназначает активный запрос | `local.model.set` | тест отказа записи в активную сессию другого агента | выбор другого агента меняет активный запрос |
| C3: новая сессия наследует Sol из worktree | `model.json`, fill | существующий `agent-selection.test.ts` | новая сессия получает DeepSeek |

## G2–G4: план и разрешение

T1: проверить границу выбора и зафиксировать RED сценарий. T2: одной правкой записать модель активного агента в текущую сессию при выборе уровня `worktree`, сохранив worktree для будущих сессий и старое поведение при настройке другого агента. T3: сфокусированные TUI/session тесты, typecheck, проверка статуса и артефактов. T4: собрать кандидат `packages/opencode/dist/opencode-windows-x64/bin/opencode.exe` штатным `python build.py --only opencode`; сохранить прежний `bin/opencode.exe` в `experiments/2026-09-24_tui-model-pick/`, продвинуть кандидат в `bin/opencode.exe` и прочитать SHA-256 обратно, если исполнитель не запущен. Действие: `MODIFY_PROJECT` + `MODIFY_CANDIDATE` + `PROMOTE_STABLE`; пользователь сообщил дефект и попросил продолжить исправление. Конверт: `src/cli/cmd/tui/context/local.tsx`, `src/cli/cmd/tui/util/agent.ts`, `test/tui/agent-selection.test.ts`, `test/session/fill-layers.test.ts`, `docs/agent-model-resolution.md`, этот план и журнал; сборочный кандидат в `packages/opencode/dist/`, текущий `bin/opencode.exe` и отдельная резервная копия в `experiments/2026-09-24_tui-model-pick/`; не трогать токены, глобальный конфиг, другие сессии и unrelated `.artifacts`. Откат: резервная копия бинарника и git diff конкретных файлов.

## G6–G9: выполнение

- [x] T1 — сохранённые `config.scope=worktree`, worktree `openai/gpt-5.6-sol`, сессия DeepSeek; RED тест нового правила `20260923T231358Z_5231b550`.
- [x] T2 — выбор `worktree` для активного агента записывает текущую сессию и сбрасывает старый вариант через `setSessionAgentModel`; настройка другого агента не меняет активный запрос.
- [x] T3 — RED `20260923T231358Z_5231b550`; GREEN четыре связанных файла `20260923T231602Z_dd19e54f` (61/61), `bun typecheck` `20260923T231446Z_ccefe22d` exit 0. Первые 5 падений `fill-layers.test.ts` были дефектом разделителя инструмента на CRLF; после его исправления все тесты прошли. `Prompt.submit` читает `local.model.current()` и передаёт `selectedModel` в `session.prompt` (`prompt/index.tsx:706,815-821`). Живой выбор пользователя пока без read-back.
- [x] T4 — штатная сборка `20260923T231954Z_f69ab6a9` exit 0, версия `10.0.1103`, embedded kernel smoke PASS. `bin/opencode.exe` установлен с SHA-256 `507DA22E…A99FD`, совпадающим с кандидатом; прежняя копия `8BA9AB67…78455` лежит в `experiments/2026-09-24_tui-model-pick/opencode-before.exe`.
- [ ] T5 — после перезапуска TUI пользовательский выбор Sol в той же открытой сессии; наблюдать строку модели, session settings read-back и следующий запрос. Если повторяется, проверить отложенную загрузку `refreshSessionSettings()` тем же sid.

Риски: установленный бинарник проверен по хешу и версии, но повторный выбор в той же живой TUI-сессии пользователя ещё не наблюдался — поведенческий C1 остаётся Inferred, а не Exact. Отложенная `refreshSessionSettings()` для того же sid потенциально может восстановить старую модель после выбора, если чтение началось раньше записи; это отдельный кандидат с фальсификатором «задержать загрузку, выбрать Sol, завершить старую загрузку и прочитать активную модель». До воспроизведения — Inferred риск, не Exact причина этого случая.
