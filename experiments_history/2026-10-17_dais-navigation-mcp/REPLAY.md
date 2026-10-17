<!-- sv: replay 0.45, independent-oracle 0.35, immutable-evidence 0.20 -->
# Повтор проверки

1. Собрать native candidates процедурами module README: dais-ci, dais-graph,
   dais-capture, dais-mcp. Использовать scripts/go.ps1 (Windows Zoekt overlay,
   VCS stamping отключён). Нужны закреплённые external sources и Go1.26.5.
2. Собрать scip-go candidate через scripts/build-scip-go.ps1 из загруженного
   scip-go v0.2.7 в новые scratch/destination. Source tree и patch сверяет factory.
3. В новом writable experiment directory собрать `typed-golden.go` direct
   Go1.26.5: `build -buildvcs=false -o <new.exe> <archived-source.go>`.
   Квалификация fixture описана в typed-golden-qualification.md; для неё копировать
   qualification/, qualifier и executable в новую writable рабочую директорию.
4. Выполнить из этого архива `prepare_index.py` с явными `--root`, `--goroot`,
   `--modcache`, `--producer`, `--work-root` (существующий writable каталог),
   `--report` (новый файл). Сценарий читает archived corpus-source/, проверяет
   его manifest и создаёт disposable Fossil, реальный capture, graph и Zoekt.
5. Запустить compiler instrument с `--module-root <archive>/corpus-source`,
   `--go <direct-native-go.exe>`, `--output <new-golden.json>`.
6. `score_corpus.py --preparation <new-preparation.json> --golden <new-golden.json>
   --codegraph <archive>/codegraph-subset.json --report <new-score.json>`.
   Ожидаются 21 predicate, 33 definitions, 67 references, без missing/extra.
7. Собрать официальный SDK hello из pinned module v1.8.0:
   `go -C <sdk-module> build -mod=readonly -buildvcs=false -o <new-hello.exe>
   ./examples/server/hello`. Первичный pin — external-pins.json.
8. С `PYTHONDONTWRITEBYTECODE=1` запустить `mcp_oracle.py qualify --hello
   <hello.exe> --output-dir <new-directory>`. Это отдельный fixture для raw
   JSON-RPC клиента: initialize/list/Unicode call/unknown tool/EOF.
9. `mcp_oracle.py production --preparation <new-preparation.json> --golden
   <new-golden.json> --source-root <archive>/corpus-source --binary <dais-mcp.exe>
   --fossil <native-fossil.exe> --output-dir <new-directory>`.
   Oracle создаёт собственные копии derived индекса, запускает два fresh MCP
   processes, сравнивает 33 definition queries, 33 reference lists и 67 reverse
   definition queries в каждом. Дополнительно проверяет text addresses по
   исходным byte-lines, provenance, limits, errors, oversized frame и EOF.

Все длинные Windows-запуски выполняются через cmd_runner. Читать полный
state.json/stdout_text.log после завершения, проверять exit, dropped и truncated.
Исходные FAIL/INCOMPLETE не перезаписывать. Отчёты содержат исторические absolute
paths; новый запуск создаёт собственные адреса и revisions. Hashes исходников,
compiler definition/reference arrays и результаты predicates должны совпадать;
Fossil UUID, SCIP project_root, snapshot/generation/receipt IDs могут отличаться.

В архив не включены executable, Fossil repositories, конфигурация Fossil и derived
runtime SQLite. Они воспроизводятся процедурами выше. Полная квалификация toolchain
внешних чтений producer и его descendants остаётся отдельной границей.
