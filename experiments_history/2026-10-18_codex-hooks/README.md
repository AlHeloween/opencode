# Codex: нативное восстановление контекста и отчётность роботов

План: [2026-10-18_codex-continuity-and-robot-hooks](../../plans_completed/2026-10-18_codex-continuity-and-robot-hooks.md).
Компонент: [codex_hooks.py](../../scripts/codex-hooks/codex_hooks.py).

CONFIRMED ✓ родительские инструменты проверили source
`9e3728562995b35ca4154a0b7d80e499f9184e47ec1b70317b2734b2b2f7c97c`.
Протоколы, имена команд, размеры и ссылки ниже относятся к этому срезу.

| Проверка | Наблюдение / адрес |
|---|---|
| Нативные Windows tests | 55 tests, exit0, runner `20261018T053637Z_a0fe6fdf` |
| Независимые основные predicates | 37 PASS, runner `20261018T053558Z_7f4ecbba` |
| Переполнение, свежая отмена, identity, pending/stale child | 13 PASS, runner `20261018T053558Z_755d7524` |
| Граница полного контекста | cap262144 bytes; footer+рабочая recall-команда, оба полных исходных текста доступны; runner `20261018T053558Z_9e7ba697` |
| Normal trust | Desktop `0.163.0-alpha.10.2`, все7 handlers enabled/trusted, hook warnings/errors0; `rpc-trusted.json` |
| Настоящий компакт | actual preCompact/postCompact/sessionStart, следующий запрос содержит217785-byte developer hook block с3контрольными решениями; `native-lifecycle-receipt.json` |
| Отрицательный контроль | удаление hook block при сохранённом user input даёт EXPECTED_FAIL |
| Внешний OpenCode | реальный final + idle через проверенный host, report сохранён и прочитан; completion отдельно от acceptance |
| Обязательная сборка | runner `20261018T054329Z_1e985394`, exit0/loss0, candidate10.0.1440 в dist; `build.log` |

Стенд использует настоящий Fossil, SQLite и установленный Codex. Три Responses
запроса обслужены детерминированным loopback endpoint: нейросеть не запускалась.
Capture IDs связаны с первичными строками собственного fixture rollout и SHA
текстов. Это доказательство доставки контекста, не оценка качества ответов модели.

## Сохранённые отказы

REFUTED ✗ первоначальные реализации: отсутствующий vector_prev; чтение parent
вместо child transcript; commentary и старый final ошибочно завершали child;
полный output cap вытеснял обязательную recall-команду. Их inputs/output и source
SHA остались в приватном эксперименте, адреса/хэши — в `PRIVATE_EVIDENCE.json`.

HARNESS: Fossil `user new` ждал пароль в ConPTY; прогон остановлен и не засчитан.
Исправлены fixture password+stdinDEVNULL, затем выполнены native primitive и suite.
Пустой thread/start не создал rollout для resume: сохранён отказ, после него
использована новая собственная сессия с materialization перед compact.

Две названные Smit квитанции не прочитаны по ожидаемому стандартному log path;
в `RUNS.json` они остаются `UNAVAILABLE_AT_EXPECTED_ROOT`, не доказательством.
Приёмка опирается на независимо выполненный родительский прогон55tests, а не на
эти сообщения исполнителя. Полный отчёт исполнителя сохранён приватно.

## Полные данные и публичный архив

Полные транскрипты, provider requests и сообщения Smit сохранены без обрезания в
gitignored `experiments/2026-10-18_codex-hooks/`; runtime projection находится в
`.opencode/data/codex-hooks.sqlite`. Здесь лежат безопасные receipts, исходники
синтетических стендов и manifest. Реальные conversation/request bodies не
переносятся в публичный архив. `PRIVATE_EVIDENCE.json` сохраняет их полный адрес,
размер и SHA; это указатели, а не замена первичного доказательства.

Содержимое отобрано отдельно по canon `experiments_history/README.md`:
синтетические fixture literals и собственные SV metadata проверены как таковые;
реальные сессии/requests исключены из tracked набора. Глобальный archive.cjs
перемещает весь scratch tree, поэтому для этого scope применён ограниченный copy
с byte/hash readback; чужие эксперименты не затронуты.

## Повторение

1. Из `scripts/codex-hooks`: `python -X utf8 -m unittest discover -s tests -v`.
2. Скопировать `oracle/` из этого архива в новый gitignored каталог вида
   `experiments/YYYY-MM-DD_codex-hooks-replay/oracle/` (сохраняется глубина ROOT).
3. Выполнить `fixture.py`, затем `product_oracle.py --run core`,
   `edge_oracle.py --run edges`, `overflow_boundary.py --run overflow`.
4. Для live delivery использовать `lifecycle_probe.py --phase exercise --fresh
   --run native --executable <desktop-codex.exe>` после обычного review/trust.
   Стенд создаёт только новую собственную сессию и останавливает свои процессы.
   Исторический стенд не архивировал эту сессию автоматически: после проверки
   обязательно архивировать именно её через штатный API приложения. Для нового
   автоматического replay cleanup должен входить в runner; исторический файл
   здесь сохранён без переписывания как источник уже выполненного прогона.

## Исправление жизненного цикла тестового чата

CONFIRMED ✓ штатный `set_thread_archived` архивировал тестовую сессию
`01a14d86-6970-7452-912a-8918b2ec0445`; read-only SQLite readback подтвердил
`archived=1`, активных `hookfixture`-сессий нет. Открытие этой синтетической
сессии до cleanup приводило к сообщению об отсутствующем `hookfixture`: override
был только у тестового процесса. Рабочая сессия использует `openai`, глобальный
config не содержит `hookfixture`. TOML parse и новый native hooks/list прошли.
Добавления фиктивного провайдера и изменений пользовательского config не было.

Первичный rollout перемещён штатным архивированием; полный SHA-256 совпал с
исходным runtime report. Новый адрес и readback — `fixture-cleanup.json`.
Ранее записанные line-addresses читаются по этому remap с теми же номерами строк;
исходные runtime отчёты не переписаны.

`MANIFEST.json` содержит source pins и точные bytes/SHA каждого archived файла.
`.gitattributes` запрещает преобразование строк внутри этого evidence archive:
сохранённый Git blob должен совпасть с исходными байтами. Для двух неизменённых
tracked Python-зависимостей рабочие CRLF и Git LF различаются; source pins хранят
оба digest и явно квалифицированное отношение «только CRLF→LF».
Рабочая `.codex/hooks.json` локальна и gitignored; `hooks-installed.json` фиксирует
проверенную конфигурацию этой Windows-машины. При переносе нужны новые paths и
обычный trust. Ручные trusted_hash и bypass не используются.

<!-- goal_sv: Keywords: native-evidence 0.45, context-recovery 0.35, failure-controls 0.20
Semantic dominant: Архив связывает установленный компонент с независимыми нативными проверками и сохранёнными отказами.
md5: b710c4a92e3f46d5a06189ebc2735d40
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f81c69a257304de89b06173ac54e2f90
note: hash values are generative tags — search them, never compute them.
-->
