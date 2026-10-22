# Почему останавливаются ответы Claude

Срез расследования: 2026-10-22, Asia/Singapore. Исполнитель и окончательная сверка: Codex. Это результат диагностики, не заявление об устранении остановок.

```yaml
Keywords: reasoning-extraction 0.40, refusal-events 0.25, prompt-compatibility 0.20, bounded-residual 0.15
Semantic dominant: Четыре отказа Claude имеют серверную категорию reasoning_extraction; конкретный триггер и устранение ещё не доказаны.
md5: 461e8d3a9c70f25b14a6e209d7c83fb5
prev-md5: 00000000000000000000000000000000
parent-goal-md5: e7a1c49d032f6b85a90e7c2d416fb308
note: hash values are generative tags — search them, never compute them.
```

## Установлено

✓ CONFIRMED — прямое чтение JSONL, независимый GLM-проверяющий и повторная сверка Codex: в сессии `5ee34a89-f9f6-42c3-9b6b-8f8d38a334de` четыре уникальных ответа с `message.stop_reason = refusal` и `message.stop_details.category = reasoning_extraction`. Клиент: `claude-desktop`, Claude Code `2.1.304`, модель `claude-opus-5-5`.

| Время Singapore, 22 октября | Строки исходного JSONL | requestId |
|---|---|---|
| 04:27:13 | 173–174 | `req_011CgG1cdutjrFGQLim3vjFj` |
| 10:29:18 | 1086–1087 | `req_011CgGVFVxLmLcRBfHUBvjzX` |
| 11:12:52 | 1348 | `req_011CgGYaE3ziRN8qeq2VkDo8` |
| 11:22:00 | 1456–1457 | `req_011CgGZGbedd68JkXoFo3qiz` |

Источник: `C:/Users/Alexander/.claude/projects/D--zPython-opencode/5ee34a89-f9f6-42c3-9b6b-8f8d38a334de.jsonl`. Квитанции: `parent-events.json`, `parent-recheck.json`, `verify/evidence.json`. Уникальные события считаются по `message.id`, не по количеству строк.

✓ CONFIRMED — хеш исходных 4 715 395 байт среза проверяющего повторно вычислен Codex: `7a7966f92433a4ea49386b5851762f9744ea8313e92aa4d7f3259f03b751a022`. Журнал затем дописывался; подтверждение неизменности именно этого префикса — `parent-recheck.json`. Более ранний срез 4 558 239 байт содержит три события; четвёртое добавилось позже. Это разные срезы, не расхождение счётчиков.

✓ CONFIRMED — независимый контроль не захватывает обычные `end_turn` и `tool_use`. Повторная проверка результатов инструментов различает закрытую пару сообщений и совершённый эффект: одна команда имеет `Not run`, ещё Bash и Write имеют `Interrupted` с неопределённым фактическим завершением. Квитанция: `verify/tool_result_check.json`. Эти команды не перезапускались.

## Какой это компонент

Inferred — наблюдаемая API-форма совпадает с опубликованным контрактом серверного streaming safety classifier Anthropic. Она отличается от локального Stop-hook и от auto-mode permission classifier, который решает, разрешать ли действие инструмента. Имя внутренней модели-классификатора и его веса не установлены. Наличие `defaultMode: auto` само по себе не делает auto mode причиной данного `refusal`.

Первичный источник: [Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback), разделы What a refusal looks like и Keep reasoning in thinking blocks. Документ определяет `reasoning_extraction` как запрос на вывод внутреннего рассуждения и отдельно предупреждает о требованиях, помещённых в системный промпт, skill или описание инструмента. Разрешены краткое объяснение, доказательства результата и сводка действий. Для этой категории документ не рекомендует fallback-модель.

✓ CONFIRMED — источник получен и сохранён: `parent-web/refusals-context.json`, URL выше, retrieved_at `2026-10-22T03:31:37.326143+00:00`, content_hash `sha256:fa8bee9761c9a50c0997d2b2766338e073d2e021658437b436f441f40a94e8a2`. SHA256 всего сохранённого ответа сервиса: `3ee922124b20f401cd6a81e71bb8faf901f050dbbfa05a93d457bcb8be3634d4`. Это разные объекты хеширования.

