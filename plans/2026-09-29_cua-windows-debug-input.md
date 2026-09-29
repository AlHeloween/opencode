<!-- intention: CUA debugging requires manual screenshots, IDs and multiple slow commands and cannot yet drive continuous Windows mouse input -> agents obtain an addressable visual observation and bounded, verifiable Windows mouse actions with minimal tool calls while protected operations stay protected -->
# CUA Windows debug-input ergonomics

**Status:** ACTIVE — owner authorized Windows-first changes and `external/cua` branch `local_development`; product edits remain confined to this plan. No unbounded policy bypass.
**Owner decision:** `external/cua` is a separate Git repository on owner-requested branch `local_development`, created from clean `main` at `7ee9b37edc4ebc5f7f606682ae2699d1baa5d397`. This branch holds local patches and may later incorporate upstream updates deliberately; do not fetch/merge/push now. Root Git ignores `external/`. Work Windows-first; advertise explicit unsupported results rather than claiming other platforms work.
**Bound:** at most 3 distinct repair attempts per failing task. Rust builds use no more than 2 workers (`cargo -j 2` / `CARGO_BUILD_JOBS=2`; inspect actual compiler scheduling before further runs and reduce if needed). No modifications, launches or promotions under root `bin/`; no default CUA daemon, unrestricted policy, script edits of source, full package test suites, or remote push. Candidate binary stays under Rust `target/release`, GUI tests use disposable fixtures and private endpoints only after separate foreground consent.

## Prior art

- ✓ `external/cua/libs/cua-driver/rust/crates/cua-driver-core/src/page.rs:257-270,461-464,533-555` already offers `page get_text` / `query_dom` under standard mode. `authorization.rs:339-349,511-526` intentionally refuses arbitrary `execute_javascript`; never weaken this gate to make a read expression pass.
- ✓ Windows `platform-windows/src/tools/impl_.rs:7315-7590` has a drag route but no `capture_id`. `:7926-7994` moves only an overlay for window scope; real OS pointer is desktop scope. Linux `platform-linux/src/tools/impl_.rs:11024-11052,11413-11438` already exposes held-button tools; Windows has none. `cua-driver-core/src/capture_registry.rs:817-877` atomically consumes one capture-bound point and validates session/target/native frame.
- ✓ Root wrapper `packages/opencode/src/tool/cua.ts:330-383` passes through one-shot CLI calls; automatic named session and click-binding exist, but a model must supply a fresh `screenshot_out_file` and copy its `capture_id` into each pixel click. The existing successful isolated click is recorded in `plans_completed/2026-09-28_cua-observation-binding.md`.
- ✓ Owner-supplied Go worktree's read-only `opencode.db` (`part` table, 2026-09-12): 169 `get_window_state` with exit 0; 80 `click` with exit 0 out of 83 attempts; 21 calls supplied x/y; ZERO of 83 supplied `capture_id` or `session`. The prior agent could click without those fields; the exact old driver version is not stamped. This is a reproducible ergonomics regression to compare before inventing a new input channel. Keep the owner-specific worktree path and stored screenshots/provider payloads out of Git.
- ✓ `packages/opencode/src/provider/models/streamlake-vanchin.json` declares `glm-5.3-flash` tool calls and image/video input. Actual `GLM-5.3-Flash-bf16` availability, latency and wire acceptance are Unknown without a provider smoke; do not run neural inference on CPU.
- ✗ CodeGraph did not index nested Rust source: a query for its exact `impl_.rs` path returned unrelated TypeScript symbols and explicitly reported no indexed file uniquely matched. Rust caller/tests grounding uses the nested repository's source and targeted Cargo tests, not a false impact pack. External web N/A: the pinned local Rust source is primary prior art.

## Acceptance frame

| Criterion | Surface | Oracle | Falsifier |
|---|---|---|---|
| Agent asks for a window observation without choosing a file path and receives image, geometry, target, named session and capture ID in one result on a vision model | root CUA tool/processor | focused tool execution + image serialization test and isolated candidate readback | tool returns only text/path, stale PNG, or model has no image input |
| Read-only page state is available without disabling script policy | Rust page/core policy + root tool guidance | standard-mode `get_text`/`query_dom` on disposable WebView2, while `execute_javascript` still returns its exact refusal code | JS gate relaxed or read-only path unusable on fixture |
| A Windows drag cannot act on an unobserved, foreign, changed or out-of-frame target; both endpoints map through one capture | Rust core/Windows adapter | red→green core/adapter tests plus disposable drag fixture with state readback | any endpoint invalid but gesture dispatched, capture used twice, or mismatched target accepted |
| Windows game-like control uses real input rather than moving only the agent overlay; held buttons always release on stop/error | Rust Windows input and capability schema | bounded fixture/game probe for relative movement + held press/release; OS cursor and game state are independently observed | tool says moved but game sees no movement, release omitted, or focus unexpectedly taken |
| Game play result itself is measured by the game's victory/defeat indicator | user-selected game | actual gameplay oracle once the owner provides the target | no game target/controls or outcome signal: Unknown residual, never PASS |

## Risks and claims

