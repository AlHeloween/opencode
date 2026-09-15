# Results — 2026-08-06

## Product toast fix

- `errorMessage()` digs SDK/HTTP shapes (`data.message`, `error.message`, …).
- TUI undo/redo uses `errorMessage` — no more `Undo failed: [object Object]`.
- Binary: **10.0.760** staged under `bin/`.

## API smoke (no TUI)

```
cd packages/opencode
bun script/fossil-undo-smoke.ts
```

All S1–S8 **PASS** on `wc/`.

## TUI smoke (experiments folder)

Setup:

- `bin/opencode.exe` + `opentui.dll` + `cmd_runner.exe` + `tools/fossil.exe`
- clean `wc/` worktree (no prior HISTORY_INVALID)
- `cmd_runner start --cwd …/wc -- …/bin/opencode.exe`

Run id: `20260805T174217Z_cc6e8543` · Build · DeepSeek V4 Pro · fossil green · 10.0.760

| Step | Disk Exact |
|------|------------|
| T0 write | h1, h2 |
| T1 write | h1, h2prime, h3 |
| T2 write | h1, h2prime, h3, h4 |
| undo×1 | (1 message reverted) → T1 leaf |
| undo×2 | h1, **h2**, h3/h4 **GONE**, **user-only=keep-me** |
| redo×1 | h1, **h2prime**, **h3**, h4 GONE, user-only |
| redo×2 | palette flaky (ended T0 again) — redo path works once; second redo via ctrl+p needs cleaner focus |

**No `Undo failed: [object Object]`.** Toast: `1 message reverted` / `2 message reverted`.

### Residual

- redo×2 via command palette can mis-focus; script now prefers **split leader** `ctrl+x` then `u`/`r` (see `run_tui_smoke.ps1`).
- Re-run 2026-08-06: agent once wrote absolute paths outside `wc` → permission reject (not a Fossil bug). Prompt should force relative paths under cwd.
- Do not wipe `snapshot.fsl` under a live checkout.

### Program status (post-remediation)

| Item | Status |
|------|--------|
| P1–P7 master | Done / cancelled as planned |
| Toast `[object Object]` | Fixed (`a7f5fef`, pushed) |
| API fossil smoke | Green |
| TUI full-leaf undo×2 | Green (earlier Exact run) |
| TUI redo×1 | Green |
| TUI redo×2 automation | Residual harness only |
| Active `plans/` | Empty (except abstract_futures graveyard) |

## How to re-run

```powershell
pwsh _build.ps1 -SkipOpenTui
pwsh experiments/2026-08-06_fossil-undo-smoke/run_tui_smoke.ps1
# or API only:
cd packages/opencode; bun script/fossil-undo-smoke.ts
```
