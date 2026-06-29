---
status: active
owner: codex
created: 2026-06-28
reproduce:
  - cd packages/opencode && bun typecheck
  - Plans validated by explore agent against codebase
---

# WASM Core Framework — Kaizen Master Index

## Goal

Replace CPU-bound TypeScript hot paths with C/Rust→WASM modules.
Each sub-plan is independent — ship one, verify, move to next.
Every module has TypeScript fallback. Zero risk to existing codebase.

## Sub-Plans (Independent — any order)

| # | Plan | What | Lang | Effort | Status |
|---|------|------|------|--------|--------|
| 1 | `20260628_wasm_tokenizer.md` | BPE encoder → WASM | C | 1-2 days | [x] Done |
| 2 | `20260628_wasm_json_repair.md` | JSON repair → WASM | C | 1-2 days | [x] Done |
| 3 | `20260628_wasm_diff.md` | Myers diff → WASM | C | 2-3 days | [x] Done |
| 4 | `20260628_wasm_treesitter.md` | Tree-sitter unification | Prebuilt wasm | 1 day | [x] Done (2026-06-29 — prebuilt grammars) |
| 5 | `20260628_model_routing.md` | Model route optimization | TS | 1-2 days | [x] Done |

## Build Chain

```
packages/wasm/core/
├── Makefile              ← clang --target=wasm32 + wasm-opt -Oz
├── Cargo.toml            ← Rust crate (tree-sitter only)
├── src/
│   ├── tokenizer.c       ← Sub-plan 1: C BPE tokenizer
│   ├── json_repair.c     ← Sub-plan 2: C JSON repair
│   ├── diff.c            ← Sub-plan 3: C Myers diff
│   └── parser.rs         ← Sub-plan 4: Rust tree-sitter
├── pkg/                  ← compiled .wasm outputs
└── loader.ts             ← single JS entry point

Each .c file compiles independently: `make tokenizer` builds only tokenizer.
```

## Oracle Gates (per sub-plan)

Each sub-plan ships when:
- `make <module>` compiles with zero warnings
- Parity tests pass (TS vs WASM output identical)
- Existing tests pass (zero regressions)
- `bun typecheck` — clean

## Execution Order (Recommended)

```
1. Tokenizer (C)  ← highest ROI: runs on EVERY message
2. JSON repair (C) ← runs on every tool call
3. Diff (C)        ← independent, runs on demand
4. Tree-sitter (Rust) ← independent, replaces CDN loads
5. Model routing (TS) ← independent, startup optimization
```

Any order works — they share no code dependencies. Only shared build chain (Makefile).

## Current State

- Working tree: clean
- Existing WASM: `packages/wasm/markdownify/` (Rust→WASM pattern proven)
- Language split: C for pure algorithms (no GC, ~10KB per module), Rust for tree-sitter ecosystem
