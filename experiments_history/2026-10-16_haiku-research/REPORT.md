# Haiku 5.5: пустой ответ, thinking и отмена

Дата исследования: 2026-10-16, Asia/Singapore. Это исследование текущего кода и отдельного исторического запроса, не поставка исправления.

```yaml
Keywords: haiku-behavior 0.35, stream-observability 0.25, signed-replay 0.20, cancellation 0.20
Semantic dominant: Разделить скрытую генерацию, потерю replay и отмену по воспроизводимым данным.
md5: e9f62407acb8410f97d5238eb610ca45
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 521cbe68349a4f82b176d9e028fa703d
```

## Вывод и границы

✓ Подтверждено live HTTP/2: Anthropic принимает Haiku 5.5 и возвращает полноценные SSE-ответы. На исходной большой истории при effort=max и ограничении 4096 output tokens оба варианта display завершились с `max_tokens`: весь output budget ушёл в thinking, текст и tool call отсутствовали. Это воспроизводит пустой результат при изменённом output cap, а не весь исходный 96-секундный ход.

✓ Подтверждено SDK fixture: отсутствие `display` в нашем Haiku variant действительно доходит на wire. Явное `display: summarized` поддерживается установленным SDK. В live-паре оно сделало thinking видимым, но не обеспечило финальный ответ. Подмена «показать thinking» на «исправить работу агента» отвергнута этими двумя arms.

✓ Подтверждено differential fixture: прямой SDK сохраняет пустой thinking с подписью; `ProviderTransform.message` перед SDK удаляет его. Это самостоятельный дефект сохранения replay, не доказанная причина первого зависшего хода.

UNKNOWN: исходный запрос с `max_tokens=125000` был отменён пользователем; его полного response capture нет. Нельзя установить по имеющимся записям, завершился бы он ответом, и нельзя объявить продукт исправленным. Actual TUI frame и полный tool loop в этом исследовании не квалифицированы.

## Исходное наблюдение

✓ Readback capture и журналов: request `bf0dd5ff-9ab4-4a09-a7ef-54243b2bc360`, исторический runtime 10.0.1359. Запрос начался 2026-10-15 16:13:37.195Z; reasoning-start появился примерно через 13 секунд; пользовательский abort — 16:15:13.195Z, примерно через 96 секунд от старта. В SQLite остались step-start и пустой reasoning, без text. Usage равен нулю в незавершённой записи и не доказывает нулевую генерацию провайдера.

✓ Capture body: модель `claude-haiku-5-5`, adaptive thinking, effort=max, `max_tokens=125000`; 6 system blocks, 111 messages, 59 tools, 792473 UTF-8 bytes. SHA-256 body: `6f212a766cf332b0fb09d2c9bdcab16bf4e62c91355d4acc49fd19483cff5a93`; capture: `40283d19ae32433e13b91b049b8506401f3856713be43e99499705fee6f39a41`. Исторические session/message ids и оригинальная история остаются только в ignored scratch/runtime evidence.

✓ Gateway log связывает h3 handshake failure с переходом на h2 и получением первого chunk. Наблюдение не подтверждает полный обрыв связи с провайдером. Новый live h2 probe также работает; эквивалентность исторической сети текущей не утверждается.

## Живая матрица

✓ Инструмент: `live-probe.mjs`, нативный HTTP/2, настоящий API account, без исполнения возвращённых model tools. Каждый запрос ограничен 150 секундами и не более 8192 output tokens. Credentials читаются только в памяти. Оригинальные system/tools/messages сохраняются в history arms; thinking display, effort и output cap перечислены явно.

| Input | Effort | Display | Output cap | Время, с | Видимый thinking, символы | Text, символы | Stop |
|---|---|---|---:|---:|---:|---:|---|
| small CRT | max | default/omitted | 2048 | 3.247 | 0 | 7 | end_turn |
| small CRT | max | summarized | 2048 | 4.724 | 622 | 7 | end_turn |
| original history | max | default/omitted | 4096 | 23.852 | 0 | 0 | max_tokens |
| original history | max | summarized | 4096 | 20.862 | 3732 | 0 | max_tokens |
| original history | low | summarized | 4096 | 7.353 | 0 | 186 | tool_use |
| small truncation control | max | summarized | 16 | 1.506 | 69 | 0 | max_tokens |
| original history | medium | summarized | 4096 | 7.436 | 0 | 188 | tool_use |
| original history | high | summarized | 4096 | 27.260 | 3565 | 0 | max_tokens |
| original history | max | default/omitted | 8192 | 37.780 | 0 | 0 | max_tokens |

