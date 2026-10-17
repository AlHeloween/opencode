<!-- sv: native-runtime 0.35, evidence-graph 0.35, fossil-provenance 0.30 -->
# DAIS code intelligence

Нативный Go module: Fossil provider, Zoekt text search, версионный SCIP assertion
graph и исполняемая проверка его происхождения. Архитектура и границы доказательства:
[документация](../../docs/dais-evidence-graph.md).

## Сборка

Требуются Go launcher с поддержкой toolchain из go.mod, native Fossil и два
закреплённых checkout в `external/zoekt` и `external/scip`. WSL не используется.
Сторонние checkout остаются неизменными. Windows Zoekt получает проверяемый
build overlay из `compat/zoekt/`; generated SCIP binding переносится byte-for-byte
скриптом `scripts/vendor-scip.ps1`, вместе с лицензией и SHA256 readback.

Из каталога модуля через cmd_runner:

```powershell
pwsh -NoProfile -File scripts/go.ps1 -Action build -Packages ./cmd/dais-graph -OutputName dais-graph.exe
pwsh -NoProfile -File scripts/go.ps1 -Action build -Packages ./cmd/dais-ci -OutputName dais-ci.exe
pwsh -NoProfile -File scripts/go.ps1 -Action build -Packages ./cmd/dais-capture -OutputName dais-capture.exe
```

Результаты находятся в module `dist/`. Установку сервисов и promotion эти команды
не выполняют. Full/delta shards сохраняются; retirement старых и неудачных
поколений требует отдельной квалифицированной процедуры с учётом Windows mmap.

## Graph CLI

`import`, `status`, `facts`, `verify`, `export-scs`, `export-scip` принимают
`--index-root` (absolute directory) и `--repository-id`.
Каждая команда чтения facts/export/verify требует явный `--snapshot`.

Для import дополнительно нужны `--repository`, `--fossil`, `--fossil-home`,
`--ref` (full check-in hash), `--scip` и `--manifest` (tracked relative paths).
Manifest версии1:

```json
{"version":1,"index_sha256":"<64 lowercase hex>","inputs":[{"path":"src/main.go","sha256":"<64 lowercase hex>"}]}
```

Inputs должны покрывать весь tracked workspace, кроме самого SCIP и manifest.
Хэши вычисляются по bytes; manifest revision внутрь себя не включает.
Provider читает закреплённую ревизию, а не грязный checkout.

`verify` принимает source параметры и `--target-revision` (full hash).
PASS возвращает JSON receipt и exit0; FAIL/STALE возвращают сохранённую receipt
и ненулевой exit. Facts page сообщает total/returned/truncated.
Export SCIP пишет binary stdout; Export SCs — text stdout.

Пределы заданы флагами `--max-index-bytes`, `--max-manifest-bytes`,
`--max-source-bytes` (aggregate workspace bytes), `--max-facts`, `--limit`, `--timeout`.
Профиль UTF8 задан явно; несовместимый вход отклоняется целиком.

## Native producer и capture

`dais-capture.exe` читает полный `--ref` из Fossil, создаёт отдельный workspace,
запускает pinned `--indexer` и публикует новый immutable bundle. Обязательны
`--indexer-sha256`, absolute `--bundle`/`--scratch` и source-флаги Fossil из Graph
CLI. Аргументы индексатора задаются повторяемым `--arg`; ровно один `{index}`
заменяется на output path. Окружение передаётся только повторяемым `--env=KEY=VALUE`.
На Windows требуется явный SystemRoot. Ambient env и его секреты не наследуются.

В bundle ровно три файла: `ci/index.scip`, `ci/capture.json`, `ci/inputs.json`;
пути меняются флагами `--scip`/`--receipt`/`--manifest`. По умолчанию все три должны
отсутствовать в source revision. Квитанция хранит source revision, sorted input hashes, hash
реального executable, раскрытый argv, env и результат `CAPTURED` либо `FAILED`.
Digest входов: SHA256 UTF8 `json.Marshal(sorted []Input)`, без graph-домена digest.
Manifest добавляет хеш квитанции, сама квитанция manifest/self hash не содержит.
Квитанция `FAILED` также возвращается JSON stdout при ненулевом exit, good bundle
не создаётся. Публикация не заменяет уже существующий каталог назначения.

