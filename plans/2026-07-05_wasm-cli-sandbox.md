# Plan: WASM CLI Path Validation — Agent Feedback

**Created:** 2026-07-05T11:12Z
**Updated:** 2026-07-05T11:40Z
**Status:** Research
**Severity:** High — security + self-correction for autonomous agent

## Goal

Validate CLI command paths through a WASM sandbox BEFORE executing, and **return the validation report to the agent** so it can self-correct. The sandbox does NOT block — it informs. The agent is smart enough to fix its own commands if given clear feedback.

## Architecture

```
Agent generates: "rm -rf D:\D:\zPython\cache"
                          │
                          ▼
              ┌─────────────────────┐
              │  tree-sitter (WASM) │ ← parse command AST
              │  Extract: rm, paths │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  Path Validator     │ ← check paths against rules
              │  - Path exists?     │
              │  - Valid format?     │
              │  - Inside worktree? │
              │  - Not .git/?       │
              └──────────┬──────────┘
                         │
                    ┌────┴────┐
                    │ Issues? │
                    └────┬────┘
              yes        │        no
               ▼         │         ▼
    ┌──────────────┐     │   ┌──────────────┐
    │ Return report│     │   │ Execute cmd  │
    │ to agent     │     │   │ (host shell) │
    │ (agent fixes)│     │   └──────────────┘
    └──────────────┘     │
                         │
         Agent retries   │
         with fixed cmd  │
```

## Key Principle: Feedback, Not Blocking

The validator produces a structured report:
```
⚠ Path issues detected:
  1. D:\D:\zPython\cache — invalid: double drive letter
  2. /tmp/build — outside worktree (use external_directory permission)
  
Suggested fix: rm -rf D:\zPython\cache
```

The agent sees this report as tool output and can retry with corrected paths. This is:
- **Safer** than silent blocking (agent learns from mistakes)
- **Faster** than WASM sandbox for every command (only validate paths, not execute)
- **Simpler** to implement (no WASM compilation needed initially)

## Implementation Phases

### Phase 1: Simple Path Validator (no WASM, pure TypeScript)
**What:** Add `validatePaths()` to bash.ts that checks extracted paths before execution.
**Checks:** Path format, existence, worktree boundary, system dirs.
**Output:** Warning string appended to tool output if issues found.
**No WASM yet** — just regex + fs checks.

### Phase 2: WASM Path Validator
**What:** Compile path validation to WASM for deterministic, sandboxed checking.
**Why:** TypeScript validator can be bypassed; WASM is tamper-proof.
**Distribution:** `packages/wasm/core/pkg/path_validator.wasm`

### Phase 3: Configurable Rules
**What:** Validation rules in config (allowed roots, blocked patterns, etc.).

## Acceptance Criteria

- [ ] Agent receives clear feedback when paths have issues
- [ ] Agent can self-correct based on feedback
- [ ] No performance overhead > 10ms per validation
- [ ] Works on Windows (D:\ paths) and Linux (/ paths)
- [ ] Integration with existing permission system Currently bash.ts uses tree-sitter + regex for path extraction. WASM sandbox adds deterministic validation.
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
