<!-- sv: archive-replay 0.45, native-runtime 0.35, independent-inputs 0.20 -->
# Свежий native replay

Собрать dais-ci/capture/graph/mcp через module scripts/go.ps1. Native producer
должен иметь SHA256ffafd7494ab2103489b8aaaf5fd5290d43b7f25f6c44b9e5ab5620c240287500;
процедура candidate build — packages/dais-code-intelligence/compat/scip-go/README.md.
Go1.26.5 Windows/amd64 и module cache должны быть доступны offline. Архив не
изменяет external/, module cache или живой Fossil. Все команды — через cmd_runner.

Задать ROOT, GOROOT, MODCACHE, PRODUCER и новый абсолютный writable WORK вне архива.
Из ROOT выполнить два отдельных запуска:

```powershell
python experiments_history/2026-10-18_dais-reference-impact/impact_oracle.py --root $ROOT --goroot $GOROOT --modcache $MODCACHE --producer $PRODUCER --work-root $WORK --typed-golden "$ROOT/experiments_history/2026-10-18_dais-reference-impact/production-golden.json" --report "$WORK/production.json"
python experiments_history/2026-10-18_dais-reference-impact/impact_oracle.py --root $ROOT --goroot $GOROOT --modcache $MODCACHE --producer $PRODUCER --work-root $WORK --small-fixture --report "$WORK/small.json"
```

Предсказание: production PASS436 /94witnesses; small PASS182 /26witnesses.
Каждый запуск заново создаёт owned Fossil repo, реально выполняет два capture,
импортирует оба snapshots, строит search generation, сравнивает raw и compiled
CLI/MCP, проверяет invalid/stale/no-op/reverse/limit/mutation/EOF. Не задавать
--prepared для полного fresh replay. Reports хранят полный argv/stdout/stderr.
Читать state.json и весь stdout_text.log cmd_runner; незавершённый или усечённый
run не даёт PASS. semantic_status обязан остаться unknown.

```powershell
python experiments_history/2026-10-18_dais-reference-impact/verify_manifest.py --root $ROOT
```

Manifest проверяется на той же source revision, которой привязан архив. Изменение
source pins требует нового oracle, а не обновления исторического отчёта.
