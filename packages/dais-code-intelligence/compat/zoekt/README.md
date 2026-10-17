# Нативная Windows-совместимость Zoekt

CONFIRMED ✓ Кандидат на Windows/amd64 прошёл native build и text/delta oracle:
`20261016T104502Z_b5059330`, `20261016T104518Z_62f918ef`. Родитель независимо
повторил probe: `20261016T104714Z_783708d5`. Исходники `external/zoekt` не меняются.

Upstream pin: `74e1e85839697c4c4eb8a6223cc3971e6c26da45`.
`indexfile_windows.go` реализует Windows readonly mapping по Apache-2.0 контракту
Zoekt IndexFile; исходный проект: https://github.com/sourcegraph/zoekt,
лицензия: `external/zoekt/LICENSE`. Сохранено исходное уведомление Apache-2.0.

`builder-windows.patch` вручную удаляет единственный Unix import и init Umask;
guarded Chmod и остальной builder остаются прежними. Подготовка сначала проверяет
HEAD и normalized SHA256 исходника, копирует builder byte-for-byte, запускает
`git apply --check`, применяет этот patch и проверяет SHA256 результата.
Нормализация для hash заменяет только CRLF на LF; исходный файл не переписывается.
Это build overlay; он не является второй копией upstream runtime или хранилищем.

## Применение

PowerShell 7, Go и Git должны быть доступны. Скрипты сами находят module/repo root
от своего расположения, поэтому текущая директория вызова несущественна.
Windows путь нативный: Windows Go + Win32 mmap; WSL, контейнеров и мостов нет.

```powershell
& ./packages/dais-code-intelligence/scripts/prepare-zoekt-overlay.ps1
& ./packages/dais-code-intelligence/scripts/go.ps1 -Action build
& ./packages/dais-code-intelligence/scripts/go.ps1 -Action test -Packages ./internal/fossil,./internal/search
```

Длительный запуск выполняется через cmd_runner. Пример аргументов payload:

```text
pwsh -NoProfile -File D:\zPython\opencode\packages\dais-code-intelligence\scripts\go.ps1 -Action test -Packages ./internal/fossil,./internal/search -Go "C:\Program Files\Go\bin\go.exe"
```

`-Go`, `-Scratch`, `-TargetOS`, `-OutputName` параметризованы. Test требует явные
package paths, принимает массив или comma-separated список; полный `./...`
отвергается. Build по умолчанию собирает `./cmd/dais-ci` в module `dist/dais-ci.exe`.
Go получает `-buildvcs=false` и отдельные argv `-overlay`, `path`, включая пути
с пробелами. Scratch по умолчанию `scripts/.scratch/zoekt-windows`, gitignored.

Для самостоятельной native Linux сборки используется `-TargetOS linux`:
overlay не создаётся, собирается канонический external upstream. Это отдельная
ветка build tooling; Linux runtime на Windows этим не запускается. Cross-build
Linux также не квалифицирует native Linux исполнение. Переменная GOOS меняется
только внутри процесса скрипта и восстанавливается в finally.

## Проверка подготовки и сохранённый отказ

CONFIRMED ✗ `20261016T105030Z_508d6a15`: git apply из nested scratch сообщил exit0,
но пропустил patch. Expected-after hash отверг результат, overlay не был выдан.
CONFIRMED ✓ `20261016T105057Z_4ecd6152`: явный absolute `--directory` исправил
применение; preparation прошла в scratch пути с пробелами. Git unsafe-paths нужен
для absolute scratch; применяется только поставляемый вручную проверенный patch,
а before/after hashes ограничивают его фактический эффект.

CONFIRMED ✓ `20261016T105111Z_de2216f2`: native build существующего probe через
generated overlay с пробелами в пути завершилась exit0; full log/state прочитаны,
bytes_dropped=0, truncated=false. PS Parser обоих scripts дал DAIS_PS_PARSE_PASS.
Полный build/test нового module остаётся проверкой родителя. Параметр Scratch
предназначен только для изолированного build scratch; external/ и bin/ не цели
подготовки. Default scratch находится в gitignored scripts/.scratch/.

## Остаточные ограничения

Upstream searcher откладывает закрытие retired shards до runtime finalizer
(`search/shards.go:1529–1553`). На Windows это удерживает файл от удаления после
Searcher.Close. В probe GC использован только как явная граница fixture cleanup;
production build tooling не вызывает GC. Product generation-retirement policy
должна учитывать это время жизни. Компиляция и text search не доказывают
Fossil/SV integration, atomic publication или graph parity.

Проверка module build/test скрипта на полном новом DAIS module выполняется
родителем после появления его source bindings. Самостоятельный `prepare` и
сборка существующего probe через созданный overlay — отдельная квалификация.
