<!-- intention: Обычный ввод выглядит проигнорированным во время скрытой подготовки CodeGraph -> запрос сразу показывает активность и этап подготовки, затем ответ или корректную отмену. -->
<!-- goal_sv: prompt-launch 0.40, http-stream 0.30, independent-oracle 0.30; dominant: Принятый пользовательский запрос обязан запустить ход или показать явный отказ. -->
# Видимый прогресс до запуска модели

Связь: `plans/MASTER_PLAN.md`, проверяемое состояние основного turn loop.

## Наблюдения владельца и чтение состояния

Проект `D:/zPascal/XEComponents`, сессия `ses_ef0fcf857ffeZhEEzRxLWqV4z2`.
Обычный ввод не вызывал реакции ещё до `/compact`; compact реакцию вызвал.
Ранний подозреваемый `time.compacting` не объясняет исходную хронологию.
До compact журнал показывает POST /message HTTP200 за 10/42 ms без нового loop;
после compact обычные сообщения снова принимаются и сохраняются без нового ответа.
В момент чтения status idle, questions/permissions пусты, revert null.
Живые сессии и файлы XEComponents не изменяются.

## Задачи

- [x] P1 — сохранить минимальную хронологию и различить обычный prompt от summarize/loop. <!-- sv: chronology,prompt-route,source-path -->
- [x] P2 — локальный HTTP-оракул с настоящим SessionPrompt/Runner и детерминированным провайдером, без живой модели. <!-- sv: http-stream,reproduction,local-provider -->
- [x] P3 — исправить подтверждённый механизм, проверить обычный запрос до compact, повторный запрос и отмену; типы, сборка и доказательства. <!-- sv: causal-repair,regression,closure -->

## Smoke Tests

До изменения продукта: настоящий HTTP и удержанный stdio MCP, без живой модели. Контроль `20261015T101715Z_e11ec2df` подтверждает обычный/async путь. Отрицательный оракул `20261015T102303Z_2fdb7fb9`: MCP уже получил запрос, providerCalls=0, status=null вместо busy; после освобождения MCP оба пути завершаются ответом. HTTP200 в журнале означает создание ответа, а не окончание body. Ранняя гипотеза о неработающем HTTP stream опровергнута. Инвалидный первый harness `20261015T102213Z_1cbce811` сохранён отдельно.

После: ответ провайдера и новая assistant-строка по обычному маршруту до compact, второй prompt и abort/restart; точечные проверки из package dir, typecheck, `_build.ps1`.

Предсказание ремонта: при удержанном MCP status=busy с пояснением подготовки; настоящий кадр TUI содержит пояснение до любого вызова модели, затем показывает ответ без переключения сессии. Отмена подготовки возвращает idle без вызова провайдера. Сам таймаут MCP 120 секунд этим ремонтом не сокращается. Причина каждого эпизода в живой сессии остаётся за границей локального воспроизведения.

## Проверенные результаты и сохранённые отказы

- `20261015T103945Z_05401cd5`: 4 pass / 29 assertions — обычный HTTP, второй запрос в ту же сессию, async, кадры `preparing code graph`/ответа, отмена MCP без вызова модели, новый запрос после отмены; отдельно удержанный реальный CLI sync и завершение дерева процессов при отмене.
- Усиление оракула `20261015T104649Z_3ebb3aa3` нашло ещё RED: после старта inference кадр всё ещё показывал preparing. Solid setStore мёржил новый busy в старый busy с message. `session.status` теперь заменяется через reconcile. `20261015T104749Z_22dfd0be`: 4 pass / 31 assertions, отдельные кадры preparing → working → reply; `20261015T104750Z_d3f2a2dd`: 37 pass / 104 assertions. Окончательный typecheck `20261015T104743Z_d8198efe` exit0.
- `20261015T103946Z_e9c799b9`: 37 pass / 104 assertions — Runner, graph-first, полный Session после Revert.
- `20261015T103420Z_2de151fa`: 6 pass / 11 assertions — исходные graph-prebuild контракты (61 другой тест не выбран фильтром CLI).
- `20261015T104234Z_309bcef9`: typecheck exit0. Предыдущие RED сохранены: неполная привязка theme в новом native fixture исправлена штатным registry; синтаксис параллельного UniversalSearch менялся в процессе проверки. Единственный дополнительный ремонт типа — optional scope в Metadata.source_stamps, фактическое поле входящего wire stamp; assertion не смягчался.
- `20261015T104038Z_a7d6630b`: `_build.ps1` exit0, candidate10.0.1355 и embedded prompt smoke. Повторная обязательная сборка после последней проверки типов записывается перед закрытием P3.
- Окончательная `_build.ps1` после ремонта перехода статусов: `20261015T104858Z_d9d64687`, exit0, candidate10.0.1357, version/embedded-prompt smoke. Промежуточная сборка10.0.1356 сохранена (`20261015T104416Z_1202d8cc`). Все runner logs без bytes_dropped/truncated. Архив: `experiments_history/2026-10-15_prompt-noop/`, manifest и точные source-pins.
- `20261015T104233Z_6d606fc3`: 5 pass / 4 RED в параллельном `plans/2026-10-15_hybrid-output-formatter.md` T1/T2 — это сохранённый RED baseline ещё не реализованного formatter. Его export/test изменения не входят в этот commit; чужие assertions и поведение не менялись. Общая чистота всех тестов репозитория не заявляется, push не выполняется.
- Робот `ses_ec7e051faffenMgqqhHX7wzrui`, Muse Spark1.3 Free, прочитал план и указал на блокирующий spawnSync. После этого sync переведён на async с timeout и штатным Shell.killTree; оба свойства проверены настоящим дочерним процессом. Его замечание о мягком frame wait закрыто прямым ожиданием и итоговым жёстким assert кадра.

Сохранены все промежуточные неудачи стенда: ожидание HTTP headers до release MCP; отсутствующий реестр Slot, который скрывал весь Prompt в fixture; регистр `.CMD` от Windows resolver; пропущенное error-событие spawn; расходуемая очередь TestLLMServer, из-за которой restart получил fallback `ok`. Ожидания поведения не ослаблялись.

Граница: настоящий stdio MCP и HTTP/Runner, локальный детерминированный provider, native Session с настоящим Slot/Prompt и сериализованным Bus. Живой LLM и настоящий SSE transport этим оракулом не квалифицированы. Системный prefix не менялся. `bin/` и живые данные XEComponents не изменялись.

## Manifest

P1: state=passed; eta_turns=0; oracle=хронология до compact и точка ожидания graph prebuild.
P2: state=passed; eta_turns=0; oracle=20261015T102303Z_2fdb7fb9, retained RED status=null.
P3: state=passed; eta_turns=0; oracle=20261015T104749Z_22dfd0be + 20261015T104743Z_d8198efe + 20261015T104858Z_d9d64687.

Архив: `experiments_history/2026-10-15_prompt-noop/`. Не выдавать stale compacting за причину без причинного оракула. Закрытие — scoped commit с именем этого плана; live install остаётся отдельным действием владельца.
