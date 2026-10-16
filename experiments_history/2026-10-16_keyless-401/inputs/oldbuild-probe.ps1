# oldbuild-probe.ps1 — t71 supplementary probe (NOT the 10-07 instrument):
# same keyless request on the OLD build (.temp/dist-backup-20260918/opencode.exe, 2026-09-18)
# for ONE model (space-bunny-free, the fast 429 signal). If the old client gets the
# SAME service answer (429 FreeUsageLimitError), the answering layer is SERVICE.
param(
  [string]$Exe = 'D:\zPython\opencode\.temp\dist-backup-20260918\opencode.exe',
  [string]$Model = 'space-bunny-free',
  [int]$TimeoutSec = 100
)
$ErrorActionPreference = 'Stop'
$repo = 'D:\zPython\opencode'
$catalogNames = @(Get-ChildItem "$repo\packages\opencode\src\provider\models" -Filter *.json | ForEach-Object {
  $j = Get-Content $_.FullName -Raw | ConvertFrom-Json
  @($j.env)
} | Where-Object { $_ }) | Sort-Object -Unique
$keyShaped = '(?i)(_API_KEY|_APIKEY|_TOKEN|_SECRET|_KEY|_PASSWORD)$|^OPENCODE_'
$present = @(Get-ChildItem Env: | Where-Object { $catalogNames -contains $_.Name -or $_.Name -match $keyShaped } | ForEach-Object Name)
foreach ($n in $present) { Remove-Item "Env:$n" }
"removed from env: $($present -join ', ')"
$ws = Join-Path $repo '.temp\test\t71-oldbuild\space-bunny-free'
if (Test-Path $ws) { Remove-Item $ws -Recurse -Force }
New-Item -ItemType Directory $ws | Out-Null
$out = Join-Path $ws 'stdout.txt'; $err = Join-Path $ws 'stderr.txt'
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $Exe -ArgumentList @('run', '-m', "opencode/$Model", '--format', 'json', 'привет') `
  -WorkingDirectory $ws -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
$done = $p.WaitForExit($TimeoutSec * 1000)
if (-not $done) { $p.Kill($true) }
$sec = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
$raw = if (Test-Path $out) { Get-Content $out -Raw -Encoding utf8 } else { '' }
$text = (@($raw -split "`n" | Where-Object { $_.Trim() } | ForEach-Object {
  try { $e = $_ | ConvertFrom-Json } catch { return }
  if ($e.type -eq 'text' -and $e.part.text) { $e.part.text }
}) -join '').Trim()
$errEvent = (@($raw -split "`n" | Where-Object { $_ -match '"type":"error"' }) | Select-Object -First 1)
[pscustomobject]@{
  model = $Model; seconds = $sec; timed_out = -not $done; exit = $(if ($done) { $p.ExitCode } else { $null })
  answered = [bool]$text; answer = $(if ($text.Length -gt 160) { $text.Substring(0, 160) + '…' } else { $text })
  error = $(if ($errEvent) { $errEvent.Substring(0, [Math]::Min(300, $errEvent.Length)) } else { '' })
} | ConvertTo-Json -Compress
