<!-- intention: паспорт организации сохранён отчётом, wiki содержит только Protocol -> организация получает заполненную связанную wiki и воспроизводимую отчётность с проверяемыми источниками -->
# Wiki и отчётность Agent Corporation

```yaml
Keywords: organization-wiki 0.40, reporting 0.35, safe-publication 0.25
Semantic dominant: Заполнить wiki организации и связать отчётность с заданиями, доказательствами и следующими проверками.
md5: 64d708f192ab43eca92785c16605c794
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Основание, границы и разрешение

Запрос владельца: «Да, давай и организуем отчетность и заполнение нашей вики».
Назначение организации задано владельцем: инструменты разработки, нефтегазовые системы и бухгалтерия для нефтегазовой отрасли.

✓ CONFIRMED (native init exit0; readonly SELECT): org.fossil существует; 15 DONE, READY/WORKING/BLOCKED отсутствуют; история88 записей; wiki содержит Protocol. Первый паспорт: задача ed412eadc4d22830774d954c9ce5ea8a0c374fa7, technote organization-passport-20261010, артефакт a462142faa3fbe27d6ba3c27bb9112041bc77222663c9ab023f36cca1c1ab92b. Его полнота была сверена с 39 адресами fossil all list и 12 логинами; свежесть будет проверена повторно перед публикацией.

✓ CONFIRMED (прочитанный scripts/org-genesis/org.py:387–395,456–461): wiki только читает. Для требуемой публикации нужна ограниченная именованная команда, а не прямое изменение БД. Protocol:35,64–69,107,111–115 задаёт роли объектов и правила доступа. tools/opencode_host.py проверяет nonce; старый host STALE, фактический opencode.exe отсутствует (Get-CimInstance).

ALLOW по запросу владельца: READ, PLAN_WRITE, MODIFY_PROJECT для именованного wiki gateway и его focused tests/Protocol; PROMOTE_STABLE только проверенных org.py и Protocol.md в C:/Users/Alexander/.org/genesis; EXTERNAL_EFFECT только локальная wiki/technotes/tickets под --user codex и передача резиденту. Видимый запуск собственного TUI через cmd_runner — существующая процедура robot/bridge и прямое ранее подтверждённое разрешение владельца; bin только запускается, не меняется.

Envelope: 36 шагов, 80 tool calls, 2 коррекции на проблему, depth1, 1800000 ms; одна реализационная делегация. Пути: данный план и конечный plans_completed/ либо plans/postponed/; experiments/2026-10-10_organization-wiki/; scripts/org-genesis/org.py и Protocol.md; отдельный focused test под scripts/org-genesis/; docs/README.md и новый docs/organization-reporting.md; _progress_log.md; C:/Users/Alexander/.org/genesis/{org.py,Protocol.md}. Нормальный scoped git commit без отключения hooks, включая штатный bun install hook и проверку его побочных изменений; посторонние изменения не включаются. Запуск _build.ps1 разрешён как обязательная кандидатная сборка после продуктовых изменений, только dist, никогда bin.

Не изменять kernel, auth, capabilities, runtime defaults, чужие worktree, чужие тикеты, bin; не создавать новый сервер поверх живого; не использовать headless вместо видимого резидента. Не объявлять доступность агента по логину. Исторический отчёт не доказывает готовность продукта.

## Задачи и конкретный оракул

- [x] W1 — резидент smit-opencode реализует wiki-put и focused tests. <!-- sv: named-write 0.45, concurrency 0.30, readback 0.25 -->
  Binding: scripts/org-genesis/org.py, Protocol.md, test_wiki_put.py; reuse fossil(argv,user), need_user, orgcfg. До изменения — codegraph impact и fixture baseline, в том числе отсутствие wiki-put. CLI: wiki-put PAGE --file UTF8.md --expect-sha256 HASH|absent --user LOGIN. Без raw SQL/command passthrough, без caller-named output path. Обязательное ожидаемое состояние; отдельный эксклюзивный per-page lock; новый create или обновление только при совпадении полного текста/hash; unchanged идемпотентен. Protocol защищён от этого verb (его публикует init). Ограниченные ошибки, освобождение lock; полный readback и digest; subprocess argv без shell. Выполнение --user не является доказательством полномочий: не расширять текущие права. Резидент не коммитит и не устанавливает runtime.
  Оракул: stdlib unittest на реальном изолированном Fossil без запуска служб; create/readback Unicode, update/readback, unchanged, stale expectation, existing/absent conflict, malformed name/option injection, malformed hash, отсутствующий user/file, неизвестный login и login без подходящего wiki capability, invalid UTF8, protected Protocol, lock contention/cleanup, nonzero Fossil. Предсказание: до реализации отсутствующее поведение FAIL; после — полный declared focused suite PASS, reject cases без изменения текущей wiki. Сам exit0 не покрывает readback.
- [x] W2 — административные страницы и шаблон подготовлены; публикация отдельно W3. <!-- sv: portfolio 0.35, reporting 0.40, source-routing 0.25 -->
  Пять новых страниц: Agent Corporation (вход/назначение), Projects (реестр/ссылка на проверенный паспорт), Participants (регистрации/границы), Reporting (порядок и шаблон), Knowledge (индекс и наполнение). Canonical ссылки ведут к tickets/technotes; wiki не дублирует живую очередь. Источники проектов — полный паспорт и повторный fossil all list, участники — текущий user без passwords. Не назначать неизвестные приоритеты, моделей, бюджеты и готовность.
- [ ] W3 — проверенная публикация и отчёт. <!-- sv: publication 0.40, oracle 0.40, closure 0.20 -->
  После независимого focused oracle установить только два явно разрешённых genesis файла и штатный init. Перед каждым эффектом перечитывать относящийся ticket и wiki. Опубликовать org.py wiki-put --user codex с expected=absent; повторно прочитать каждую через org.py wiki и сравнить полные UTF8 bytes/hash. Проверить все внутренние ссылки и полное равенство множеств адресов/логинов свежему снимку: исходный паспорт содержит39 адресов и12 логинов, но изменение любого множества требует обновления паспорта либо остановки его публикации. Проверить отсутствие секретов; опубликованный Protocol должен совпасть с принятой новой редакцией, а wiki-put не должен его менять; чужие ticket state неизменны. Закрепить technote report с доказательствами и честными остатками. DONE только после readback, результат исполнителя отдельно от заключения проверки.
- [ ] W4 — документация, запись границы и scoped commit. <!-- sv: documentation 0.45, traceability 0.35, scoped-commit 0.20 -->
  Дать адресуемый вход через docs/README.md; факты/правила отчётности — wiki, docs маршрутизирует. _progress_log.md одна запись. Проверка плана explore-agent после изменений. Терминал сохраняет точный остаток; завершённый план moves plans_completed и normal commit именует его. Посторонний dirty work сохраняется.

## Риски, откат, закрытие

Конкурентная wiki write: expected hash + lock, stale rejection. Ошибочное назначение/состояние: источник и дата обязательны, Unknown остаётся явно. Утечка: не читать/публиковать passwords/tokens/auth; перечень user ограничен login/cap. Продуктовый тест не выполняется в чужом worktree. Неполный тест/timeout = Unknown.

Откат gateway: сохранить hash/копию двух старых genesis файлов перед продвижением; только возвращение собственной установленной редакции. Wiki history не удалять; исправляющая редакция через verb со свежим expected hash. Тикеты/technotes не стирать. При недоступном резиденте сохранить адресуемую READY делегацию с binding, не угадывать session.

SUCCESS = пять полных readbacks, связность и источник каждой страницы, проверенный gateway, финальный организационный отчёт, clean scoped handoff; runtime/производственная готовность внешних проектов сюда не входят. Owner touches для routine procedures — 0; содержательное уточнение назначения было в предыдущем шаге, не повторяется.

## Граница W2 — 2026-10-10T00:59Z

✓ CONFIRMED (check_prepared.py exit0 PASS_PREPARED_ONLY): пять Markdown страниц, fence/SV/link checks и проверка явных секретных форматов прошли; полное множество39 адресов совпало с текущим fossil all list, все файлы существуют; множество12 user login совпало. Это проверка подготовленных текстов, не публикации wiki. Gateway baseline: отсутствующий wiki-put exit2 invalid choice. Остаток W1/W3: реализовать и независимо проверить verb, затем только publish/readback.

Административная задача88987e8be159d1eed34a6afa56cd306190cd30a7, parent/root ed412eadc4d22830774d954c9ce5ea8a0c374fa7; claim epoch1 codex lease1800. Live host поднят штатным видимым TUI run20261010T005403Z_a05c3c64, PID24192, nonce-validated URL127.0.0.1:4096; /session/status пуст, build_mode ACL inspected, funded model deepseek/deepseek-flash доступна в runtime catalog. Runner primitive run20261010T005248Z_7314ab8d finished exit0, полная строка fixture, bytes_dropped0/truncatedfalse. Ни auth, ни bin-файлы не менялись.

Explore проверка плана указала три дефекта, все исправлены: Protocol совпадает с новой принятой редакцией, а не старой; неизвестный login/недостаточные wiki права входят в reject oracle; свежие полные множества, а не числа старого снимка, определяют полноту. Дальнейшая передача W1 завершает turn согласно Protocol:45–46; --no-wake означает продолжение Codex на расписании, не фиктивный session id.

## Передача W1 и коррекция оракула — 2026-10-10T01:04Z

✓ CONFIRMED: native delegate создал81309f5cfa261327ee6481534c2493f9f756b9ca, parent88987e8be159d1eed34a6afa56cd306190cd30a7, rooted412eadc4d22830774d954c9ce5ea8a0c374fa7, smit-opencode, --no-wake. История и API показали native orgd wake в старую объявленную org-smoke-inbox: assistant stop/OK без tools, task READY, без lease. Это отказ квалификации исполнителя, не выполнение задания. Повторного wake не было: после проверки истории ровно одна корректирующая передача в новую сессию того же host, ses_edca9911dffeBAbBbXPrAV1bNN, agent build_mode, explicit deepseek/deepseek-flash, полный brief. dispatch.py подтвердил PROMPT_ACCEPTED; это приём передачи, не PASS реализации. Следующее чтение — ticket/report и фактический оракул, непрерывный polling не ведётся.

✓ CONFIRMED: первичный technote org-wiki-prepared-20261010T0059 artifact754a8ddbfa6b1f2c705bb24173f1f712cd4ba46d6171469fce2df9a23c002e40 прочитан полностью и совпал6112bytes SHA25650ff4dd685c94a6fbc71954c39dd1895ec402023ca18f321c783411bf713dbb5.

✗ REFUTED: исходный checker состава Participants допускал подстроковое совпадение codex-worker вместо codex и лишний login. Explore validation выявил TEST defect; исправлен точным извлечением множества из таблицы/служебного списка. Полный check_prepared rerun exit0; held-out mutants missing codex/invented-login отличены. Состав страницы теперь сравнивается точным множеством. Пять текстов/hash прежние; запись прежнего оракула сама не считается доказательством исправленного предиката. Причины/строки сохранены experiments/2026-10-10_organization-wiki/contradictions.md.
