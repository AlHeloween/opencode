# Plan: WASM CLI Path Validation — Agent Feedback

**Created:** 2026-07-05T11:12Z  
**Completed:** 2026-07-17  
**Status:** Done

## Goal

Validate CLI command paths through a WASM sandbox BEFORE executing, and **return the validation report to the agent** so it can self-correct. The sandbox does NOT block — it informs.

## Implementation (delivered)

### Phase 1 — TypeScript path validator
- [x] Shared module `packages/opencode/src/util/path-validator.ts`
- [x] Checks: double drive, system dirs, `.git`, outside worktree, missing, config blocked prefixes
- [x] Formats agent-facing warning with optional suggested fix
- [x] Wired in `bash.ts` before execution; warnings prepended to tool output

### Phase 2 — WASM path validator
- [x] C source: `packages/wasm/core/src/path_validator.c`
- [x] Built artifact: `packages/wasm/core/pkg/path_validator.wasm`
- [x] Makefile target `path_validator` + `_build_rust.ps1` / dist copy
- [x] Runtime prefers WASM; falls back to TS if load fails
- [x] Embedded via `wasm-embedded.ts` (`path_validator.wasm`) for compiled binary
- [x] Sidecar copy in `_build.ps1` → `dist/wasm/core/pkg/path_validator.wasm`
- [x] Startup health check in `wasm-health.ts`

### Phase 3 — Configurable rules
- [x] `opencode.json` / config schema: `sandbox` section
  - `enabled`, `system`, `git`, `outside`, `missing`, `blocked[]`

## Acceptance criteria

- [x] Agent receives clear feedback when paths have issues
- [x] Feedback includes suggestions (e.g. double-drive fix)
- [x] No hard block — command still runs; warnings prepended
- [x] Works on Windows (`D:\…`) and POSIX (`/…`)
- [x] Integration with bash tool + external_directory messaging
- [x] Module included in embed + dist sidecar
- [x] Tests: `packages/opencode/test/util/path-validator.test.ts` (11 pass)

## Key files

| Path | Role |
|------|------|
| `packages/wasm/core/src/path_validator.c` | WASM implementation |
| `packages/wasm/core/pkg/path_validator.wasm` | Built module |
| `packages/opencode/src/util/path-validator.ts` | TS API + WASM loader |
| `packages/opencode/src/util/wasm-embedded.ts` | Bun embed for binary |
| `packages/opencode/src/tool/bash.ts` | Pre-exec validation |
| `packages/opencode/src/config/config.ts` | `sandbox` schema |
| `_build.ps1` / `_build_rust.ps1` | Build + dist packaging |

## Rebuild notes

```powershell
# Rebuild WASM only (needs LLVM clang for wasm32)
& "C:\Program Files\LLVM\bin\clang.exe" --target=wasm32 -Oz -nostdlib `
  "-Wl,--no-entry" "-Wl,--export=pv_validate" "-Wl,--export=pv_version" `
  "-Wl,--import-memory" "-Wl,--allow-undefined" `
  -o packages/wasm/core/pkg/path_validator.wasm `
  packages/wasm/core/src/path_validator.c

# Full opencode dist (includes WASM embed + sidecar)
pwsh _build.ps1
```