Для повторной индексации задаются отдельные полные hashes:
`--ref <changed-source-C> --previous-bundle-ref <previous-publication-B>`.
Три tracked outputs в C должны побайтно совпадать с B; receipt, manifest и raw
SCIP в B должны быть структурно согласованы. Только эти три paths исключаются
из нового workspace. Обычные файлы под `ci/` остаются входами. Новый receipt
содержит `previous_bundle:{revision,artifacts:[{path,sha256}]}`; предыдущая цепочка
не обходится. Этот режим создаёт новый каталог bundle и выполняет полный reindex.
Служебные JSON каждый ограничены `--max-file-bytes`, суммарные prior artifacts —
`--max-source-bytes`, SCIP — `--max-index-bytes`. Предыдущая квитанция не получает
подпись или semantic PASS от структурной проверки.

SCIP-go v0.2.7 требует [candidate-правки producer](compat/scip-go/README.md), чтобы
явно объявлять байтовую кодировку координат. Получение source/dependencies:
`go mod download -json github.com/scip-code/scip-go@v0.2.7`; поле `Dir` даёт
SourceRoot. `scripts/build-scip-go.ps1 -SourceRoot ... -Go ... -Scratch ...
-Destination ...` принимает absolute paths и собирает candidate из побайтно
проверенной копии 129 файлов. Значение Go получают через `go env GOROOT` +
`bin/go.exe`; qualifier использовал Go1.26.5 Windows/amd64. Каталоги Scratch и
Destination должны быть новыми. Кэш модулей и external не редактируются.

Для этого producer проверен offline env: SystemRoot, PATH на Go bin, GOROOT,
GOTOOLCHAIN=local, GOENV=off, GOWORK=off, GOPROXY=off, GOSUMDB=off,
GOPACKAGESDRIVER=off, CGO_ENABLED=0, GOFLAGS=-mod=readonly и отдельные
GOCACHE/GOMODCACHE/GOPATH/TEMP/TMP за пределами workspace. Его argv:
`--module-path=... --module-version=... --repository-remote=...
--go-version=go1.26.5 --output={index} .`.

Capture не делает Fossil commit. Вызывающий публикует три bundle-файла отдельным
check-in B после source A; импорт B требует явный
`--profile dais-scip-modern-utf8-v1`. Modern-профиль закреплён на schema v0.7.1,
сохраняет новые поля и требует explicit UTF8 position_encoding. Legacy-профиль
`dais-scip-utf8-v1` остаётся прежним; UTF16/UTF32/unspecified отклоняются.
Флаг `--profile` нужен и при последующем чтении/verify этого snapshot.

Общий deadline, размеры исходников/SCIP/log и число файлов ограничены флагами.
Неизменность workspace и executable проверяется после исполнения. Это capture
заявленных входов, не sandbox фактических чтений: toolchain/external dependencies
и descendants остаются границей квалификации. Timeout отменяет прямой процесс;
успешная публикация после истечения deadline запрещена. Статус CAPTURED не
приравнивается к semantic PASS. Повтор с явным previous bundle описан выше;
автоматическая публикация и incremental execution требуют следующего среза.

## Text search CLI

`dais-ci index|search|status` принимает те же index-root/repository-id.
Index использует `--repository`, `--fossil`, `--fossil-home`, `--ref`,
`--mode full|delta`, repeated `--exclude`. Search kinds:
`code`, `regex`, `filename`, `symbol_text`. Последний выполняет текстовый поиск.
`--expect-revision` отклоняет устаревшую публикацию. Результат несёт check-in,
file artifact hash, path/line, generation и canonical SV ref.

## Проверка

Из каталога модуля, с явным `DAIS_TEST_FOSSIL`:

```powershell
$env:DAIS_TEST_FOSSIL = 'D:/zPython/opencode/external/fossil/fossil.exe'
pwsh -NoProfile -File scripts/go.ps1 -Action test -Packages ./internal/fossil,./internal/search,./internal/evidencegraph,./internal/scipmodern,./internal/capture,./cmd/dais-graph,./cmd/dais-capture
```

Tests используют настоящие disposable Fossil repositories и SQLite, без mock
провайдеров. Внешние compiled-CLI воспроизводители, исходные FAIL и итоговые receipts:
[evidence archive](../../experiments_history/2026-10-16_dais-evidence-graph/REPORT.md).