Все девять arms: HTTP 200 и `message_stop`. ✓ Usage трёх history arms при max/high с cap=4096 показывает output=thinking=4096. При max/8192: output=8192, thinking=8191, text отсутствует. Low/medium вернули tool call, но его результат и последующее завершение задачи не проверялись. Основная серия: runner `20261015T165513Z_4b8dea2c`, supplement: `20261015T170122Z_dfdea369`; оба exit=0, полный stdout прочитан без dropped/truncated.

✗ Контроль формата small CRT не прошёл: независимый перебор дал 423, модель вернула `**423**`, хотя запрос требовал только число. `answer_matches_control=false` сохранён; математически совпадающее значение не превращает провал формата в PASS.

✓ Local reader controls: bytewise UTF-8 проходит; поток без `message_stop` отвергается как incomplete (EXPECTED_FAIL). Tiny-budget arm показывает, что HTTP 200 + complete SSE не означает наличие пользовательского ответа.

Ограничение сравнения времени: последовательные одиночные запросы с разной cache warmth и изменением top-level effort. Это diagnostic matrix, не latency benchmark и не статистическая оценка. Никаких утверждений о равном качестве low/medium/max она не доказывает.

## Размер запроса и метрики

✓ Anthropic count_tokens: 328546 input tokens для исходных model/system/messages/tools/tool_choice/thinking. Initial/final usage history arms независимо подтверждает 4 + 328542 input/cache tokens. Model metadata сообщает active Haiku 5.5, max_input_tokens=1000000, max_tokens=128000.

✓ Структура wire: system JSON 124537 bytes, tools JSON 157869 bytes, messages JSON 509880 bytes; в messages 42 text, 82 tool_use и 82 tool_result, thinking signatures отсутствуют.

Inferred, source pin: `session/llm.ts:401-424` считает символы system/message text, даёт фиксированную малую стоимость другим частям и возвращает `ceil(chars/4)+REQUEST_OVERHEAD_TOKENS`. Это не tokenizer полного wire и не включает полный tools schema как отдельный аргумент. Поэтому исторические `contentTokens=66059` и provider input=328546 нельзя считать измерениями одной метрики. Влияние этой эвристики на конкретный guard требует отдельного regression predicate; автоматическая замена числа в этом исследовании не делалась.

## SDK, replay и TUI

✓ Установлены `@ai-sdk/anthropic 4.0.57`, `ai 7.0.106`. Настоящий SDK с capture-fetch подтвердил Haiku adaptive, effort на wire, отсутствие display по умолчанию; controls — Opus 4.7 с summarized, Haiku 4.5 с enabled. Параметры 4.5 взяты из искусственной валидной fixture, это не измерение production catalog 4.5.

✓ Реальный SDK SSE parser восстановил signature metadata при пустом reasoning и правильный текст `T_OK_α` при разрезании UTF-8 на chunks. Direct SDK replay сохранил signed-empty block, current transform — нет. Source: `provider/transform.ts:88-90`; SDK `dist/index.js:3091-3107`, `5639-5648`. Нужен отдельный scoped fix и регрессия на сохранение семантически значимой metadata при пустом тексте.

Граница `sdk-results.json.controls.truncated_stream`: этот конкретный control проверяет terminal predicate на массиве fixture events; truncated поток через настоящий SDK НЕ запускался. Отдельный live harness квалифицировал собственный bytewise SSE reader и incomplete predicate. Эти два уровня не объединяются в доказательство SDK truncation handling.

