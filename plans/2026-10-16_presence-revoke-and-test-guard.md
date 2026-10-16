<!-- intention: тестовые доставки S9/S10 уходят на живой хост D:/zPython/opencode (fixture-тикеты с настоящим workspace_repo подбирает orgd), бродячие сессии пишут PRESENCE в живой чат и orgd готов их будить -> тесты физически не способны тронуть живой хост (страж сокетов + изоляция + стаб), мёртвые PRESENCE отзываются глаголом, бродяги отозваны, установка сверена побайтово -->
<!-- goal_sv: test-guard 0.30, leak-mechanism 0.25, presence-revoke 0.25, install-restart 0.20 -->
# Дефект утечки доставок + бродячие PRESENCE

- **plan_id:** 2026-10-16_presence-revoke-and-test-guard
- **revision:** 1
- **state:** DRAFT
- **reported:** владелец, 2026-10-16 (запись `docs/robot-protocol-log.md:70`); мои измерения ниже.

```yaml
Keywords: test-guard 0.30, leak-mechanism 0.25, presence-revoke 0.25, install-restart 0.20
Semantic dominant: Тестовые доставки больше не могут достичь живого хоста, а бродячие PRESENCE отзываются явным глаголом.
md5: 1f2a3b4c5d6e708192a3b4c5d6e7f80
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (механизм — измерен, не предположен)

- ✓ CONFIRMED (read живой БД): 9 сессий `ticket <uuid>` тремя пачками (06:54:17, 07:05:12, 07:36:54 UTC) — по 3 за прогон `test_cross_handoff.py`.
- ✓ CONFIRMED (read первых parts): текст первой — `ORG ticket c0c89ed2a9… is a NEW ticket in your inbox: s2 omitted worktree` — тикет S2-теста (same-worktree, `--no-wake`, `workspace_repo=D:/zPython/opencode`).
- ✓ CONFIRMED (read кода): `S10 run_orgd_once` гоняет orgd по ВСЕЙ фикстуре; READY-ветка orgd подбирает ЛЮБОЙ тикет с `workspace_repo` без PRESENCE — включая S2/S4-тикеты с настоящим путём — и `deliver_into_new_session` открывает сессию на живом хосте. Fake-record покрывал только LIVE/LATE; счётчики `received` считали только fake и были слепы к побочным доставкам.
- ✓ CONFIRMED (read живого чата): 9 строк `PRESENCE smit-opencode <stray> D:\zPython\opencode` (msgid 29–37, самые свежие) — `assignee_session` берёт свежайшую, сессии существуют (abort ≠ delete) → orgd будил бы бродяг. В прод-орге этих тикетов нет (фикстуры).
- Предсказание пачки 07:36: две другие сессии — `s2 explicit own worktree` и `s4 unwatched` (проверяется чтением их первых parts; S9/S10-тикеты уходили на fake — счётчики).

## Tasks

- [x] **G1 — Страж сокетов + изоляция + стаб.** `scripts/org-genesis/testdata/guard/sitecustomize.py`: в процессе разрешён TCP только на `127.0.0.1:<порты ORG_GUARD_ALLOW_PORTS>`; остальное — `OSError(org-test-guard…)` + строка в `ORG_GUARD_LOG`. Прод-код не меняется (подключается только через `PYTHONPATH` из тестового `_env`). `test_cross_handoff.py` (+`test_queue_contract.py`): `_env` ставит страж; S10 переписан на изолированную фикстуру (свой `fossil init`, свой `ORG_HOME` для delegate и orgd — orgd больше не видит тикетов с настоящим путём); S9b — прямой вызов `deliver_into_new_session(…, _connect=стаб)` без сети вообще (инъекция `_connect` в `org.py`); self-test стража (запрещённый коннект падает с меткой, fake-порт проходит); `tearDownModule` роняет прогон, если журнал стража не пуст. Binding: `scripts/org-genesis/{org.py,test_cross_handoff.py,test_queue_contract.py,testdata/guard/sitecustomize.py}`. Oracle: новые кейсы RED-first → GREEN; повторный полный прогон открывает 0 живых сессий (сверка по живой БД до/после). ✓ 2026-10-16 DONE — RED (s9b TypeError, r1/r2 возврат бродяги, guard SyntaxError моего скрипта — чинён); GREEN 6/6; полный файл 18/18; живые ticket-сессии 15→15 (+0). По пути найдены два факта: self-test пишет в отдельный журнал, revoke без сервера не пишется локально (см. G2 read-back).
- [x] **G2 — Отзыв PRESENCE.** `org.py inbox --user U --revoke-session S`: пишет `REVOKE <U> <S>` в chat (только свои — сверка с PRESENCE-строками; запись доказывается read-back, без него — отказ); orgd `assignee_session` пропускает отозванные PRESENCE и идёт к следующей (все отозваны → причина с упоминанием revoke). Тесты S8-паттерном (SQL + прямой импорт orgd) + CLI-отказы (чужая, без сервера). `Protocol.md`: inbox-буллет и правило отзыва. Binding: `scripts/org-genesis/{org.py,orgd.py,Protocol.md,test_cross_handoff.py}`. Oracle: отозванная свежая PRESENCE не выбирается; чужая/без сервера — отказ. ✓ 2026-10-16 DONE — R1-R4 GREEN (r4 сначала провалился и научил: fossil chat send без сервера возвращает 0, но локально не пишет — поэтому read-back, а не доверие коду возврата).
- [x] **G3 — Отзыв бродяг в проде.** Через установленный `org.py`: `inbox --user smit-opencode --revoke-session <id>` для 9 ticket-сессий (msgid 29–37; старые 21/25 не трогать — проверить их title/session_exists до отзыва); read-back чата (строки REVOKE на месте); контроль: `assignee_session(smit-opencode, D:/zPython/opencode)` больше не возвращает бродягу. ✓ 2026-10-16 DONE — старые 21/25 ТОЖЕ оказались бродягами (ticket 10-14) + GONE-строка: отозвано 13 (12 ticket + 1 gone), все с read-back; 2 LIVE-сессии не тронуты; `assignee_session` возвращает живую `ses_ee6ff19e` (org-smoke-inbox) — waking восстановлен.
- [ ] **G4 — Установка и закрытие.** Копия changed-файлов в `$ORG_HOME/genesis`, байт-сверка, `init.py` rc 0, коммит через `commit_own.py` (свои пути + shared-лог патчем), `_build.ps1`, запрос рестарта orgd. Боксы `[x]` с квитанциями; SV в конце. RESIDUAL 2026-10-16: установка/сверка/коммит 775b07e1/отзывы выполнены; `_build.ps1` BLOCKED чужим maintenance-маркером (идёт bin-промоушен, t55 gate; -ForceBuild только для fleet lead — не форсировал): догнать билд после снятия маркера. Запрос рестарта orgd — у владельца.

## Smoke Tests

| # | команда | предсказание |
|---|---|---|
| B1 | новые кейсы стража/revoke на старом коде | RED — нет глагола/инъекции, self-test стража падает без метки |
| R1 | `test_cross_handoff.py` после G1 | PASS 13+; живых сессий +0 (живая БД до/после); журнал стража пуст |
| R2 | `test_queue_contract.py` после G1 | PASS; журнал стража пуст |
| R3 | revoke-кейсы после G2 | PASS — отозванная PRESENCE пропускается; чужая отказывается |
| S5/S6 | установка + `init.py` + сверка | sha равны; init rc 0 |
| D | живые read-back'и | REVOKE-строки в чате; бродяги не выбираются |

## Residuals

- S8-паттерн для revoke-тестов (прямой SQL в чат фикстуры) — как существующий тест присутствия; CLI-revoke в фикстуре без сервера честно отказывает.
- Отзыв действует в пределах (пользователь, worktree); смена worktree — отдельная строка.
- Мёртвые (удалённые из БД) сессии по-прежнему дают объяснение «no longer exists», а не тихий пропуск — не меняю.

## Out of scope

- Перезапуск orgd; удаление бродячих сессий из живой БД (abort достаточно — orgd их больше не выберет).
- `packages/opencode`; `bin/`; ядро.

## Rollback

`git revert` коммита; REVOKE-строки в живом чате остаются фактом (чат — летопись, не состояние) и безвредны.
