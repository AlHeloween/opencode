# Stage rebuilt opencode + cmd_runner into this experiment and run TUI undo smoke.
# Usage (repo root): pwsh experiments/2026-08-06_fossil-undo-smoke/run_tui_smoke.ps1
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$smoke = $PSScriptRoot
$bin = Join-Path $smoke "bin"
$wc = Join-Path $smoke "wc"

Set-Location $root

# --- stage binaries ---
New-Item -ItemType Directory -Force -Path $bin, (Join-Path $bin "tools") | Out-Null
if (-not (Test-Path (Join-Path $root "dist\bin\opencode.exe"))) {
  throw "dist/bin/opencode.exe missing — run: pwsh _build.ps1 -SkipOpenTui"
}
Get-Process opencode -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Copy-Item -Force (Join-Path $root "dist\bin\opencode.exe") $bin
Copy-Item -Force (Join-Path $root "dist\bin\opentui.dll") $bin
if (Test-Path (Join-Path $root "dist\bin\opencode-markdownify.exe")) {
  Copy-Item -Force (Join-Path $root "dist\bin\opencode-markdownify.exe") $bin
}
Copy-Item -Force (Join-Path $root "cmd_runner.exe") $bin
$fossilSrc = @(
  (Join-Path $root "external\fossil\fossil.exe"),
  (Join-Path $root "tools\fossil.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($fossilSrc) {
  Copy-Item -Force $fossilSrc (Join-Path $bin "tools\fossil.exe")
}

# --- clean worktree (no leftover HISTORY_INVALID) ---
if (Test-Path $wc) { Remove-Item -Recurse -Force $wc }
New-Item -ItemType Directory -Force -Path $wc | Out-Null
Set-Content (Join-Path $wc ".gitignore") "node_modules`n.opencode/data`n"

$opencode = Join-Path $bin "opencode.exe"
$cmdRunner = Join-Path $bin "cmd_runner.exe"
Write-Host "opencode: $(& $opencode --version)"
Write-Host "wc: $wc"

# --- start TUI ---
$out = & $cmdRunner start --cwd $wc -- $opencode 2>&1
$out | ForEach-Object { Write-Host $_ }
$rid = ($out | Select-String -Pattern '\d{8}T\d{6}Z_[a-f0-9]+').Matches.Value | Select-Object -First 1
if (-not $rid) { throw "no cmd_runner rid" }
Write-Host "RID=$rid"
$rid | Set-Content (Join-Path $smoke "last_rid.txt")

Start-Sleep -Seconds 8
1..3 | ForEach-Object {
  & $cmdRunner send $rid --keys "ESC" --send-tail 0 | Out-Null
  Start-Sleep -Milliseconds 300
}
& $cmdRunner tail $rid -n 20

# Multi-turn agent structure (Big Pickle / default model)
function Wait-Files($predicate, $label, $maxSec = 120) {
  $deadline = (Get-Date).AddSeconds($maxSec)
  while ((Get-Date) -lt $deadline) {
    if (& $predicate) {
      Write-Host "READY $label"
      return
    }
    Start-Sleep -Seconds 5
  }
  throw "timeout waiting for $label"
}

& $cmdRunner send $rid --crlf --send-tail 5 --wait-ms 1500 -- "Write ONLY h1.txt content h1 and h2.txt content h2. Use write tool. Stop."
Wait-Files {
  (Test-Path (Join-Path $wc "h1.txt")) -and (Test-Path (Join-Path $wc "h2.txt")) -and
  ((Get-Content (Join-Path $wc "h2.txt") -Raw).Trim() -eq "h2")
} "T0"

1..2 | ForEach-Object { & $cmdRunner send $rid --keys "ESC" --send-tail 0 | Out-Null; Start-Sleep -Milliseconds 300 }
& $cmdRunner send $rid --crlf --send-tail 3 --wait-ms 1000 -- "Overwrite h2.txt to h2prime and write h3.txt content h3. Stop."
Wait-Files {
  (Test-Path (Join-Path $wc "h3.txt")) -and ((Get-Content (Join-Path $wc "h2.txt") -Raw).Trim() -eq "h2prime")
} "T1"

1..2 | ForEach-Object { & $cmdRunner send $rid --keys "ESC" --send-tail 0 | Out-Null; Start-Sleep -Milliseconds 300 }
& $cmdRunner send $rid --crlf --send-tail 3 --wait-ms 1000 -- "Write ONLY h4.txt content h4. Stop."
Wait-Files { Test-Path (Join-Path $wc "h4.txt") } "T2"

Set-Content (Join-Path $wc "user-only.txt") -Value "keep-me" -NoNewline

function Show-State($label) {
  Write-Host "=== $label ==="
  foreach ($n in @("h1","h2","h3","h4","user-only")) {
    $p = Join-Path $wc "$n.txt"
    if (Test-Path $p) { Write-Host "  $n.txt=[$((Get-Content $p -Raw).Trim())]" }
    else { Write-Host "  $n.txt=GONE" }
  }
}
Show-State "T2 baseline"

# Prefer leader chords (messages_undo/redo = <leader>u / <leader>r).
# Split chord with pause — more reliable than palette filter "redo"/"undo".
function Clear-Dialogs {
  1..4 | ForEach-Object {
    & $cmdRunner send $rid --keys "ESC" --send-tail 0 | Out-Null
    Start-Sleep -Milliseconds 350
  }
  Start-Sleep -Milliseconds 500
}
function Do-Undo {
  Clear-Dialogs
  & $cmdRunner send $rid --keys "ctrl+x" --send-tail 0 | Out-Null
  Start-Sleep -Milliseconds 450
  & $cmdRunner send $rid --keys "u" --send-tail 10 --wait-ms 2500
  Start-Sleep -Seconds 4
}
function Do-Redo {
  Clear-Dialogs
  & $cmdRunner send $rid --keys "ctrl+x" --send-tail 0 | Out-Null
  Start-Sleep -Milliseconds 450
  & $cmdRunner send $rid --keys "r" --send-tail 10 --wait-ms 2500
  Start-Sleep -Seconds 4
}

Do-Undo
Show-State "after undo 1"
Do-Undo
Show-State "after undo 2"
Do-Redo
Show-State "after redo 1"
Do-Redo
Show-State "after redo 2"

Write-Host "=== tail (check for Undo failed / reverted) ==="
& $cmdRunner tail $rid -n 30

& $cmdRunner stop $rid --reason "tui smoke done"
Write-Host "Done. Inspect disk above + logs/cmd_runner/$rid"
