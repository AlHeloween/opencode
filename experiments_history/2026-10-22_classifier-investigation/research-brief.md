Smit, исследователь первичных источников. Задача R1 из plans/2026-10-22_claude-classifier-investigation.md.

Цель: первичные документы, публичные issue reports и точный контракт остановки генерации и классификатора разрешений Claude; URLs, дата, content hashes и границы вывода.

Разрешено:
- universalsearch source hybrid/web/code для поиска первичных источников (официальные docs/spec/repo, DOI, стандарты). Сниппеты — Guess; generic web никогда не Inferred.
- webfetch только известных URL для content_hash и source_stamp. Первичный авторитет (official docs, spec, registry) — Inferred только с source_stamp.
- Локальные исходники проекта только для различения слоёв (permission ask в packages/opencode/src/tool/universalsearch.ts, провайдерские контракты) — READ ONLY, без изменений.

Найти и различить:
- генерационный refusal как поле протокола ответа (stop_reason/finish_reason refusal) — точный контракт, версия, дата, URL, content hash
- классификатор разрешений/политик (usage policy / permission classifier) — отдельный контур, его входы/выходы, чем отличается от stop_reason
- разрешения auto mode / permission prompt в агентных продуктах — третий слой, не смешивать
- публичные issue reports о ложных срабатываниях — URL, дата, статус, что доказывают и чего не доказывают

Запрещено: менять код, выдавать правдоподобие темы за серверную категорию, восстанавливать удержанный текст, слать сырые личные переписки в веб-поиск, заявлять причинную связь без наблюдаемого поля/receipt.

Вывод: experiments/2026-10-22_classifier-investigation/research-report.md:
- таблица источников (URL, дата доступа, версия, content hash, класс authority, что покрывает)
- контракт каждого слоя (поле, значения, где ставится)
- границы: что документы различают и чего не различают; если не различают — атрибуция Unknown
- negative: сгенерируй EXPECTED_FAIL-контроль (запрос, который не должен классифицироваться как refusal)

Ограничение: до 35 вызовов, 600000 ms. Не запускай субагентов. В конце: пути/хеши, unresolved, собственный SV.
