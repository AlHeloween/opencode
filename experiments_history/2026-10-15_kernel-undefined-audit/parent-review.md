# Проверка аудита неопределённых контрактов

Ревизия исследования: `d982f9cd91`, после восстановления награды и до B1.
✓ Parent readback:9/9 SHA256 pinned canonical snapshots совпадают;
строки, указанные ниже, прочитаны независимо. Read-only native reviewer проверил
каждую из14robot candidate rows и8rejected controls. Их вывод не принят за verdict.

✓ Robot bridge:session `ses_ec420d3f5ffeVbhz9wZCXv4l4f`,
`opencode/muse-spark-1.3-contributor-free`, explorer_agent. Первый проход:
idle+finishstop+completed,12assistant rows,0tool errors. Follow-up в той же
сессии завершён:15assistant rows,0tool errors. Источник сообщений — API.
Новых product edits робот не выполнял. Первые14, затем13 кандидатов не
являются подтверждённым числом дефектов.

## Статический результат в зафиксированном scope

| Класс | Подтверждённые строки норм | Разные лексемы |
|---|---:|---:|
| Локальная мера без границы | 3 | 3 |
| Недоопределённый термин | 5 | 1 |
| Действие без найденного предиката | 0 | 0 |
| Union | 8 | 4 |

Это счёт **нормативных мест**, а не число всех дефектов репозитория.
Копия одной нормы в другом addon не добавляет строку union.

| id | Canonical address на pinned ревизии | Пробел |
|---|---|---|
| M4 | source.py:523 MANHATTAN_L1 | `keep each zone small`: локальная граница размера зоны отсутствует; общий бюджет и минимум5кандидатов отвечают другим вопросам |
| M5 | source.py:726 SEMANTIC_CONTROL | `enough Exact medoids`: достаточность именно Exact-базы для retune не определена; MEDOID_SIMPLEX задаёт другую достаточность |
| M7 | addons_codex.py:166, copy addons_cursor.py:125 | `short fact pipelines`: локальная граница short отсутствует; придуманный роботом порог1stage отклонён |
| T0 | source.py:87 CURRENT_SV | `nothing material` |
| T1 | source.py:562 MASTER_PLAN_RULE | `material premise/scope change` |
| T2 | source.py:589 WRITE_SCOPE | `Material mutation/...` |
| T3 | source.py:669 PREDICATE_POWER | `material alternatives` |
| T4 | source.py:1111 G9→G1 edge | `material residual evidence gap` |

Пять последних мест используют одну лексему `material`; явного определения
в terms/state/rules прочитанного canonical bundle не найдено. Robot пропустил
два употребления. Их добавление даёт8строк, но не8терминов.

## Отклонённые и непокрытые кандидаты

✓ M2/general уже задаёт never-pad и сравнительный запрет verbose answer,
когда есть concise answer. A1/explore маршрутизирует not-found через
CAPABILITY_GRAPH_RULE/GROUND_PLAN_RULE, index freshness и лестницу инструментов.
M6/minimize — оптимизационное направление по токенам, отдельно от sentence cap.
M8a/b/c/smallest допускает контрпример меньшего допустимого объекта с тем же
oracle; отсутствие нового числового потолка само по себе не дефект.
M1/copilot имеет соседние качественные ограничения no-repetition/no-filler;
слово short отдельно не доказывает отсутствие критерия во всём контракте.

На первоначальных14строках:6подтверждено,7false positives,1Unknown. Расширение
только подтверждённого material sweep добавляет2строки. R1–R8 отвергнуты
правильно: READY, independence, pins, SUPPORTED, inventory, residual schema,
finite budgets и существующие numeric response caps имеют определения.
Это наличие определений, не проверка качества live enforcement.

Unknown M3/title: title.txt:4-5 ссылается на CONTRACTS/PACKS[agent.title_agent].
Parent CodeGraph query вернул нерелевантный pack; qualified source sweep
`\bCONTRACTS\s*(=|:)|\bPACKS\s*(=|:)|\bagent\.title_agent\b`
по prompt_kernel/packages-opencode-src/tools/scripts(py/ts/txt) нашёл
только title.txt:4,5,8, declarations в этом scope не найдены. Positive control
REWARD_FUNCTION:source.py115 подтверждает чтение canonical file. Это gap
в ссылках, а не доказательство отсутствия declarations во всех внешних owners.
Agent imports/assignments привязаны к agent.ts12/13/17 и326/359/494.

Критерий владельца: «Сжимай представление, а не доказательства»; сохранять
intention→decision→hypothesis/refutation→oracle→unfinished task links,
наблюдаемое отдельно от предполагаемого, planned отдельно от executed.
Числовая длина не обязательна, если граница содержания уже проверяема.
Критерий не удаляется потому, что его сейчас никто автоматически не вычисляет.

Boundary: результаты статические на pinned revision; B1 может менять строки.
Falsifier: найденное действующее определение соответствующей меры/термина
или новая source revision. Report не устанавливает новых норм и не обещает
полный мировой census неизвестных понятий. Title reference остаётся named gap.

```yaml
Keywords: contract-boundaries 0.45, refutation 0.30, source-pins 0.25
Semantic dominant: Разделён проверенный подсчёт мест норм, отвергнутые находки и непокрытая ссылка title contract.
md5: 1c4a1b747aa941049efcebc6e42cc9c3
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 21a66067b9824dab91f15b37970ac653
```
