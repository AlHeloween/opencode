# Reorganize experiments/ — canon layout: [ISO8601]_<topic>/
#
# Target matrix (all moves atomic; collisions impossible — targets are fresh dirs):
#   loose files + my session probes → dated topical dirs
#   legacy misnamed dirs → renamed into canon
#
# Structure after:
# experiments/
#   20250621T000000Z_balance-smoke/            (renamed from 20250621_balance_smoke_test)
#   20260626T032900Z_sandbox-isolation/        (renamed)
#   20260707T000000Z_rendering-tools/          (renamed from 20260707-RenderingTest)
#   20260806T000000Z_deepseek-checkpoint-forensics/  (renamed)
#   20260806T000000Z_fossil-undo-smoke/        (renamed)
#   20260816T000000Z_zen-tools-kv-smoke/       (renamed)
#   20260823T000000Z_fossil-smoke/             (merge: fossil_repro4 + fossil_repro5 + 2026-08-23_fossil_smoke_work + loose 2026-08-23* files)
#   20260825T000000Z_misc-analysis/            (loose strays: _diff_reqs.py, ai_essay.md, bench-truncate.ts, fts_check.ts, wasm_test.txt, vision/? no — vision is topical)
#   20260812T000000Z_gateway-wire-analysis/    (gateway_*.py, wire_1.json, wire_2.json, wire_diff.py)
#   20260907T000000Z_deliver-once-media-smoke/ (2026-09-07_deliver_once_smoke.mts + 2026-09-07_media_calibration_smoke.mjs + 2026-09-07-log-for-analysis merge)
#   20260907T000000Z_go-session-smoke/         (renamed from 2026-09-07_go_session_smoke)
#   20260908T000000Z_novita-h3-session-probes/ (today's 10 probes)
#   vision/                                     (topical, keep)
#   wezterm/                                    (topical, keep)
#   Administrator...txt                        → archived into 20260707T000000Z_rendering-tools (stray console dump)

$ErrorActionPreference = "Stop"
Set-Location "D:\zPython\opencode\experiments"

function Move-Into($target, $items) {
    if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }
    foreach ($i in $items) {
        if (Test-Path $i) {
            $dest = Join-Path $target (Split-Path $i -Leaf)
            if (Test-Path $dest) { Write-Host "SKIP (exists): $i" -ForegroundColor Yellow; continue }
            Move-Item $i $dest
            Write-Host "moved: $i -> $target"
        } else { Write-Host "missing: $i" -ForegroundColor Yellow }
    }
}

# 1. Rename legacy dirs into canon (timestamp + kebab topic)
Rename-Item "20250621_balance_smoke_test" "20250621T000000Z_balance-smoke"
Rename-Item "20260626T032900Z_sandbox_isolation_test" "20260626T032900Z_sandbox-isolation"
Rename-Item "20260707-RenderingTest" "20260707T000000Z_rendering-tools"
Rename-Item "20260806_deepseek_checkpoint_forensics" "20260806T000000Z_deepseek-checkpoint-forensics"
Rename-Item "20260806_fossil_undo_smoke" "20260806T000000Z_fossil-undo-smoke"
Rename-Item "2026-08-16-zen-tools-kv-smoke" "20260816T000000Z_zen-tools-kv-smoke"
Rename-Item "2026-09-07_go_session_smoke" "20260907T000000Z_go-session-smoke"

# 2. Merge fossil family into one dated dir
Move-Into "20260823T000000Z_fossil-smoke" @("fossil_repro4", "fossil_repro5", "2026-08-23_fossil_smoke_work", "2026-08-23_check_revert_state.ts", "2026-08-23_fossil_smoke.ps1")

# 3. Gateway wire analysis (2026-08-12 cluster)
Move-Into "20260812T000000Z_gateway-wire-analysis" @("gateway_cache_deep.py", "gateway_diff_analysis.py", "wire_diff.py", "wire_1.json", "wire_2.json")

# 4. 2026-09-07 smoke cluster (deliver-once + media + log analysis)
Move-Into "20260907T000000Z_deliver-once-media-smoke" @("2026-09-07_deliver_once_smoke.mts", "2026-09-07_media_calibration_smoke.mjs", "2026-09-07-log-for-analysis", "c5_sweep.mts", "c5_sweep_results.json")

# 5. Today's novita probes (2026-09-08 session)
Move-Into "20260908T000000Z_novita-h3-session-probes" @(
    "smoke-test-novita-session-id.cjs",
    "smoke-test-novita-session-id-r2.cjs",
    "smoke-test-novita-wire-dump.cjs",
    "smoke-test-novita-cache-ids.cjs",
    "bench-novita-h2-vs-h3.mjs",
    "bench-novita-h3-v6-vs-v4.mjs",
    "probe-novita-h3.ps1",
    "probe-novita-h3-ipv6.mjs",
    "probe-bun-h3.mjs",
    "probe-bun-h3-client.mjs"
)

# 6. Stray files
Move-Into "20260707T000000Z_rendering-tools" @("Administrator CWindowsSystem32cmd.exe.txt")
Move-Into "20260825T000000Z_misc-analysis" @("_diff_reqs.py", "ai_essay.md", "bench-truncate.ts", "fts_check.ts", "wasm_test.txt")

# 7. vision/ and wezterm/ stay (topical dirs)

Write-Host ""
Write-Host "=== Final structure ==="
Get-ChildItem -Directory | Sort-Object Name | ForEach-Object { Write-Host $_.Name }
Get-ChildItem -File | ForEach-Object { Write-Host "LOOSE REMAINING: $($_.Name)" -ForegroundColor Yellow }
