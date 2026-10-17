<!-- sv: independent-golden 0.55, compiler-selection 0.30, byte-comparability 0.15 -->
# Квалификация независимого Go AST/types inventory

CONFIRMED ✓ final run `20261017T110736Z_5ee75ddb`: exit0, dropped0,
truncatedfalse; полный state/log прочитан. Скрипт проверил заранее заданные
identifier coordinates и target identities: 5 named function/method definitions,
включая unexported hidden, 3 cross-package references; A.Same и B.Same не слились.
Стандартный strings import отдельно задействовал gc importer по Export files.
Broken method fixture дал ожидаемый nonzero и INCOMPLETE report без definitions
и references. Это квалификация инструмента, не verdict о SCIP или CodeGraph.

Инструмент `typed-golden.go` не импортирует DAIS, SCIP или CodeGraph. Native Go
list задаёт compiler-selected GoFiles для двух packages, а independent parser/
types checker обрабатывает собственные packages с gc importer для standard
dependencies. Tests и build-excluded files перечислены явно и не анализируются.
Definitions ограничены named functions/methods, including unexported; references
берутся из Info.Uses/Selections только к этим definitions. External definitions,
builtins, fields/locals/implicit declarations и call-graph inference исключены.
Identifier ranges — 0-based physical UTF8 byte coordinates, без //line remapping.
Все source pins проверяются до/после compiler selection и после type checking.

Состояние COMPLETE означает завершённый inventory названного cohort. Ошибка
компиляции/type check, missing export, source drift или output bound означает
INCOMPLETE, nonzero, пустые definitions/references; report сохраняется по новому
caller-owned output path. Tool не перезаписывает существующий report.

Квалифицированный compiler:
`C:/Users/Alexander/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.26.5.windows-amd64/bin/go.exe`.
Запуск инструментом задаёт GOOS=windows, GOARCH=amd64, GOWORK=off, GOPROXY=off,
GOSUMDB=off, list -mod=readonly -export -deps -json и exact package patterns.
Go environment и source SHA256 сохраняются в каждом inventory report.

CONFIRMED ✓ source SHA256:
`2307d7415cbbf6b2c29f223a26deeb2f53b21e06990995f60df4435f7a752c4b`.
CONFIRMED ✓ executable SHA256:
`4d55bc577b824c628e3de8f033af38c024c16e4440b6eb427f8dffeb5fcb58cc`.
CONFIRMED ✓ qualification script SHA256:
`6eefe579c6f0e968c3de599e7596268d41fbd4629c84a140a79eb1770d55c8ba`.

## Воспроизведение

Сборка из этого experiment directory: direct Go1.26.5 executable выше,
`build -buildvcs=false -o typed-golden.exe typed-golden.go`.
Квалификация: `python qualify-typed-golden.py <absolute-direct-Go1.26.5> <new-label>`.
Для нового frozen production module родитель запускает executable с
`--module-root <absolute-root> --go <absolute-direct-Go> --output <new-absolute-report>`.
Родитель независимо сравнивает inventory с raw SCIP/MCP. Исполнитель этого
инструмента production corpus не запускал.

## Сохранённая история

- `20261017T110351Z_f95bb1c4`: ожидаемый RED — instrument executable отсутствует.
- `20261017T110503Z_a1dbbc40`: первая сборка exit0; system Go оказался старее fixture.
- `20261017T110522Z_9dd58fa5`: HARNESS failure — launcher auto-toolchain verification
  при offline GOSUMDB=off; good-report.json сохранён как INCOMPLETE.
- `20261017T110603Z_afea35f4`: rebuild exit0 тем же system Go.
- `20261017T110632Z_bfaa044c`: HARNESS failure — instrument собран Go1.25,
  а module требует Go1.26; type checker корректно отказал. Report direct-v1 сохранён.
- `20261017T110707Z_8c47a691`: qualified direct Go1.26.5 build exit0.
- `20261017T110736Z_5ee75ddb`: final qualification PASS, включая broken-types control.

Raw state/stdout copies находятся в typed-golden-evidence/runs/. Финальные reports:
qualification/good-report-direct-v2.json и qualification/broken-report-direct-v2.json.
Ранние reports сохраняют свои input hashes; good fixture позднее расширен strings
import и hidden definition, поэтому ранние pins не являются pins финальной fixture.