- C1 Inferred, pinned `page.rs:461-464,533-555` and `authorization.rs:339-349`: typed read path avoids arbitrary JS. Falsifier: standard-mode call on a real WebView2 fixture fails or leaks unrestricted operation.
- C2 Inferred, pinned `capture_registry.rs:817-877`: one capture ID binds one admitted point. Two endpoints need an atomic shared extension, not two successive consumes. Falsifier: invalid second endpoint causes native dispatch or consumes a valid capture.
- C3 Unknown: a real-time 3D game may demand raw relative pointer motion and pointer lock. The current window `move_cursor` is overlay-only (`impl_.rs:7938-7993`). Falsifier: game camera moves under a bounded candidate input and verifies release; until a game is identified this criterion remains open. The 83 historical Go clicks establish only discrete window actions, not this claim.
- C4 Inferred from read-only historical DB: requiring the model to copy capture IDs and pick screenshot paths added avoidable steps relative to the Go control. Falsifier: old CUA call rows do contain `capture_id`/`session`, or a new tool execution without a path cannot return a model image. Keep Rust capture admission unchanged; fill missing context in the owning wrapper once.
- R1 critical: a held button left down or uncontrolled foreground takeover. Contain with bounded action duration, target identity, guaranteed release on exit/cancel, no implicit foreground escalation; native fixture oracle owns verification.
- R2 high: root Git does not track Rust changes. Keep Rust commit on `external/cua` `local_development` and record its SHA in root plan/docs; never claim a root commit alone installs or reproduces Rust code.
- R3 high: per-frame model/tool calls cannot meet an unknown game's real-time deadline. Measure call/screenshot latency; if too slow, propose a bounded driver-side sequence only after a game oracle exists, not an unbounded macro.

## Smoke Tests

### Baseline before product-source edit

- [x] ✓ `20260929T021550Z_1f0459fa`: `CARGO_BUILD_JOBS=2 cargo test -p cua-driver-core --release capture_registry::tests --lib`, cwd Rust workspace — exit 0, 18 passed; full log and state read. One `dead_code` warning in an unrelated test-only method, not a proof of a defect in this change.
- [ ] ✗ `20260929T022326Z_0ed13693`: Windows schema baseline launched with `CARGO_BUILD_JOBS=2` but `cmd_runner` health-check reported `exit_code:null` and `bytes_written:0` after the PID vanished. No verdict; change the instrument/limits before relying on a Windows test stamp.
- [x] ✓ `20260929T022832Z_994574e4`: `bun test test/tool/cua.test.ts`, cwd `packages/opencode` — exit 0, 8 pass / 0 fail; existing capture-bound click intact. The current `CuaTool.execute` condition checks `params.screenshot_out_file` before entering image packaging (`src/tool/cua.ts:374`), so an image is not attached when omitted. Add an exact failing tool execution regression before implementation.
- [ ] Drive `page get_text`/`query_dom` on an isolated source-built driver/WebView2 fixture in standard mode, verify target app text, and confirm `page execute_javascript` remains refused. No policy override.
- [ ] Driver schema test for `drag` with `capture_id` and two valid/invalid endpoints fails against current source; exact error case for the intended fix.

### Post-change oracles

- [ ] Focused Rust core and Windows adapter tests cover both endpoints, one-shot consumption, wrong session/window and changed frame; unaffected Linux/macOS builds or explicit unverified platform limitation.
- [x] ✓ **Focused root tool/image tests + `bun typecheck` + Prettier pass after the ergonomic wrapper changes (2026-09-29):** `bun test test/tool/cua.test.ts` → **10 pass / 0 fail** (the auto-artifact path, the history-bound binding with its refusals — reused ID, ambiguous PID, no matching observation — and the no-vision branch); `bun typecheck` exit 0; `prettier --check src/tool/cua.ts test/tool/cua.test.ts` clean after `--write`. The failing-before regression is pinned by the refusal cases themselves (a click without a matching observation throws).
- [ ] Source-built driver and disposable GUI confirm screenshot→capture-bound drag→fresh screenshot/state change, plus `get_text` without unrestricted; record command, endpoint, PID, image hashes and stop/cleanup state.
- [ ] Game-specific relative pointer, hold and victory/defeat checks remain open until game URL, control scheme and signal are available.

## Work

- [x] ✓ Create `external/cua` `local_development` branch at clean `7ee9b37` (Git status after `switch -c` showed `## local_development`).
- [ ] Establish the exact baseline/error cases including the 2026-09-12 Go control; keep `execute_javascript` policy refusal as a negative control, not a defect to erase.
- [x] ✓ **FIRST: reduce root CUA tool's agent-visible capture/addressing steps without weakening driver admission — DONE 2026-09-29.** `src/tool/cua.ts`: `cuaScreenshotFile()` creates a fresh cache artifact (`<cache>/cua/<session>/<id>.png`) when the model omits `screenshot_out_file` for `get_window_state`/`get_desktop_state` (or keeps an explicit path); `cuaBoundClickArgs()` binds the click to the LATEST matching image observation of THIS conversation (fills `capture_id`, and `window_id` when unambiguous), refuses a reused one-shot ID, refuses an ambiguous PID with several windows, and refuses an unbound pixel click; `cuaExecute()` is extracted with an injectable CLI so the tool result itself is testable. Driver admission untouched. Both branches covered: the vision path (attached image + dimensions + reusable binding) and the no-vision path (`no declared image input`, no actionable packet). Oracles: `bun test test/tool/cua.test.ts` → **10 pass / 0 fail** (two new cases on top of the previous 8), `bun typecheck` exit 0, `prettier --check` clean after `--write`.
- [ ] THEN, only if the Windows fixture/game oracle demonstrates missing capability after restoring the old short workflow: implement the smallest safe Rust input path and tests, with shared capture admission where needed; build a candidate outside root `bin/`. Do not add a second cursor authority on a guess.
- [ ] Run isolated window-level smoke and record what was genuinely observed; distinguish `drag`/held button from relative camera motion.
- [ ] Revisit the game criterion when its target and outcome signal exist. If unavailable, move only proven scoped work to completed and park the remaining criterion with an explicit resumption signal; no SUCCESS over an unplayed game.