Inferred, source pins: processor создаёт reasoning part на start (`session/processor.ts:883-902`); TUI фильтрует пустой reasoning (`cli/cmd/tui/routes/session/index.tsx:2258-2262`) и учитывает showThinking (`:2291`). Поэтому reasoning-start/TTFB не равен первому видимому тексту. Persisted `thinking_visibility=true` прочитан с диска, но это не доказательство текущего in-memory значения в уже запущенном TUI.

UNKNOWN, explicit harness gap: приватный ReasoningPart не был смонтирован в actual Session frame. Следующий oracle: реальный Session и provider stack с isolated fixture server; signed-empty/nonempty × thinking visibility true/false, полный не перекрытый кадр. Копия компонента или screenshot соседнего DialogMessage не заменяет эту проверку.

## Transport и отмена

✓ Parent independently reran `gateway-fixture.ts`: actual wrapFetch, локальный HTTP/1.1 SSE, complete и consumer reader.cancel после наблюдённого nonempty thinking. Прочитаны per-response JSON и raw; терминалы complete/aborted и byte identity верны; противоположный terminal отвергается (EXPECTED_FAIL). Это не квалифицирует AbortSignal на HTTP/2.

✓ В parent HTTP1 rerun `20261015T170029Z_f8ef125b` callback отмены server stream наблюдён (`serverCancelledAtReadback=true` для abort; false для complete). В раннем agent run callback к readback ещё не наблюдался. Это timing-sensitive наблюдение callback; byte identity и terminal captures подтверждены независимо от него. Historical missing-response capture не объясняется этим HTTP1 PASS.

✓ Независимый parent rerun HTTP/2 fixture: `20261015T170413Z_04ea3748`, exit=1, runner bytes_written=860, dropped=0, truncated=false; полный stdout прочитан. Node HTTP/2 fixture независимо квалифицировал h2c ответом `H2_QUALIFIED`; actual gateway complete control сохранил 316 bytes. После `AbortController.abort()` чтение через gateway осталось pending; специально отправленный после этого `LATE_AFTER_ABORT` дошёл до потребителя, capture получил terminal=complete. Delivery predicate отмены — FAIL. Поле artifact `deliveryPredicate=EXPECTED_FAIL` означает пойманный провал требования, не самостоятельный mutation control; различающий control — прямой H2 transport на том же origin. Raw abort=452 bytes, SHA-256 `043721a857c4fade4919bfd665745093995a61289e67708079c67ba206a6ba76`; parent перечитал файл и пересчитал hash.

✓ Механизм потери сигнала: `adaptive-client.ts:859-867` не передаёт `init.signal` в streaming H2; nonstream branch `:870-878` также его не передаёт, но runtime fixture проверял только streaming. Прямой `H2.requestStream` на том же origin после сигнала отверг чтение `Request aborted`, сервер получил RST_STREAM(CANCEL)=8, pooled session осталась healthy. Однако cleanup отдельно выдал unhandled rejection `ERR_INVALID_STATE` из `h2-transport.ts:504:20`, где `writer.close()` выполняется после abort. Поэтому direct control подтверждает доставку отмены, но НЕ clean lifecycle. Оба source defects сохранены; источник не исправлялся. Fixture использует localhost h2c, не TLS и не исторический runtime 10.0.1359.

## Официальный контракт и альтернативы

Inferred, официальная [Haiku migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide): Haiku 5.5 по умолчанию возвращает пустой thinking с подписью; summarized запрашивается явно. Thinking расходует output budget. Replay требует сохранения блоков и стабильного предшествующего префикса. Это поддерживает проверку display/replay, но само по себе не доказывает состояние исторического запроса.

