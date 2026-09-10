# CUA visual oracle integration (2026-09-08)

## Goal
Integrate self-built `cua-driver` (external/cua, MIT) into the opencode
production package as the visual/computer-use oracle: vendored binary +
wrapper in `bin\cua`, a first-class `cua` tool, kernel add-on bindings.

## Grounded facts [Exact]
- Built: `external/cua/libs/cua-driver/rust/target/release/cua-driver.exe`
  (release, 9m13s, exit 0, cargo 1.97.1 pin from rust-toolchain.toml).
- 64 MCP tools registered (`list-tools` exit 0): desktop
  (screenshot/get_desktop_state/click/type_text/scroll/press_key/
  get_accessibility_tree/get_window_state/verify_state/zoom/list_windows/
  launch_app hidden…) + browser CDP suite (browser_prepare/navigate/click/
  type/pointer/get_browser_state/dialog/download/set_input_files…).
- Architecture: MCP JSON-RPC 2.0 daemon over stdio (`cua-driver mcp`) or
  one-shot CLI (`cua-driver call <tool> '<json>' [--screenshot-out-file p]`).
  Daemon auto-starts on MCP; CLI `call` requires `serve` daemon running.
- CLI quirks: PowerShell 5.1 strips JSON quotes — our wrapper must pipe JSON
  via stdin (CLI supports `None => read_stdin_json()`).
- `which()` util (packages/opencode/src/util/which.ts) already searches
  `Global.Path.bin` → vendored `bin/` binaries are discoverable product-wide.
- codegraph vendored pattern: `bin/codegraph/` dir + `bin/codegraph.cmd`
  shim `@"%~dp0\..." %*`; `bin/` is gitignored (local install surface).

## Tasks
1. **Vendor binary**: copy `cua-driver.exe` → `bin/cua/cua-driver.exe`
   (gitignored install surface, like codegraph).
2. **Wrapper**: `bin/cua.cmd` shim → `bin\cua\cua-driver.exe %*`.
3. **Tool**: `packages/opencode/src/tool/cua.ts` + `cua.txt`:
   - `cua` tool (CLI bridge): `list-tools`, `describe <tool>`,
     `call <tool> {json} [--screenshot-out-file path]` via stdin JSON pipe
     (quote-safe on PS5.1). Registers in `registry.ts` after CodeGraphTool.
   - Output: tool result JSON (or file path for screenshots).
4. **Kernel add-ons** (prompt_kernel/addons.py):
   - G8 TOOL_ORACLE: append cua visual oracle line (screenshot/verify_state/
     browser probes for TUI + web assertions).
   - Tests: update test_addons.py, pytest, --install, baseline.json.
5. **Docs**: docs/tools-and-sidecars.md — cua-driver section (build recipe,
   daemon model, safety policy file CUA_DRIVER_POLICY_FILE).

## Non-goals (this plan)
- MCP server registration (`mcp.cua` config) — separate plan after CLI bridge
  proves the daemon lifecycle (auto-approve surface differs).
- TUI-permissions visual test scenario itself — follow-up task using this tool.

## Smoke Tests
1. bin\cua.cmd list-tools → exit 0, 64 tools [post-vendor] ✅ [Exact] 2026-09-08 exit 0, 64 tools listed.
2. bun typecheck (packages/opencode) → PASS ✅ [Exact] tsgo --noEmit exit 0 (session 20260908T062632Z_b59e2a04) after cua.ts + registry wiring.
3. python -m pytest prompt_kernel/tests/ -q → all green; --install sha pinned ✅ [Exact] 72 passed; installed=01468d1c...d9c4; baseline updated.
4. Tool smoke: call `get_desktop_state` through the daemon → JSON result ✅
   [Exact] 2026-09-10, daemon already running (pid 21676, doctor all [ok]:
   UIA works, 21 windows, interactive session attached, permission mode
   standard). `call get_desktop_state --screenshot-out-file` returned
   `{display:"primary", platform:"windows", screen_width:2560,
   screen_height:1440, screenshot_mime_type:"image/png"}` — full daemon
   round-trip proven, not just CLI-side describe/doctor.
5. Screenshot smoke: `call get_desktop_state --screenshot-out-file` → PNG
   written (804235 bytes) ✅ [Exact] 2026-09-10. Converted to JPEG via
   ffmpeg (`-q:v 4`, 310893 bytes) per user directive (screenshots should
   ride as JPEG, quality tuned to text-readability and no higher — full
   4K-ish desktop PNGs are needlessly large for a multimodal read-back).
   Read back the JPEG artifact (write-path oracle rule): text fully legible
   at q:v 4 on a 2560x1440 capture. cua.ts itself still writes PNG only
   (cua-driver has no JPEG output) — JPEG conversion is a caller-side step
   for now, not wired into the tool.

## Status: DONE (2026-09-10)

Daemon round-trip + screenshot artifact verified live (items #4/#5 above,
previously deferred). All 5 smoke items now Exact.
- bin/cua/cua-driver.exe vendored (release 0.24.0, doctor [ok] on this host).
- bin/cua.cmd shim → codegraph-style pattern.
- packages/opencode/src/tool/cua.ts + cua.txt; registered in registry.ts
  (import, yield*, Tool.init, builtin list — all four wiring points).
- Kernel G8 TOOL_ORACLE add-on: cua visual oracle line; pytest 72 passed;
  production prompt reinstalled; baseline.json pinned to 01468d1c...d9c4.
- docs/tools-and-sidecars.md §7.1: vendoring, rebuild recipe, daemon model,
  policy file, skill-guide index (partial vendoring per user request —
  index + links, never the full skill canvas).