Дополнительные первичные документы: [Streaming refusals](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals), [Auto mode](https://www.anthropic.com/research/claude-code-auto-mode). Сохранённые ответы: `research/raw/`; квитанции хешей проверены Codex в `parent-research-audit.json`.

## Причина категории и граница вывода

✓ CONFIRMED — сервис назвал категорию `reasoning_extraction` во всех четырёх ответах. Его объяснение ссылается на ограничения reverse engineering/duplicating outputs. Это измеренная классификация сервиса; она не доказывает, что производственная задача действительно нарушает эти ограничения.

✓ CONFIRMED — реально переданный `api-request-blob` на строке 28 содержит требования `reasoning included` и `@CURRENT_SV`; блок с перечнем skills также называет чтение reasoning trajectory. Адреса и хеши: `parent-prompt-evidence.json`, исходный blob hash `d8e61939045bfc1dfef52c7203ee5ff84151f0b5efb604a6a7c001e9b2c0b492`.

Inferred — требования к представлению рассуждений и восстановлению траектории являются кандидатами на несовместимость с опубликованным контрактом. Семантический вектор задачи сам по себе не равен скрытой цепочке рассуждения. Привязка отказа к конкретному слову, SV-блоку, хуку или требованию НЕ доказана: одинаковый контролируемый опыт с исходным и изменённым публичным контрактом в этой работе не выполнялся.

Unknown — точная внутренняя причина выбора категории для каждого события, порог классификатора и причинность накопленного контекста. Удержанный текст и скрытое рассуждение не восстанавливались.

Публичные сообщения пользователей подтверждают существование похожего класса жалоб, но остаются свидетельствами авторов:

- [#88336](https://github.com/anthropics/claude-code/issues/88336): поиск собственной истории Claude Code получил такую же категорию.
- [#101715](https://github.com/anthropics/claude-code/issues/101715): Windows/Opus 5.5, два прерывания обычной разработки.
- [#97492](https://github.com/anthropics/claude-code/issues/97492): в комментариях описаны остановки интерактивного Desktop на Windows и повторные отказы после первого события.

Их страницы открыты Codex, релевантные разделы прочитаны. Их статистика не перенесена на эту машину и не использована как доказательство локальной причины.

## Папки, базы и память

✓ CONFIRMED — просмотрены структура `.claude/`, проектная `.claude/`, настройки пользователя, текущие Stop-hook endpoints, каталоги Desktop `Claude/logs` и `Claude-Data/claude_pzs8sxrjxfjjc`. Первичные события найдены в JSONL-хранилище сессий, не в базе OpenCode. Структурная квитанция: `parent-storage-inventory.json`. В текущем `settings.json` включён `permissions.defaultMode: auto`; Stop-hooks содержат собственные `decision:block/reason`, что является другим контрактом.

✓ CONFIRMED — в Desktop найдены IndexedDB/LevelDB, каталоги сессий и SQLite `declarative_performance_observer.db` размером 32 768 байт. Заголовок SQLite прочитан; попытка чтения schema через `mode=ro` вернула `sqlite3.OperationalError: database is locked`. Содержимое этой базы НЕ проверено. Приложение не закрывалось, блокировка не снималась, live-базы не копировались. Credentials/cookies/tokens исключены. Полный аудит содержимого всех баз и исторических хуков не выполнен.

✓ CONFIRMED — отдельный снимок Win32_OperatingSystem/Get-Process: около 689 МиБ свободной физической памяти, PID 20620 (`node`) — 3343 МиБ working set, OpenCode PID 1400 — 1250 МиБ, Claude PID 20412 — 730 МиБ. Private bytes — другая метрика, не сумма физической RAM. Связь RAM с классификацией `reasoning_extraction` не установлена; процессы не останавливались.

## Внешние специалисты и контроль качества

✓ CONFIRMED — живой каталог и первые assistant rows подтвердили: локальная линия MiniMax M3.1 Flash Free на Go, источники DeepSeek V4.1 Flash Free на Zen, проверка GLM 5.3 Flash Free на Zen. Сначала каждому передан собственный SV и запрос расшифровки, затем отдельный ограниченный приказ.

| Линия | Сессия | Организационный ticket | Результат при границе запуска |
|---|---|---|---|
| F1 local | `ses_e9e5d545bffe9ClnCt1PdLsy6J` | `524c80feecace72e6077836b8a39482c42b1c94c` | Итоговый отчёт не получен; результаты вызовов сохранены в сессии. Не принят как выполненный аудит папок/БД. |
| R1 research | `ses_e9e5d4b12ffeSCmuLuQFEKoIhI` | `d8412ae3c7582faa876165cc35701c58cf8f22f5` | Получены первичные документы и хеши; повествовательный отчёт содержал ошибки, его отрицание наличия категории опровергнуто своим raw. На этот вывод приёмка не опирается. |
| V1 verify | `ses_e9e5d41adffeUgrNVztMDV42ZB` | `204410fabd24f6715fa9ecd65015364640fa9776` | Первичные поля и контроли проверены; неверное отождествление tool_result и исполнения исправлено после замечания Codex. |

✓ CONFIRMED — `org.py delegate --no-wake` не исключил доставку assignee: старый presence-резидент начал вторую диспетчеризацию этих tickets, взял лизы и отправил дополнительные brief. Коллизия выявлена по read-back его сообщений, управление остановлено отдельным распоряжением, резидент подтвердил завершение. Это сбой координации расследования, не причина исходных отказов Claude. Первичные brief и `resident-coordination.md` сохранены.

✓ CONFIRMED — после предела бюджета три собственные сессии остановлены через квалифицированный `/session/{sessionID}/abort`; все три вернули true и затем idle. Квитанция `stop-receipts.json`. Старые роботы t140/t141 и процессы владельца этим действием не затронуты.

## Инструменты и остаток

✓ CONFIRMED — JSONL/Node filesystem read-back, публичный web-поиск и получение известных URL дали адресуемые свидетельства. CodeGraph установил реальные API `abort` и renderer `applyRender`; первичный общий поиск CodeGraph по слову classifier дал нерелевантные символы и не использован для атрибуции Claude.

✓ CONFIRMED — Universal Search `/health` и `/status` отвечали healthy. Один запрос `/web/search` с GitHub/site-фильтром вернул нерелевантные dictionary/Wikipedia/DOI hits: `parent-web/search-qualification.json`. Это провал релевантности конкретного поиска. `/web/context` для известного официального URL сработал. Прямое получение огромной `/docs/en/errors` через web было ограничено размером; другой маршрут сохранил документ. HTTP-мост один раз не прошёл health за 3 секунды и сообщил STALE; последующее nonce-health прошло — новый сервер не запускался.

Открытый остаток: завершить адресный аудит действительно используемого промпта/skills/hooks и проверить кандидаты на несовместимость через разрешённые публичные объяснения и сводки действий, не через запрос скрытого reasoning. Зафиксировать исходный/изменённый контракт до опыта; одинаковые модель/версия/контекст, независимый контроль. Это следующий leaf, не сделанное исправление. Смена настроек/политик и установка kernel в это расследование не входят.

Продолжение: существующий root ticket `327dbf71aee7a7fe1d887146d6599b2030fa21c7` / `claude-classifier-cuts`, принят Codex на epoch 1; активный план `plans/2026-10-22_claude-classifier-investigation.md`. Лизы детей требуют сверки двух эпох после коллизии; их состояние не приравнивается к приёмке. Полный стандарт 3×3 с unique-detection для причинного исправления не закрыт; SUCCESS/устранение проблемы не объявляется.

Product actual_diff: none. Изменены только материалы расследования и плановые записи. Тесты продукта и `_build.ps1` не запускались: код продукта не менялся, а сборка не проверяет причины отказа Claude. Проверка бюджета experiments завершилась exit 0: 8.20 GB из 16 GB, максимальная папка 1.60 GB из 2 GB. Результаты не удалять; зависимости и деревья репозитория не копировались.
