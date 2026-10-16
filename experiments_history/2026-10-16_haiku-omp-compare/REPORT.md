# Haiku/OpenCode/omp: контролируемое сравнение первого шага

2026-10-16, Asia/Singapore. Ограниченный исследовательский раунд, не исправление продукта и не завершение исследования общей задержки.

```yaml
Keywords: payload-factorization 0.35, controlled-latency 0.30, evidence-scope 0.20, retained-failures 0.15
Semantic dominant: Отделить измеренное различие пакетов запросов от недоказанного объяснения общей медлительности.
md5: 7cb19ea284d34fa68b7210e5c963d04f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 81e70d3af5c64b8292d15e6f370a49bc
```

## Что установлено

✓ На двух наблюдениях подготовленный установленным omp пакет через **тот же OpenCode gateway, HTTP/2, endpoint и API account** достиг первого текста/начала tool call за15.205 и8.280s; исходный OpenCode пакет —26.995 и31.856s. Различие воспроизведено без использования omp transport. Это не доказывает отсутствия транспортного вклада в исходных пользовательских прогонах.

✓ Оба пакета используют Haiku5.5, adaptive и effort=max. Поэтому объяснение общей разницы только выбором `max` не поддерживается. В обоих system присутствуют маркеры kernel; захваченный system omp больше, а не меньше. Отсутствием kernel разница не объяснена.

UNKNOWN: конкретный компонент, вызывающий разницу, и причина долгих последующих шагов. B меняет семь top-level fields; матрица изучает первую request без предшествующего reasoning. Влияние signed replay на continuation latency ею не проверено.

## G1: естественные наблюдения и их предел

✓ Readback свежей omp session: installed18.11.1, Haiku5.5, thinking=max; вопрос о проекте; первый assistant ответ около10.2s, TTFT7.26s, input+cache75315, output724, stop=toolUse. Затем compaction и abort — это не receipt полного успешного решения задачи. Полная история остаётся в private source, без копирования в public archive.

✓ Readback OpenCode10.0.1359: первый шаг с похожим greeting, но UTC suffix и подготовленным контекстом, input+cache123358. Второй шаг143.4s включает reasoning interval126.6s и28832 thinking tokens. Естественные запросы не равны; считать их matched comparison нельзя. Locator/hash сохранены в ignored `natural-observations.json` и прежнем live-latency evidence.

## G6: квалификация инструмента actual CLI

✓ CLI hook `before_provider_request` подтверждён runtime18.11.1. Квалификация `20261016T004545Z_546f6c6f`: capture-stop child exit74, capture readback, независимый localhost counter=0. Control без stop: child exit0, counter=1 и известный валидный SSE. Исключение из extension не используется как запрет отправки: source runner ловит его и может продолжить.

✗ Первая попытка `20261016T004453Z_ad190fd4` вернула JSON вместо SSE в control; остановлена и сохранена отдельно. Это UNKNOWN квалификации, не PASS. После ремонта fixture вся qualification повторена.

✓ Capture-only `20261016T004631Z_42dab6b9`: реальный установленный CLI собрал payload, child вышел74 до inference. Ограничения: synthetic API key определяет API-key mode; owner extensions отключены; adm-rag MCP connection refused, его tools недоступны. Это **pre-send payload**, не точный снимок переданного запроса owner omp. Qualification не проверяла byte identity hook payload с локально полученным body. При последующей матрице outgoing bytes каждого arm проверены отдельным gateway raw-wire readback.

| Поле | OpenCode A source | Текущий omp capture B source |
|---|---:|---:|
| effort | max | max |
| исходный output cap |125000|128000|
| thinking display | отсутствует | summarized |
| block binding | отсутствует | prefix_mismatch_behavior=drop_block |
| context management | отсутствует | clear_thinking keep=all |
| system JSON bytes |125677|165770|
| tools count / JSON bytes |59 /158879|11 /17120|
| messages JSON bytes |32897|326|

A/B дополнительно различаются `metadata` и наличием `tool_choice`. System hashes не совпадают. Размеры — UTF-8 JSON bytes, не tokenizer counts. Наличие marker не доказывает соблюдения kernel моделью.

## G8: заранее заданная матрица

Контракт до сети — в активном плане `plans/2026-10-16_haiku-omp-controlled-latency.md`. Порядок **A,B,C,D,D,C,B,A**, восемь calls, один API account/endpoint, actual isolated OpenCode gateway H2, max_tokens8192,90s deadline, одинаковые feature headers. Исходные caps125000/128000 явно изменены; replay исходного slow run не заявлен. Возвращённые tools не исполнялись.

- A: исходный первый OpenCode body, изменён только cap.
- B: весь текущий omp pre-send body, изменён cap; **bundle diagnostic**, не однофакторный oracle.
- C: A, заменён только tools catalog на B. Capabilities и описания также меняются; это не тест чистого числа tools и не готовый drop-in fix.
- D: A, заменён только messages на B. Это input-preparation bundle, не только удаление даты.

