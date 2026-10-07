# probe.ps1 — does the robot start its codegraph MCP when codegraph is shipped BESIDE opencode.exe and NOT on PATH?
# Fixture: <fx>\robot\ = a copy of the candidate's dist\bin (opencode.exe + its dll) + codegraph.cmd + codegraph\
# (the installer's layout, copied from the dev host's bin\ — copied, never launched there). <fx>\project\ = a fresh
# client folder. PATH = Windows' own dirs only (-PathMode bare) or those + the robot dir (-PathMode robot, control:
# proves the copied codegraph itself works, so a failure under bare is the resolution, not the copy).
# Run 1 (a one-shot `run` in the fresh project) lets bootstrap find the sibling and `codegraph init`; run 2
# (`mcp list`) reads the status of the auto-injected server.
# -RobotDir names the install folder: the absolute .cmd path goes through cross-spawn -> cmd.exe, so a space and a
# non-ASCII name (a client's Windows user folder) are part of the input domain, not an edge case.
# Usage: pwsh -File probe.ps1 [-Exe <candidate opencode.exe>] [-PathMode bare|robot] [-Tag <label>] [-RobotDir <name>]
param(
  [string]$Exe = 'D:\zPython\opencode\dist\bin\opencode.exe',
  [ValidateSet('bare', 'robot')][string]$PathMode = 'bare',
  [string]$Tag = 'baseline',
  [string]$RobotDir = 'robot'
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$fx = Join-Path $PSScriptRoot "..\..\.temp\test\cg-resolver\$Tag-$PathMode-$stamp"
$fx = [IO.Path]::GetFullPath($fx)
$robot = Join-Path $fx $RobotDir; $project = Join-Path $fx 'project'
New-Item -ItemType Directory $robot, $project -Force | Out-Null
$log = Join-Path $PSScriptRoot "result-$Tag-$PathMode-$stamp.txt"
function Note([string]$s) { $s | Add-Content $log -Encoding utf8 }

Copy-Item (Join-Path (Split-Path $Exe) '*') $robot -Recurse
# codegraph as the installer ships it: the shim + its self-contained node tree. Source is read, not executed.
Copy-Item 'D:\zPython\opencode\bin\codegraph.cmd' $robot
Copy-Item 'D:\zPython\opencode\bin\codegraph' $robot -Recurse

$sys = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
$path = if ($PathMode -eq 'robot') { "$robot;$sys" } else { $sys }

"probe $Tag/$PathMode $(Get-Date -Format o) exe=$Exe version=$(& $Exe --version)" | Set-Content $log -Encoding utf8
Note "fixture=$fx"
Note "PATH=$path"

function RunRobot([string[]]$argv) {
  $psi = [Diagnostics.ProcessStartInfo]::new((Join-Path $robot 'opencode.exe'))
  foreach ($a in $argv) { $psi.ArgumentList.Add($a) }
  $psi.WorkingDirectory = $project; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  # A child sees ONLY this PATH; every other variable is the parent's.
  $psi.Environment['PATH'] = $path
  $psi.Environment.Remove('OPENCODE_CODEGRAPH_MCP') | Out-Null
  $p = [Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEndAsync(); $p.StandardInput.Close()
  if (-not $p.WaitForExit(180000)) { $p.Kill($true); Note 'robot: KILLED after 180 s' }
  [pscustomobject]@{ exit = $p.ExitCode; out = ($o.Result -replace '\x1b\[[0-9;]*m', ''); err = ($e.Result -replace '\x1b\[[0-9;]*m', '') }
}

# Control: the fixture PATH must NOT see a codegraph under bare, and must see the robot's one under robot.
Note "control: codegraph.cmd beside the exe: $(Test-Path (Join-Path $robot 'codegraph.cmd'))"
$env:PATH_SAVE = $env:PATH; $env:PATH = $path
$onPath = (Get-Command codegraph -ErrorAction SilentlyContinue).Source
$env:PATH = $env:PATH_SAVE
Note "control: codegraph resolvable through the fixture PATH: $(if ($onPath) { $onPath } else { '<none>' })"

# `mcp list` does NOT run InstanceBootstrap (measured: no .codegraph after it), so run 1 is a one-shot `run` on a
# model that does not exist — it bootstraps the instance (codegraph init via the sibling) and exits on the session error.
$r1 = RunRobot @('run', '-m', 'opencode/no-such-model', 'probe')
Note "run1 (run, bootstrap trigger) exit=$($r1.exit)"
if ($r1.err.Trim()) { Note "run1 stderr: $($r1.err.Trim().Substring(0, [Math]::Min(300, $r1.err.Trim().Length)))" }
for ($i = 0; $i -lt 120 -and -not (Test-Path "$project\.codegraph\codegraph.db"); $i++) { Start-Sleep -Milliseconds 500 }
Note "after run1: project .codegraph\codegraph.db exists: $(Test-Path "$project\.codegraph\codegraph.db")"

$r2 = RunRobot @('mcp', 'list')
Note "run2 exit=$($r2.exit)"
Note ($r2.out.Trim())
if ($r2.err.Trim()) { Note "run2 stderr: $($r2.err.Trim().Substring(0, [Math]::Min(600, $r2.err.Trim().Length)))" }

# Stop whatever the fixture left running (a codegraph daemon names its project path), AFTER it was recorded.
$left = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($fx, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
Note "processes naming the fixture after run2: $($left.Count)"
$left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Note 'done'
