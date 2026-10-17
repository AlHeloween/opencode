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
pwsh -NoProfile -File scripts/go.ps1 -Action test -Packages ./internal/fossil,./internal/search,./internal/evidencegraph,./cmd/dais-graph
```

Tests используют настоящие disposable Fossil repositories и SQLite, без mock
провайдеров. Внешние compiled-CLI воспроизводители, исходные FAIL и итоговые receipts:
[evidence archive](../../experiments_history/2026-10-16_dais-evidence-graph/REPORT.md).
