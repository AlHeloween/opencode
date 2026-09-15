# Fossil undo smoke (no TUI)

Isolated full-leaf Fossil checks via **product** `Snapshot` / `SnapshotFossil` — not raw CLI playground and not TUI.

## Why

TUI smoke mixed agent dialogs, stale tips, and accidental fossil wipe → `HISTORY_INVALID`.  
This folder proves the **snapshot layer** alone on a dedicated worktree under `experiments/`.

## Layout

```
experiments/2026-08-06_fossil-undo-smoke/
  README.md
  run.ps1       # convenience from repo root
  wc/           # worktree (created/cleaned by smoke)
packages/opencode/script/fossil-undo-smoke.ts   # real runner (@/ resolution)
```

## Run (from repo root)

```powershell
pwsh experiments/2026-08-06_fossil-undo-smoke/run.ps1
```

Or:

```powershell
cd packages/opencode
bun script/fossil-undo-smoke.ts
# optional custom wc:
bun script/fossil-undo-smoke.ts D:\path\to\wc
```

Needs `external/fossil/fossil.exe` or `tools/fossil.exe` or `fossil` on PATH (same as product).

## Oracles

| # | Check |
|---|--------|
| S1 | T0→T1→T2 structure: h1,h2 → h2′,h3 → h4 |
| S2 | `revertTo(T1)`: no h4; h2=h2prime |
| S3 | `revertTo(T0)`: only h1,h2; h2=v0 |
| S4 | `checkout(T2)` redo leaf |
| S5 | user-only untracked survives |
| S6 | rename a→b undo/redo exact paths |
| S7 | invalid hash fails loud |
| S8 | HISTORY_INVALID marker blocks restore |

No TUI. No agent. Exit 0 = all pass.

## Binary staging (for TUI follow-up)

```
bin/
  opencode.exe
  opentui.dll
  opencode-markdownify.exe
  cmd_runner.exe
  tools/fossil.exe
wc/                 # clean worktree (project cwd)
```

Rebuild + stage (from repo root):

```powershell
pwsh _build.ps1 -SkipOpenTui
# then copy as in run_tui_smoke.ps1
```

TUI smoke:

```powershell
pwsh experiments/2026-08-06_fossil-undo-smoke/run_tui_smoke.ps1
```
