# Plan: WASM CLI Path Validation Sandbox

**Created:** 2026-07-05T11:12Z
**Status:** Research
**Severity:** High — security improvement for autonomous agent execution

## Goal

Validate CLI command paths through a WASM sandbox BEFORE executing the real command on the host. This acts as a "firewall for CLI" — tree-sitter parses the command, sandbox validates paths, executor runs only if validation passes.

## Architecture

```
Agent generates: "rm -rf D:\zPython\opencode\node_modules\cache"
                          │
                          ▼
              ┌─────────────────────┐
              │  tree-sitter (WASM) │ ← parse command AST
              │  Extract: rm, paths │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  Path Sandbox (WASM)│ ← validate paths against rules
              │  - Inside worktree? │
              │  - Not system dir?  │
              │  - Not .git/?       │
              └──────────┬──────────┘
                         │
                    ┌────┴────┐
                    │ PASS?   │
                    └────┬────┘
                   yes   │   no → reject + feedback
                         ▼
              ┌─────────────────────┐
              │  Host Executor      │ ← run real command
              │  (cmd.exe / bash)   │
              └─────────────────────┘
```

## Implementation Phases

### Phase 1: Path Extraction WASM Module
**What:** Compile a C/Rust module to WASM that extracts file paths from command strings.
**Why:** tree-sitter already parses commands in-process. We need a fast, sandboxed path validator.
**Output:** `path_validator.wasm` — takes command string + allowed roots, returns pass/fail + violations.

### Phase 2: Integration with bash.ts
**What:** Call the WASM validator in `bash.ts` before `cmd()` execution.
**Why:** Currently bash.ts uses tree-sitter + regex for path extraction. WASM sandbox adds deterministic validation.
**Where:** `src/tool/bash.ts` — before the `cmd()` call.

### Phase 3: Configurable Rules
**What:** Define validation rules in config (allowed roots, blocked patterns, etc.).
**Why:** Different projects have different security requirements.
**Config:** `opencode.jsonc` → `sandbox.rules` section.

## Dependencies

- tree-sitter WASM (already in dist)
- New WASM module for path validation (compile from C/Rust)
- WASI-compatible runtime (already have wasm modules in dist)

## Distribution

- Build: `packages/wasm/core/pkg/path_validator/`
- Copy to dist: `dist/wasm/core/pkg/path_validator/`
- Load in runtime: same pattern as `rdiff.wasm`, `json_repair.wasm`

## Acceptance Criteria

- [ ] WASM module extracts paths from bash/PowerShell commands
- [ ] Validation rejects paths outside worktree (unless external_directory allowed)
- [ ] Validation rejects system paths (/etc, C:\Windows, etc.)
- [ ] Validation rejects .git/ mutations
- [ ] No performance overhead > 5ms per validation
- [ ] Module included in dist build
- [ ] Tests pass for common command patterns
