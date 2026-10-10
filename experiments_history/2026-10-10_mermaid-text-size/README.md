# Mermaid — результат измерения

✓ CONFIRMED: app49/core65 tests PASS, tsgo exit0; _build.ps1 exit0, candidate10.0.1265.
Logs: logs/cmd_runner/20261010T150210Z_59a179b0,20261010T150301Z_63b6e63a,20261010T150300Z_4134abfe,20261010T150338Z_9adfe5ad.
evidence.json содержит SHA256 исходников, candidate и полного buildlog; live-result.json — физические размеры WT.
Screenshot retained in experiments/2026-10-10_mermaid-render-audit/live2.png (PNG excluded from text archive by archive.cjs canon).
Falsifier: letter advance отличается от cellWidth, разные длины схемы меняют fontSize, scroll не открывает последнюю колонку/следующий текст.
Closed: implementation PASS. Reopen when эти predicates FAIL на новой source revision. Livebin promotion вне scope.
Failed approaches retained in plan: exact-width rasterization, reset without font registration, content width overridden by default maxWidth100%; raw PowerShell runner orphan state needs tool repair.

```yaml
Keywords: fontmetrics 0.40, pixels 0.30, viewport 0.20, evidence 0.10
Semantic dominant: Измерения связывают терминальную ячейку, неизменный растр и доступность схемы прокруткой.
md5: 694fcb5d983042a6bf017fed74c38920
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 928b4f53ad106ce8f49207d65abc381e
```
