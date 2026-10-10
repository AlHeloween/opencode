# Отчётность и wiki Agent Corporation

```yaml
Keywords: organization-reporting 0.50, canonical-routing 0.30, evidence 0.20
Semantic dominant: Документ маршрутизирует к организационной wiki и её адресуемым источникам, сохраняя задачи в тикетах.
md5: 3af7521c9d2344f4b345dabe0f293763
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 64d708f192ab43eca92785c16605c794
```

Организация определяется ORG_HOME; на этом узле default — C:/Users/Alexander/.org. Репозиторий org.fossil содержит задачи, отчёты и базу знаний. Полномочия и доступность проверяются в текущем runtime.

## Канонические входы

Веб-интерфейс на этом узле: [Fossil](http://127.0.0.1:8079/).

| Wiki page | Назначение |
|---|---|
| Agent Corporation | Паспорт и навигация |
| Projects | Направления и ссылка на полный датированный реестр |
| Participants | Участники и границы ответственности |
| Reporting | Порядок и шаблон отчёта |
| Knowledge | Индекс знаний и правила наполнения |
| Protocol | Инструкция взаимодействия и штатных процедур |
| Charter | Устав: роли, карьерное продвижение, непрерывная память и самостоятельный запуск |

Именованный wiki gateway (`org.py wiki-put`) реализован и проверен: focused suite 15/15 PASS (scripts/org-genesis/test_wiki_put.py, изолированный Fossil fixture). Пять страниц и [Charter](http://127.0.0.1:8079/wiki?name=Charter) опубликованы; полные readbacks сверены с подготовленными UTF8 текстами. Живой ход организационной задачи: 88987e8be159d1eed34a6afa56cd306190cd30a7.

[Устав корпорации](organization-charter.md): commit99d45ea, source SHA2562ae9e9a3bda38b0988002147fddec6ec37ffd0da742d0f6d61ab840642497a0d. Публикация адаптирует только ссылки; её SHA256e23a76a9609ad267b641c329903291bfaf65bd7193691861938f7b77b5277752, [артефакт wiki](http://127.0.0.1:8079/artifact/d044c62c51d64d39e28b7ed04392e1b368534297bd0995daa1b0e3411c79a66f). Полный readback совпал; отчёт источников сохранён отдельно.

Свежий [реестр41 адреса/12 логинов](http://127.0.0.1:8079/artifact/f203e60434ddfea5764da9ca00d5fbceb59a5483cd00a94915a8f7904859f1ac) сохраняет исходный39-адресный паспорт и учитывает два дополнительных runtime snapshots OpenCode. Это адреса репозиториев, не число готовых продуктов.

Первичный паспорт уже записан: technote organization-passport-20261010; artifact a462142faa3fbe27d6ba3c27bb9112041bc77222663c9ab023f36cca1c1ab92b. Этот документ не дублирует его реестр и не хранит состояние очереди.

Чтение: `python <ORG_HOME>/genesis/org.py wiki <page>`, `protocol`, `inbox --user codex --json --no-presence`. Перед организационной работой выполнить штатный init.py. Все организационные изменения — соответствующим именованным verb под собственным логином; никакой прямой записи SQLite или fossil sql.

Реализация и оракулы: [завершённый план](../plans_completed/2026-10-10_organization-wiki-and-reporting.md). Источник живого статуса — ticket, постоянных правил — wiki, результата — technote; журнал проекта сохраняет только границу выполненного шага.