✓ Structural differential подтвердил C-only-tools и D-only-messages. Все8 outgoing hashes совпали с запланированными arms. Reader controls: bytewise UTF-8, missing message_stop и SSE error event. Артефакты: `matrix-results.json`, `wire-readback.json`, `analysis.json`.

| Порядок/arm | Headers,s | Первый text/tool-start,s | Полный SSE,s | Thinking tokens | Stop |
|---|---:|---:|---:|---:|---|
|0/A|1.294|26.995|28.474|5619|tool_use|
|1/B|7.126|15.205|15.208|1483|tool_use|
|2/C|2.808|нет|41.226|8192|max_tokens|
|3/D|2.525|24.415|26.721|4758|tool_use|
|4/D|1.334|8.315|9.281|1480|tool_use|
|5/C|1.814|нет|38.869|8192|max_tokens|
|6/B|1.136|8.280|8.283|1258|tool_use|
|7/A|0.868|31.856|33.387|6896|tool_use|

✓ Все8 HTTP200/message_stop, без provider_error/deadline/reader error. **SSE completion не означает успешное выполнение пользовательской задачи.** C дважды правосторонне ограничен output cap, а не завершён ответом; его времена не усредняются как completed answers.

Предварительный порог был задан до сети: оба samples candidate раньше обоих A, с разницей≥30% и≥2s для некензурированного A. B проходит даже по худшему сравнению15.205 против26.995s. D по худшей паре24.415 против26.995s даёт только9.56%, поэтому заранее заданный порог не проходит; выбирать среднее постфактум нельзя. Наличие этого сигнала B — основание следующей факторизации, не универсальная причинность.

## Ограничения, обнаруженные независимым review

- Поле harness `first_action_ms` для tools — начало блока до полной аргументации. Правильное название метрики: time-to-text/tool-start, не готовность исполнимого действия.
- `action_ready` проверяет JSON.parse, но не все names/schemas/закрытие всех tool blocks и в общем случае не исключает errors/deadline. В данных8 ошибок отдельно не обнаружено; исходные записи не исправлялись. `analysis.json` сохраняет более узкую интерпретацию, не product PASS.
- Cache warmth различается: первые/повторные calls имеют разные cache creation/read. Порядок симметричный, но n=2 недостаточно для latency distribution, equivalence или доказанного remediation.
- Подстановка меньшего каталога C не воспроизвела быстрый B. Это совместимо с несогласованностью system и заменённых tools; простая рекомендация «сократить tools и готово» не обоснована.
- Matrix process записал финальный artifact после8calls, но gateway background timers удерживали его живым. Свой runner остановлен явно после final receipt. Clean suite-exit PASS не объявлен; lifecycle harness требует ремонта до повторного использования. Owner process/session не остановлены.
- Source OMP adapter прочитан на revision30d1b5ca95f0d8c61ef5841350b197715f72ebfd; binary/source equivalence не установлена. Наблюдаемые capture fields опираются на installed CLI, source выводы не перенесены на binary автоматически.

## Аудит силы прежних выводов

| Evidence | Допустимая сила | Не покрывает |
|---|---|---|
| JSON fields + official docs | совместимость проверенных параметров | latency и весь protocol loop |
| SDK fixture | поведение конкретной serialization seam | actual TUI и завершение задачи |
| Direct API200 | доступность и результат конкретного API call | OpenCode end-to-end |
| cap4096/8192 thinking-only | исход limited arm | completion125000-token user request |
| Текущий B через наш gateway | воспроизведённая разница bundle на2calls | единственный виновный компонент |

Переход от локального факта к широкой причине/«работает правильно» не получает stamp из этих строк. Этот отчёт не переписывает старые измерения; он ограничивает их применение и сохраняет неподтверждённые объяснения отдельно.

## Продолжение: задача остаётся открытой

Восемь разрешённых inference calls этого раунда израсходованы. План **ACTIVE**, не moves-to-completed; product/config/source repair не выполнялся. Continuation receipt: `20261016T004948Z_970f7c8a`, `matrix-results.json` finished2026-10-16T00:53:11.800Z,8calls, outgoing hashes в `wire-readback.json`.

Следующий различающий leaf:2×2 **system×tools**, одинаковые messages/thinking/display/binding/context/account/headers/gateway/cap; все cells и новый baseline измеряются заново. Это проверит взаимодействие system/tool catalog, совместимое с нынешним C. Отдельный leaf — valid original signed-empty A/B для continuation с проверкой prefix/signature; восстановление всех поздних подписей сразу недопустимо без qualification.

Остаток также включает native-vs-gateway matched body, owner omp auth/extension/MCP parity и полный tool loop. Ни один из этих листьев не отмечен выполненным и не заменён объяснением по догадке.
