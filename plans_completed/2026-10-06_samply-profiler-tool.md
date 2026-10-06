<!-- intention: give the agent a profiler — `samply` (mstange/samply) cloned to external/, built, vendored to bin/tools, and exposed as an opencode tool that records CPU profiles as Firefox-Profiler files -->
# samply profiler tool

sv: { keywords: { samply 0.30, profiler 0.25, tool 0.20, vendored-binary 0.15, firefox-profiler 0.10 }, dominant: "Vendor samply as a tool: record CPU profiles of commands/processes, save as Firefox Profiler JSON for later analysis." }

Owner (2026-10-06, verbatim): «Кстати для улучшения нашей жизни - https://github.com/mstange/samply клонируй в external, добавь в bin и сделай тул.»

## Design

- vendor: `external/samply` (clone 2026-10-06), build `cargo build --release` through cmd_runner, copy `target/release/samply.exe` → `bin/tools/samply.exe` (owner-authorized bin/ write; `bin/` is gitignored).
- tool `samply` (`src/tool/samply.ts` + `samply.txt`), modes (exactly one):
  - `command <argv...>`: `samply record --save-only -o <out> [--rate N] [--duration S] -- <cmd...>`;
  - `pid` (-p PID) or `all` (-a, Windows);
  - default output: `{Global.Path.data}/samply/profile-<ts>.jslb.gz`;
  - always `--save-only` — never opens the browser, never leaves a local server;
  - permission `samply` asked like `run` (it launches a command / attaches to a process).
- binary resolution: `{worktree}/bin/tools/samply.exe` → `Global.Path.bin` → PATH.
- registered: `registry.ts` (import + init + builtin list), `DEFAULT_KNOWN_TOOL_IDS` (dsml-normalizer), `KNOWN_BIN_TOOLS` (shell-constitution), docs §7.3.

## Evidence

- build: `cargo build --release` in `external/samply` → `Finished release … in 6m 48s`, exit 0 (cmd_runner 20261006T103107Z_a7603088).
- binary: `samply --version` → `samply 0.13.1`, exit 0 (20261006T103812Z_45130888).
- record smoke: `samply record --save-only -o .temp\samply-smoke.jslb.gz -- cmd /c exit` → «Saved profile to …», exit 0; profile **6 626 bytes** (20261006T103823Z_e69a2a3a + `Get-Item .Length`).
- tests: `bun test test/tool/registry.test.ts test/tool/samply.test.ts test/tool/shell-constitution.test.ts` → **46 pass / 0 fail** (20261006T103845Z_2d021425); `bun typecheck` exit 0 (20261006T103911Z_c7e980f0).
- the earlier registry timeouts (3× 5 s) were measured under cargo build CPU load; clean re-run is green — flake, not regression.

## Tasks

- [x] T0 clone `https://github.com/mstange/samply` → `external/samply`.
- [x] T1 `cargo build --release` (cmd_runner).
- [x] T2 vendor → `bin/tools/samply.exe`.
- [x] T3 `samply.ts` + `samply.txt` + registry wiring + `KNOWN_BIN_TOOLS` + `DEFAULT_KNOWN_TOOL_IDS` + docs.
- [x] T4 tests + focused run + record smoke.
- [x] T5 `_build.ps1`, `_progress_log.md` entry, commit naming this plan.

## Risks / residual

- `pid`/`all` attach modes may need elevation for some processes on Windows; failures surface samply's stderr verbatim (not hidden).
- profile inspection happens via `samply load <file>` (opens the Firefox Profiler UI locally) — that stays a user-side action, not a tool action.
