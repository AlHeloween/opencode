<!-- intention: cua and Universal Search are suspected on egress, hidden code and reliability, with no measurement behind the suspicion -> every component shipped to colleagues has a measured egress manifest, a known build provenance and a recorded reliability profile, and nothing leaves a machine the owner did not approve -->
<!-- goal_sv: supply-chain-audit, egress-manifest, telemetry, provenance, reliability -->
# Supply-chain audit — cua first, then Universal Search

```yaml
Keywords: supply-chain-audit 0.30, egress-manifest 0.25, telemetry 0.20, provenance 0.15, reliability 0.10
Semantic dominant: Measure what cua (then Universal Search) sends out, what its binaries are built from, and how reliably it behaves, before shipping it to colleagues.
md5: 8b41e0c7d3f95a2e6c1b7d04f9a3e582
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

**Status:** ACTIVE — owner, 2026-09-30: «Всё вместе, начинай аудит с cua». Scope: egress + hidden code + reliability.
Consumer: `plans/2026-09-30_robot-installer.md` ships only components with an approved egress manifest.

## Acceptance frame

| Criterion | Surface | Oracle | Falsifier |
|---|---|---|---|
| Every egress site of cua is listed with its trigger and opt-out | `external/cua/libs/cua-driver/rust` source | static inventory (below) + dynamic run agrees with it | a connection observed at runtime that the inventory does not name |
| Dynamic egress of cua under typical use is measured | running driver (serve / call / doctor / mcp) | PID-tree TCP sampler + DNS-cache diff, qualified on a control request first | the control request is not detected (instrument blind) |
| The shipped cua binary has zero egress by construction | our `local_development` build | same dynamic oracle on the fork build: empty manifest | any outbound connection |
| Build provenance is known | `target/release/cua-driver.exe`, `bin/cua/` (read-only hash, never launched) | source commit + clean tree + dependency inventory | binary of unknown origin shipped |
| Reliability defects are recorded as classes | W3 run + this audit | cited runs | a class stated without a run |

## Stage A — static egress inventory (read in code at `7ee9b37`, 2026-09-30) ✓

One HTTP client only: `ureq` (`crates/cua-driver/Cargo.toml:32`); `tokio-tungstenite` is WebSocket for CDP to local
browsers (`cua-driver-core/Cargo.toml:36`). Four HTTP call sites + one shell download:

| # | Site | Destination | Trigger | Opt-out |
|---|---|---|---|---|
| E1 | `telemetry.rs:2194` | `https://eu.i.posthog.com/capture/` (`:25`, key hard-coded `:26`) | lifecycle + every CLI/MCP completion (events `cua_driver_installation_registered … cua_driver_update_apply_completed`) | **enabled by default** (`telemetry.rs:3-4`); env `CUA_DRIVER_RS_TELEMETRY_ENABLED=0` or persisted pref |
| E2 | `version_check.rs:690` | `https://api.github.com/repos/trycua/cua/releases?per_page=40` (`:70`) | `serve` (`main.rs:609`), `doctor` without `--json` (`:807`), `mcp` (`:854`) | env `CUA_DRIVER_RS_UPDATE_CHECK=0`, config flag, prerelease builds (`version_check.rs:475-487`) |
| E3 | `check_update_tool.rs:64` | same as E2 | **MCP tool `check_for_update` — the model can trigger egress** | same as E2 (Unknown whether the tool honours it — to check dynamically) |
| E4 | `skills.rs:702,712` | skills manifest/files (`--from main`) | explicit `skills install/update` only | do not run it |
| E5 | `updater.rs:123` | `iwr -useb https://cua.ai/driver/install.ps1 \| iex` (`:93`) | explicit `update --apply` only | remote script execution — remove from the shipped build |

Telemetry payload, observed without sending (`cua-driver telemetry inspect <event> --json`, 2026-09-30): no prompts,
arguments, text or paths; `tool_name`, `operation`, `success`, `refusal_code`, `duration_bucket`, `output_size_bucket`,
`os_family/os_major/arch`, `product_version`, `process_session_id`, and a persistent `distinct_id` (installation ID).
PostHog also sees the source IP at the network level. This host: `Telemetry: disabled (source: persisted)`,
`Registration recorded: true` — a registration event was sent at some earlier point. E2 is Exact: today's daemon
logged «cua-driver v0.30.4 is available» three times (runs of `experiments/2026-09-30_cua-drag-live/`).

## Smoke Tests

- [ ] **A1 sampler qualification:** the PID-tree TCP sampler + DNS-cache diff detects ONE short HTTPS request from a control process (predicted: detected, host and port named); blind → instrument broken, stop. <!-- sv: toolchain-qualification, egress-sampler, control-request -->
- [ ] **A2 dynamic egress, current binary:** run `serve` / `call list_windows` / `doctor` / `mcp` / `call check_for_update` with telemetry as persisted (disabled) and update check default; predicted: GitHub API only, from `serve`/`doctor`/`mcp`/`check_for_update`; nothing to PostHog. <!-- sv: egress-manifest, cua-runtime, prediction -->
- [ ] **A3 dynamic egress, opt-outs:** same with `CUA_DRIVER_RS_UPDATE_CHECK=0`; predicted: empty manifest (tests whether E3 honours the env). <!-- sv: egress-manifest, opt-out, check-for-update -->

## Work

- [x] **SA static inventory:** Stage A above. <!-- sv: static-egress, cua-source, inventory --> ✓ read in code, payload via `telemetry inspect`.
- [ ] **SB dynamic egress:** A1 → A2 → A3; record per-command manifests in `experiments/2026-09-30_cua-egress/`. <!-- sv: dynamic-egress, sampler, manifest -->
- [ ] **SC provenance / hidden code:** clean-tree check of `external/cua` at the build commit; hash of `target/release/cua-driver.exe` and (read-only, never launched) `bin/cua/cua-driver.exe`; list `build.rs` scripts (4: `cua-driver`, `cua-driver-sdk`, `cua-driver-uia`, `platform-macos`) and what they execute; Cargo.lock inventory (635 packages) with network/process-spawning crates flagged; `Command::new` / registry / scheduled-task writes (autostart) in shipped code. <!-- sv: provenance, build-scripts, hidden-behaviour -->
- [ ] **SD fork build with egress compiled out:** telemetry, update check, `check_for_update`, updater and `skills --from main` removed at compile time on `local_development`; A2 rerun on it → empty manifest. <!-- sv: fork-build, compile-out, zero-egress -->
- [ ] **SE reliability classes:** collect from `plans/2026-09-29_cua-windows-debug-input.md` W3 (unobserved drag dispatches; advertised input schema not enforced — `capture_id` silently ignored; result labels inconsistent) plus anything SB/SC find. <!-- sv: reliability, defect-classes, evidence -->
- [ ] **SF Universal Search:** the same A–E for `D:\zPython\universal-search` (bundled Chromium with CDP on 127.0.0.1:9222 without auth, SearXNG, crw-server; built to pass bot walls — legal/ToS review for redistribution). <!-- sv: universal-search, cdp-port, redistribution -->
