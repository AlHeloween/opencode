<!-- intention: решения о корпорации рассеяны по Protocol, исследованиям и диалогу Клода -> организация получает связный устав с проверяемым происхождением, продвижением по результатам и обязанностью самостоятельного запуска -->
# Устав Agent Corporation

```yaml
Keywords: charter 0.35, career-promotion 0.25, continuity 0.20, self-bootstrap 0.20
Semantic dominant: Свести принятые решения о корпорации в устав без выдачи планируемых механизмов за действующие.
md5: 6d142ef837c84975ab96240dcb50981e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Основание и границы

Пользователь прямо поручил прочитать сделанное Клодом и составить устав: карьерное продвижение, первый обнаруживший поднимает организацию, непрерывная память, делегация другим роботам. Это административная документация, не установка kernel и не выдача новых runtime прав.

✓ CONFIRMED (прочитанные первичные сообщения): C:/Users/Alexander/.claude/projects/D--zPython-opencode/15656b89-7031-47ea-b856-0a05df281478.jsonl:10218–10295 содержит разделение управления/исполнения, отбор/обучение/продвижение и session-per-lane. Proposal docs/proposals/2026-10-08_claude-agent-continuity.md:73–96 описывает организацию памяти. Protocol:111–113 устанавливает самостоятельный init. Исследование research/fossil_deep_research.md:255–266 разделяет графы поручений и полномочий, :1336–1385 — память и иерархию. Эти источники подтверждают происхождение требований, не работоспособность всех механизмов.

✓ CONFIRMED (чтение queue.md:4–7,26): t15 fencing и t19/t20 остаются в очереди; их выполнение нельзя объявлять по prose или должности. Текущие native verbs прочитаны через CodeGraph; Markdown не индексируется. До изменения docs/README.md его существующий вход прочитан. Изменение только добавляет вход, продуктовых потребителей нет.

## ALLOW / envelope

Классы PLAN_WRITE, MODIFY_PROJECT (Markdown docs/index и обычный scoped commit), MODIFY_CANDIDATE (проверочные файлы experiments и обязательная сборка dist), EXTERNAL_EFFECT (только собственный организационный ticket/technote через org.py --user codex). Пути: этот план; docs/organization-charter.md; docs/README.md; docs/organization-reporting.md; _progress_log.md; experiments/2026-10-10_organization-charter/; завершённый план plans_completed/; dist и обычные dependency/cache эффекты штатного hook и _build.ps1. Инструменты: apply_patch, read-only Python/Fossil/host, native org.py delegate/claim/report/done, git add/commit без bypass, штатный pre-commit (bun install) и _build.ps1 через cmd_runner. Бюджеты: 24 шага, 45 вызовов, 2 коррекции на проблему, depth1, 1200000ms. Без изменения kernel/bin/ACL, запуска второго host, вмешательства в W1 worker или кадрового назначения. Административное поручение самому codex регистрирует эту работу, а не новую делегацию исполнителю.

## Binding / smoke до изменения

- [x] C1: docs/organization-charter.md — устав, источники и таблица действующее/планируемое. SV charter .35, promotion .25, continuity .20, bootstrap .20. Oracle: полный readback UTF8, статьи с происхождением, актуальные зависимости t15/t19/t20, отсутствие ложного утверждения о реализации и новых числовых карьерных порогов; все relative links существуют. Baseline: файл отсутствует; ожидаемый post: существует, predicates PASS.
- [x] C2: docs/README.md и organization-reporting.md — вход к уставу; существующие назначения/портфель не переписывать. Oracle: обе ссылки разрешаются, wiki mirror не объявляется опубликованным, чужие исходники не изменены этим task.
- [x] C3: собственный ticket/technote — полный устав и readback результата по адресу artifact; независимое чтение источников и отдельный verification.md. Full W-payload corrected artifact полностью равен исходным bytes, ticket lineage/current owner совпадают перед report. Native lifecycle без VERIFIED/REJECTED: проверочный technote публикуется на последней границе с фактическим commit, состояния не выдумываются.
- [x] C4: read-only explore review; штатная кандидатная сборка прошла, план moves plans_completed. Завершающий normal scoped commit, именующий этот план, атомарно сохраняет закрытые пункты; ticket DONE выполняется только после проверки фактического git результата и полного readback verification report. Если commit не проходит, закрытие отменяется. Wiki publication остаётся задачей W3. Посторонние staged/dirty hunks не захватываются.

## Риски и откат

Главный риск — выдать будущее t19/t20 за установленное: явно разделить норму/состояние. Второй — карьерой расширить права: повышение не выдаёт capability, установка/ACL требуют своей авторизации. Противоречия источников — журнал файл:строка:объяснение в experiments, не обход правила. Откат своих новых docs/входов по точному patch; историю Fossil не удалять. Установка wiki gateway не входит в этот административный шаг; W1/W3 имеют отдельный принятый план. Незавершённые чужие и собственные предыдущие изменения сохраняются.

## Проверка revision2

✓ CONFIRMED (read-only explore reviewer): документ сохраняет разделение нормы/состояния и источники, ссылки разрешаются. ✗ REFUTED: исходное исключение commit противоречило AGENTS:98,681–683. Envelope и C4 исправлены на обычный scoped commit с его штатным hook; обход hook запрещён. Это необходимая стадия уже порученного оформления устава, не отдельное кадровое назначение.

## Наблюдаемая граница C1/C2

✓ CONFIRMED (полный UTF8 readback и source review): 9 статей, 148 строк, 29075bytes, SHA256 fce0de9264522404b57dd5bb5ee929e673a99f2fc0ceffc91fdffbc1cd46264d; относительные ссылки, SV/fences и ограничения публикации прошли. Read-only explore нашёл только отсутствовавший commit; документальных новых дефектов не указал.

✓ CONFIRMED (native org.py --user codex, затем fossil artifact full W-payload): task1fcfd2aa87e630b20c194feb6d696af825011b5a, parent/root ed412eadc4d22830774d954c9ce5ea8a0c374fa7, lease codex epoch1. Technote organization-charter-v1-20261010, artifact39a857752e88f71bf5247cb94d952f4a9ff9a4736aa3ed1fa416ed83eafaf040 полностью равен исходнику. Это проверка сохранения устава, не runtime-promotions и не wiki publication.

✓ CONFIRMED (раздельные CIM/listener массивы, два state чтения): один orgd PID22972, listeners loopback IPv4/IPv6 одного FossilPID22660, tick240→257 через255s, чтение ticket/history успешно. Счётчик рабочего состояния — agent_state; стандартный Fossil status=Open не классифицирует нашу очередь.

Обязательная процедура _build.ps1 и _build_rust.ps1 прочитана полностью. _build.ps1 -Task build запущен через квалифицированный cmd_runner run20261010T011807Z_ca61856d; полного suite нет (он был бы в -Task check). Разрешённые generated/cache эффекты процедуры включают packages/opencode/dist, packages/wasm/**/pkg и packages/opentui/packages/core/dist, dist и .temp/test; цели recursive cleanup проверены внутри абсолютного workspace. Вывод о build ещё pending, kernel install не запускался.

## Закрывающая проверка

✓ CONFIRMED: после исправления wiki-link контракта исправленная редакция29612bytes SHA2562ae9e9a3bda38b0988002147fddec6ec37ffd0da742d0f6d61ab840642497a0d полностью совпадает с technote organization-charter-v1-corrected-20261010, artifact0ff4df72fb5e1c1eeaee73e53dae57f70844aa1ded3cecee39552b85678d34aa. Второй read-only review подтвердил исправление commit и выявил link-context дефект; приложениеБ исправлено.

✗ REFUTED: raw start не имел живого PID/capture; следующий PowerShell5.1 run не прочитал UTF8 script. Это два разных инструментальных дефекта, не продуктовые PASS. Полная квалификация ConPTY fixture и pwsh7 ParseFile завершилась PASS. Обязательная сборка _build.ps1 -Task build run20261010T012140Z_b313ce3e: finished/exit0, bytes_written51444, bytes_dropped0, truncatedfalse; прочитан весь stdout50474bytes/666lines. Build complete, native/DLL/WASM copied в dist; historical Rust warning syn0.11.11 сохранён. Bin и kernel install не затронуты. Ни полный suite, ни production acceptance этим запуском не утверждаются.

Scoped commit ограничен уставом, двумя навигационными docs, этим завершённым планом и только новой записью progress. Посторонняя правка README про Fossil SV, source memory/snapshot, W1 org.py/Protocol/tests и другие untracked файлы остаются за его пределами. Нативный hook разрешён и не обходится. Фактический commit/address и проверка его состава закрепляются отдельным завершающим technote, поскольку commit не может содержать собственный hash.

Документальный контракт закрыт; wiki Charter и W1/W3, t15/t19/t20 и raw-runner countermeasure остаются адресуемыми задачами, не притворным runtime SUCCESS корпорации. Owner touches выполнения0 дополнительных запросов.
