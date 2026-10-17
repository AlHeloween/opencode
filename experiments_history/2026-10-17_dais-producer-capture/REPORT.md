<!-- sv: producer-capture 0.40, fossil-provenance 0.25, falsification 0.20, schema-compatibility 0.15 -->
# DAIS: native producer → Fossil → доказательный граф

## Проверенный срез

CONFIRMED ✓ независимый native CLI oracle, запущенный прямо из этого архива:
20261017T055638Z_6cfebbbf, 28 predicates PASS на малом offline Go-корпусе.
Предыдущий 27-predicate run 20261017T055327Z_796666dd сохранён. Реальный scip-go запускается
из `dais-capture.exe` над bytes конкретной Fossil revision A, создаёт immutable
bundle, публикация в отдельной fixture revision B добавляет ровно три артефакта.
Graph import/verify/export использует B и явный modern profile. Исходные bytes
Fossil не меняются при capture; имя SV берётся из B. Golden oracle независимо
декодирует Protobuf, проверяет definition/reference и byte range после emoji.

Квитанция исполнения имеет source revision, input hashes/digest, actual binary
SHA256, раскрытый argv, явный env, stdout/stderr, exit и CAPTURED/FAILED.
CAPTURED не является semantic PASS. Manifest включает source inputs + receipt;
receipt не включает manifest/self hash — циклического digest нет.

CONFIRMED ✓ parent regression 20261017T055220Z_130d2c50: семь focused Go
packages PASS, весь legacy suite сохранён. Process/collision/byte-limit/source-
mutation/invalid-output controls дают отказ без публикации. Общий deadline
охватывает materialization, execution и publication; expired context не публикует.
CONFIRMED ✓ обязательный _build.ps1 -Task build, 20261017T055327Z_fee29dd1:
exit0, candidate dist, version smoke10.0.1419, lock released. Полный лог прочитан;
диагностики сохранены в build-review.txt и исходном runs/*-stdout_text.log.
Предупреждения: Rust syn future compatibility, WASM package metadata и Vite chunks.
Это успешная сборка shared-tree candidate, не установка и не проверка всего
параллельно изменяющегося OpenCode. Никакой bin/ promotion не выполнялся.

## Совместимость и удержанные отказы

- Официальный scip-go v0.2.7 получен Go module toolchain, native build
  20261017T053934Z_c4f6469f и execution 20261017T054016Z_8d942cee exit0.
  Legacy importer отверг новые поля: 20261017T054043Z_ce2fdf00.
- Schema v0.7.1 извлечена standalone Go pipeline из официального binding.
  Private descriptor SHA256 c28e78f05204f5886357dedba01a2f5cf007b3587314bb6e60728a6dc6a0d758;
  повтор 20261017T054722Z_1bfd6d5f дал идентичные bytes. Legacy registry не меняется.
- Официальный producer не объявляет Document.position_encoding. Его исходный
  index сохранён как negative fixture и остаётся отвергнутым. Source byte-column
  mechanism прочитан в symbols/symbols.go:33–37; visitor_file.go:359–364 не задаёт
  encoding. Candidate patch добавляет explicit UTF8 ПРИ создании Document.
  Созданные индексы не перекодируются и не исправляются после запуска.
- Windows producer публикует `file://D:%5C...`; modern profile принимает этот
  наблюдаемый drive-absolute metadata dialect. Для разрешения source paths он
  не используется; raw metadata сохраняется. Unknown fields/enums/roles,
  unspecified/UTF16/UTF32, invalid UTF8/ranges/text mismatch по-прежнему refusal.
- Go1.26 отверг overlay внутри GOMODCACHE: 20261017T054803Z_936f45a1. Pipeline
  теперь проверяет полный source tree (129 files, 399003 bytes), копирует его в
  собственный bounded scratch и применяет reviewed patch там. Source tree hash:
  9e9780c217cb827727ca876e4e8c137109f7f900fad86538d4115f8aaf159ed8.
  Неполный source tree отвергнут ДО staging/build: 20261017T055244Z_5a6b3a6f.
- В первом parent package diagnostic не был задан DAIS_TEST_FOSSIL; это HARNESS,
  не product regression. Полный повтор с explicit native path прошёл.
- Первый external graph oracle (producer-first-report.json) остановился после
  18 checks: HARNESS угадал неверный домен hash identity. Предикат заменён на
  независимую проверку raw symbol → стабильная identity, совпадение definition/
  reference и различение разных global symbols. Product code под этот FAIL не
  менялся. Исходный FAIL и его stdout/state сохранены, green не переписал историю.

## Граница доказательства

Проверено исполнение над заявленным workspace и captured configuration.
Producer network module resolution выключен; fixture не имеет внешних packages.
GOROOT/Go binary закреплены в отчёте, но полнота фактических внешних чтений не
измерена. Это не filesystem sandbox; descendants не контролируются общей Job
Object, timeout отменяет direct child. Успешная publication после deadline
запрещена, общая semantic correctness producer остаётся unknown.

Graph verifier проверяет projection/ranges/declared inputs. Он не удостоверяет
автора произвольного capture JSON и не выдаёт подпись доверенного исполнителя.
Перемена receipt bytes даёт STALE как изменение bound input; failed import
сохраняет прежний current. Совпадение golden references относится к данному
малому Go-корпусу, не ко всем программам, Delphi/1С или 5M entities.

Capture создаёт candidate bundle и не делает commit в live Fossil. Публикация B
выполнена только disposable oracle fixture. Reserved output paths должны быть
новыми: повторный capture опубликованной ревизии требует следующего контракта.
SCs engine compatibility, service installation, MCP/impact, corpus parity,
performance и CodeGraph cutover остаются открыты в родительском плане.

## Воспроизведение

Сборка CLI и producer: packages/dais-code-intelligence/README.md и
compat/scip-go/README.md. Квалифицированный pinned producer создаётся
scripts/build-scip-go.ps1 из официального module v0.2.7. Его source copy меняется
только reviewed patch; original cache/external остаются неизменными.

Из repo root через cmd_runner выполнить сохранённый `producer_oracle.py`:
`python <archive>/producer_oracle.py --root <absolute repo> --goroot <native GOROOT>
--producer <qualified native executable> --report <caller-owned report.json>`.
Оракул берёт `native-fixture/` рядом со своим файлом и создаёт новые disposable
Fossil/scratch/cache directories в experiments/. Он не импортирует DAIS Go-код.
Go test выполняется из module directory с explicit DAIS_TEST_FOSSIL; список семи
packages находится в README. Полный suite без path не запускался.

MANIFEST.json закрепляет exact byte SHA256 source и archive artifacts. Нормализация
EOL отключена `.gitattributes`. После commit pins сверяются с Git blobs, а не
только с dirty working tree. Оригинальные failed runs сохраняются в runs/.

## Фиксация в общем рабочем дереве

CONFIRMED ✓ read-only review обнаружил в существующем commit_own.py замену
целого shared-index entry: она могла стереть уже staged чужие hunks одного файла.
Этот helper для фиксации среза не используется. Native Git private-index route
квалифицирован отдельно: pre-commit hook → write-tree → commit-tree → CAS
update-ref, затем guarded atomic index
replacement; чужие entries сохраняются из исходного index, а progress получает
только собственную вставку. Проверяется точное сохранение чужого staged delta и
неизменность worktree bytes. Исправление общего helper остаётся отдельной задачей.
Первый diagnostic 20261017T060136Z_d61debb5 отверг неверное ожидание суммарного
numstat (blank lines сократились в diff); checks/apply прошли. Решающий предикат
заменён на точные bytes вставки и сохранение foreign delta, а не суммы строк.
