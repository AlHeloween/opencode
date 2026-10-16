# Сверка с официальным Haiku 5.5 migration guide

```yaml
Keywords: signed-replay 0.45, migration-contract 0.30, prefix-stability 0.15, causal-boundary 0.10
Semantic dominant: Установить несоответствие replay контракту без объявления доказанной причины задержки.
md5: 0cf583e9b7164ad2a0386cb47f192e65
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 81e70d3af5c64b8292d15e6f370a49bc
```

✓ Источники прочитаны 2026-10-16: [migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide), Configure thinking / Keep earlier turns unchanged; [preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking), Keeping the prefix unchanged / Output-token cost. Authority/content hashes и исходные capture locators — `migration-audit.json`. Это дополнительная сверка, исходные результаты матрицы не изменены.

| Требование | Наблюдение и граница |
|---|---|
| Adaptive и effort вместо enabled/budget | ✓ В четырёх прочитанных OpenCode captures adaptive/max; sampling parameters отсутствуют, последний role=user. Это проверка этих полей, не всего protocol loop. |
| Пустой thinking с signature штатен; блок возвращается неизменённым | ✓ Руководство описывает именно этот default. Current CodeGraph source `provider/transform.ts:88–90` удаляет reasoning при пустом text независимо от metadata. Прежний differential fixture и последующие captures показывают потерю replay. Это несоответствие сохранения истории; влияние на latency остаётся UNKNOWN. |
| Не менять system/tools/предшествующие messages | ✓ Повторно прочитаны четыре исходных captures и три соседние пары: system/tools неизменны; общие messages совпадают после удаления cache_control. Сами cache_control markers официально исключены из prefix binding. По этим парам изменение semantic prefix не обнаружено. Это не проверка всей сессии/compaction или сохранения исходного provider response. |
| Не полагаться на HTTP200 как на сохранение reasoning | ✓ Документация допускает silent drop для другого account/model; prefix enforcement также зависит от account/настроек. Отсутствие400 не покрывает критерий replay. Owner auth parity остаётся открытой. |

Inferred, authority: Anthropic объясняет рост повторной генерации после потери reasoning; приведённые benchmark numbers относятся к их harness, не к нашему. Переносить их процент на наши143s нельзя. Отсутствие `display: summarized` само по себе разрешено и не является protocol defect.

Следующий continuation oracle: свежая история с действительными исходными подписями, один account/model, стабильный prefix, сохранённый полный response; сравнить сохранение/потерю reasoning и usage/latency. Не вставлять старые подписи в уже продолженную без них историю. Отдельно наблюдать `input_transformations` при соответствующем beta header. Первый запрос без reasoning в истории не проверяет этот механизм.

Остаток: latency attribution, whole tool loop и source repair не выполнены. Новых inference calls и product edits в этой сверке нет. План ACTIVE; сравнение system×tools остаётся отдельным первым-шаговым экспериментом.
