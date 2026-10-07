# repro.ps1 — does a one-shot `opencode run` leave the codegraph MCP process tree behind?
# Counts processes whose command line names THIS fresh workspace (`serve --mcp --path <ws>` daemon and its
# watchdog, which carries <ws>\.codegraph\codegraph.db), before the run, during it, and 0/5/15 s after exit.
# Usage: pwsh -File repro.ps1 [-Exe <path to opencode.exe>] [-Tag <label>] [-Model <id>]
#   -Model opencode/no-such-model drives the ERROR exit (run.ts process.exit(1)), the default the success exit.
param(
  [string]$Exe = 'D:\zPython\opencode\dist\bin\opencode.exe',
  [string]$Tag = 'run',
  [string]$Model = 'opencode/nemotron-3-ultra-free'
)
$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$ws = "D:\zPython\opencode\.temp\test\cg-orphan\ws-$Tag-$stamp"
New-Item -ItemType Directory $ws -Force | Out-Null
$log = Join-Path $PSScriptRoot "result-$Tag-$stamp.txt"

function Survivors {
  @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($ws, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    ForEach-Object {
      $c = $_.CommandLine -replace '\s+', ' '
      [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; cmd = $c.Substring(0, [Math]::Min(160, $c.Length)) }
    })
}

"repro $Tag $(Get-Date -Format o) exe=$Exe ws=$ws" | Set-Content $log -Encoding utf8
"codegraph on PATH: $((Get-Command codegraph -ErrorAction SilentlyContinue).Source)" | Add-Content $log -Encoding utf8
"before: $((Survivors).Count)" | Add-Content $log -Encoding utf8

$psi = [Diagnostics.ProcessStartInfo]::new($Exe)
foreach ($a in @('run', '-m', $Model, '--format', 'json', 'привет')) { $psi.ArgumentList.Add($a) }
$psi.WorkingDirectory = $ws; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true
$psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
$t0 = Get-Date
$p = [Diagnostics.Process]::Start($psi)
$outTask = $p.StandardOutput.ReadToEndAsync(); $errTask = $p.StandardError.ReadToEndAsync()
$p.StandardInput.Close()
$during = 0
for ($i = 0; $i -lt 360 -and -not $p.HasExited; $i++) {
  Start-Sleep -Milliseconds 500
  $n = @(Survivors | Where-Object { $_.pid -ne $p.Id }).Count
  if ($n -gt $during) { $during = $n }
}
if (-not $p.HasExited) { $p.Kill($true); 'robot: KILLED after 180 s' | Add-Content $log -Encoding utf8 }
$p.WaitForExit()
$out = $outTask.Result; $err = $errTask.Result
$answer = (@($out -split "`n" | ForEach-Object { try { $e = $_ | ConvertFrom-Json } catch { return }; if ($e.type -eq 'text') { $e.part.text } }) -join '').Trim()
"robot: exit=$($p.ExitCode) seconds=$([int]((Get-Date) - $t0).TotalSeconds) answer=$answer" | Add-Content $log -Encoding utf8
if ($err.Trim()) { "stderr: $($err.Trim().Substring(0, [Math]::Min(400, $err.Trim().Length)))" | Add-Content $log -Encoding utf8 }
"during (max processes naming ws while the robot ran): $during" | Add-Content $log -Encoding utf8
"workspace .codegraph exists: $(Test-Path "$ws\.codegraph")" | Add-Content $log -Encoding utf8

$elapsed = 0
foreach ($wait in 0, 5, 15) {
  Start-Sleep -Seconds ($wait - $elapsed); $elapsed = $wait
  $s = Survivors
  "after +$($wait)s: $($s.Count)" | Add-Content $log -Encoding utf8
  $s | ForEach-Object { "  pid=$($_.pid) ppid=$($_.ppid) $($_.name) $($_.cmd)" } | Add-Content $log -Encoding utf8
}
# Leave nothing behind for the next run: stop the survivors only AFTER they were counted.
Survivors | ForEach-Object { Stop-Process -Id $_.pid -Force -ErrorAction SilentlyContinue }
"cleanup: survivors stopped; remaining=$((Survivors).Count)" | Add-Content $log -Encoding utf8
'done' | Add-Content $log -Encoding utf8