Inferred, [thinking documentation](https://platform.claude.com/docs/en/build-with-claude/thinking): omitted и summarized меняют выдачу summary, подписи передаются обратно неизменёнными; omitted может уменьшить время до текста. Поэтому summarized — решение видимости, не доказанный способ ускорить ответ.

Inferred, [Haiku prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5): medium рекомендован как исходная точка; xhigh/max требуют собственных evals. Документированное отсутствие visible text в некоторых xhigh multi-turn cases нельзя автоматически приписать исходному max case. Наши max/high arms остановились по лимиту, не end_turn без текста.

✗ Универсальная гипотеза «API не принимает Haiku» противоречит девяти bounded inference arms. Не исключены историческая нестабильность и последующие сети/аккаунты. Совместимость SDK проверена на fixtures, а не на всём приложении. Нет основания объединять отдельные Muse Free 429 и Longcat Go 429 с причиной Haiku.

## Проверки, сохранённые сбои и следующий ремонт

✓ Package baseline: `test/provider/transform.test.ts`, `test/provider/transform-anthropic-adaptive.test.ts`, `test/session/reasoning-finalize.test.ts`: 188 pass, 0 fail, 373 expect, run `20261015T165514Z_967905af`; полный stdout прочитан, dropped=0, truncated=false.

✗ `_build.ps1 -Task build`, run `20261015T165629Z_9cde306d`, exit=1: candidate package build и smoke `10.0.1362`/embedded reasoning_prompt прошли, затем Copy-Item на `_build.ps1:247` не смог заменить `dist/bin/opencode.exe`. CIM readback: работающий сервер PID18400 использует этот путь (`serve --port 4123`). Процесс не остановлен. Полный build НЕ PASS; сборочный output lock — отдельный residual. `bin/` не менялся.

Сохранены невалидные ранние fixture attempts: SDK с нереалистичным 4.5 limit вызывал предупреждение; исправлена только candidate fixture и повторена. Gateway attempts с tsconfig override завершались Bun internal directory error после вывода PASS — они не приняты как clean proof; без override повтор прошёл. Отсутствующий root node_modules SDK path исправлен точным package-local path. Ни один такой вывод не скрыт за последующим зелёным запуском.

Приоритет отдельных будущих bounded repairs, без изменения product в этом исследовании:

1. Сохранение signed-empty thinking в transform с wire differential regression и реальным continuation smoke.
2. Передача AbortSignal через gateway и безопасный H2 cleanup. Fixture уже воспроизводит оба сбоя; regression обязан исключить late delivery, unhandled rejection и повреждение соседнего pooled stream.
3. Явное состояние «thinking без видимого summary», корректное различение start/progress/text и stop_reason=max_tokens; actual TUI frame oracle обязателен.
4. Effort policy — eval на типовых задачах с выполненным tool loop. Medium/low tool_use на одном запросе не доказывает качество решения.
5. Исследование guard estimator на полном request, сохраняя различие content cadence и provider input. Не менять cadence по одному несопоставимому числу.

Reopen historical cause только при response capture того же request либо согласованном воспроизведении с исходными параметрами; новое устройство/SDK/код инвалидирует соответствующий stamp. Research artifact не даёт разрешения на install/promotion/kernel changes.

## Evidence index и воспроизведение

Публичная часть: `live-measurements.json` (метрики без пользовательского текста), `sdk-results.json`, HTTP1/H2 fixture results и raw synthetic captures, `source-pins.json`, `receipts.json`. Полные runner state/stdout лежат в `receipts/<run-id>/`. Неопубликованные оригинальные captures/SQLite/private transcript остаются по исходным локальным адресам; их отсутствие делает историческую часть невоспроизводимой на другой машине, а не автоматически подтверждённой.

Из корня этого worktree, через cmd_runner, без глобальных конфигурационных изменений:

```text
bun experiments_history/2026-10-16_haiku-research/sdk-probe.ts
bun experiments_history/2026-10-16_haiku-research/gateway-fixture.ts
bun experiments_history/2026-10-16_haiku-research/h2-abort-fixture.ts
node experiments_history/2026-10-16_haiku-research/live-probe.mjs --supplement
```

Последняя команда платная и требует оригинального private capture и API credential этого worktree; без аргумента она выполняет основную серию из 6 запросов, supplement — ещё 3. Не запускать обе автоматически при обычной offline проверке. H2 fixture при текущем дефекте ожидаемо возвращает exit=1 и сохраняет stack; это не зелёный тест отмены.

H2 fixture — reproducer текущего дефекта: он специально проверяет terminal=complete после проигнорированной отмены. После ремонта корректный aborted terminal потребует отдельной requirement-based regression, а не сохранения этой ошибочной нормы. Независимый review выявил эту границу и границу SDK truncation; они исправлены в интерпретации, исходные измерения не переписаны.
