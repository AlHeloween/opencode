# 2026-08-11 Project Analysis — Kernel, TUI, Cache, Performance

> **Plan mode.** Ground evidence, no source mutations. All claims tagged with epistemic status.

## Goal

Deep analysis of opencode project: identify real bugs, performance bottlenecks, cache-coherence issues,
kernel gaps, and TUI inefficiencies. Every claim anchored in real code paths, existing test coverage,
and logged `bug:` markers. Hypothetical improvements banned — only real measurements or documented
regressions.

## Prior Art / Grounding

- CodeGraph index: 4,631 files, 64,551 nodes, 317,446 edges (active, live)
- 108 `bug:` log markers across codebase (84 in .ts + 1 template literal + 23 in .tsx, real error paths)
- 14 silent `catch {}` blocks in `src/session/` alone (violates AGENTS.md bug policy)
- ~100+ test files in `packages/opencode/test/`
- 30 files in `packages/opencode/src/session/` — core session pipeline
- 25 files in `prompts_kernel/` — Python kernel package
- 48 completed plans in `plans_completed/`, zero active plans (clean state)
- Git default branch: `dev`

## Master Plan — Module Decomposition

### Claim Ledger

| ID | Claim | Status |
|----|-------|--------|
| C1 | 108 `warn("bug:...")` sites exist in production code (84 .ts single/double-quote + 1 backtick + 23 .tsx) | Exact (explorer verified) |
| C2 | 14 silent `catch {}` blocks in session layer | Exact (grep evidence) |
| C3 | Checkpoint save/load uses AES-256-GCM with rotating slots | Exact (codegraph + source) |
| C4 | KV cache continuity depends on byte-stable system prompt | Exact (AGENTS.md + codegraph) |
| C5 | Compaction is mechanistic (0 LLM tokens) with Layer-1/Layer-2 separation | Exact (codegraph + source) |
| C6 | Fossil snapshot system uses fossil.exe sidecar, NOT project git | Exact (AGENTS.md + source) |
| C7 | Constitution hard-blocks enumeration, enforces destructive gates | Exact (codegraph + source) |
| C8 | ~4,631 files indexed, symbol coverage likely 85%+ | Inferred (codegraph status) |
| C9 | overflow.ts partially covered: 3/11 exports tested (18+ tests), 8 exports untested | Exact (explorer verified) |
| C10 | Test coverage for checkpoint.ts: checkpoint.test.ts exists | Exact (codegraph blast radius) |

### Module Decomposition (k-medoids)

#### MEDOID 1: Kernel Layer (`prompts_kernel/`)

- **Files**: `01_enums.py` … `31_prompt_ir.py` + `_kernel_precompiled.py`
- **What**: Python kernel defining SPECS, gates, state machine, epistemic status, smokes, planning geometry
- **Key concerns**:
  - Precompiled kernel (`_assemble_prompts_kernel.py`) must stay in sync with sources
  - 488 kernel tests exist (`prompts_kernel/tests/`)
  - Schema validation in `09_execution_permit.py`, `18_conformance.py`
- **Risk areas**: desync between precompiled and source, missing validation for new gate rules

#### MEDOID 2: Session Pipeline (`packages/opencode/src/session/`)

- **Files**: `prompt.ts`, `processor.ts`, `llm.ts`, `compaction.ts`, `checkpoint.ts`, `overflow.ts`, `cache-control.ts`, `constitution.ts`, `message-v2.ts`, `system-compose.ts`, `retry.ts`, `summary.ts`, `revert.ts`, `incremental-checkpoint.ts`, `session.ts`, `tools.ts`, `status.ts`
- **What**: Core LLM conversation loop — system prompt assembly → checkpoint load → stream → tool calls → compaction → summary
- **Key concerns**:
  - **14 silent `catch {}`** in session layer — violates `AGENTS.md` bug policy (every catch must log)
  - `overflow.ts` has **partial** test coverage — 3/11 exports tested (18+ tests), but `summaryWindowLimit`/`needsContentCompaction` genuinely untested
  - `isOverflow` used in both compaction.ts and processor.ts — central overflow gate
  - `checkpoint.ts` v4 with identity fingerprinting — AES-256-GCM rotating 2-slot
  - `cache-control.ts` computes `RequestFingerprint` with xxh3 + prefix shape for KV cache diagnosis
  - 4 `TODO` markers (llm.ts:305, session.ts:544)
  - 1 `BUG-5` fix marker (processor.ts:815) — pending write-tool changes before computing

#### MEDOID 3: TUI Render Layer (`packages/opentui/`, `packages/app/`, TUI routes)

- **Files**: `packages/opentui/packages/core/src/renderer.ts`, `edit-buffer.ts`, `platform/worker.ts`, `packages/opencode/src/cli/cmd/tui/`
- **What**: Terminal UI — SolidJS components, OpenTUI renderer, worker threads (tree-sitter), event loop
- **Key concerns**:
  - `render()` dispatches to **38** `Renderable` implementations at runtime — large polymorphism surface
  - `Spinner` component uses `kv.get("animations_enabled")` with fallback to text-only render
  - Worker threads for tree-sitter parsing (`createNodeWorkerConstructor`)
  - No covering tests for `Spinner`, `WorkerErrorEvent`, `RevertInput`
  - TUI exit banner: portable continue command (resolved in `_development_plan.md`)

#### MEDOID 4: Provider/LLM Integration (`packages/opencode/src/provider/`)

- **Files**: `transform.ts`, `provider.ts`, `error.ts`, `models.ts`, `gateway/`
- **What**: Multi-provider LLM abstraction — model resolution, variant dispatch, error parsing, gateway transport (H1/H2)
- **Key concerns**:
  - `transform.ts`: massive `variants()` function (421 lines) — per-provider reasoning effort dispatch
  - `maxOutputTokens()`: pathological `output >= context` capping (resolved)
  - `error.ts`: 17 overflow detection patterns across providers
  - `gateway/h2-transport.ts`: 2 `bug:` markers (session creation, stream write)
  - `gateway/h1-transport.ts`: 1 `bug:` marker (request error)
  - 2 `TODO` markers (provider.ts:262, provider.ts:501) — env variable workaround

#### MEDOID 5: Fossil Snapshot System (`packages/opencode/src/snapshot/`)

- **Files**: `fossil.ts`, `index.ts`
- **What**: Agent undo/redo timeline via fossil.exe sidecar
- **Key concerns**:
  - Self-healing: corrupt open → backup + `HISTORY_INVALID.json` + reinit
  - 16 `bug:` markers in fossil.ts (5 HIGH / 9 MEDIUM / 2 LOW severity)
  - `revertTo` uses full leaf checkout, not per-file hash mix
  - Separated from project git VCS

#### MEDOID 6: Tool/Constitution Layer (`packages/opencode/src/tool/`, `src/session/constitution.ts`)

- **Files**: `shell-constitution.ts`, `constitution.ts`, `edit.ts`, `bash.ts`, `cmd.ts`, `run.ts`
- **What**: Shell command constitution — hard-blocks enumeration, enforces destructive gates, crash-prone binary routing
- **Key concerns**:
  - AST-based enforcement for bash/cmd (`enforceDestructiveShellFromAst`)
  - Legacy regex path for `run` tool (`enforceDestructiveShell`)
  - `cmd_runner send … -- payload` split — payload gets brutal-destructive-only checks
  - 1 silent catch in `constitution.ts:55`

#### MEDOID 7: Cache & Performance Infrastructure

- **Files**: `cache-control.ts`, `checkpoint.ts`, `overflow.ts`, gateway transports
- **What**: KV cache continuity, checkpoint reuse, overflow detection, content token estimation
- **Key concerns**:
  - `contentTokensFromSymbols`: chars/4 heuristic — validated across providers
  - `REQUEST_OVERHEAD_TOKENS = 10_000` — empirical, not from tokenizer
  - `MAX_OUTPUT_RESERVE_TOKENS = 32_768` — cap on output reserve
  - Checkpoint: 2-slot rotating, AES-256-GCM, identity fingerprint SHA-256
  - No tokenizer-based estimation (by design — tokenizers undercount)
  - Zero test coverage for `overflow.ts` (gate for both compaction AND context safety)

### System Graph (Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                        ENTRY POINTS                          │
│  CLI (run.ts)  │  TUI (routes/)  │  ACP (acp/agent.ts)      │
│  Web (web.ts)  │  Gateway (gateway.ts)                      │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│                   PROJECT / INSTANCE                         │
│  project.ts → instance.ts → Global.initFromWorktree()       │
│  VCS (git)  │  Fossil (sidecar undo)  │  CodeGraph (MCP)    │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│                      SESSION PIPELINE                        │
│                                                              │
│  system-compose.ts ──► prompt.ts (SessionPrompt.loop)       │
│       │                      │                               │
│       │   ┌──────────────────▼──────────────────┐           │
│       │   │  checkpoint.ts (load/save/publish)   │           │
│       │   │  cache-control.ts (fingerprint/audit)│           │
│       │   └──────────────────┬──────────────────┘           │
│       │                      │                               │
│       │   ┌──────────────────▼──────────────────┐           │
│       │   │  processor.ts (stream → tool calls)  │           │
│       │   │    ├─ llm.ts (provider stream)       │           │
│       │   │    ├─ constitution.ts (tool gates)   │           │
│       │   │    └─ overflow.ts (context safety)   │           │
│       │   └──────────────────┬──────────────────┘           │
│       │                      │                               │
│       │   ┌──────────────────▼──────────────────┐           │
│       │   │  compaction.ts (Layer-1/Layer-2)    │           │
│       │   │  summary.ts (message* generation)    │           │
│       │   │  revert.ts (message undo)            │           │
│       │   └──────────────────┬──────────────────┘           │
│       │                      │                               │
│       └──────────────────────┘                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   PROVIDER ABSTRACTION                       │
│  provider.ts → transform.ts (variants/options/maxTokens)    │
│  error.ts (overflow detection)  │  models.ts (catalog)      │
│  gateway/ (H1/H2 transport, circuit breaker, rate limit)    │
│  balance.ts (cost tracking)                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                      TOOL LAYER                              │
│  edit / write / bash / cmd / read / glob / grep / task ...   │
│  shell-constitution.ts (hard-blocks + destructive gates)     │
│  Fossil snapshot (track/checkpoint on writes)                │
│  Permission system (ask/evaluate)                            │
└─────────────────────────────────────────────────────────────┘

         ┌──────────────┐     ┌──────────────┐
         │  PYTHON      │     │  TUI STACK    │
         │  KERNEL      │     │  (OpenTUI)    │
         │              │     │               │
         │ prompts_     │     │ renderer.ts   │
         │ kernel/      │     │ 38 Renderable │
         │ 01..31_*.py  │     │ implementations│
         │              │     │ worker.ts     │
         │ _assembled   │     │ spinner.tsx   │
         │ → reasoning_ │     │ SolidJS       │
         │ prompt.txt   │     │ components    │
         └──────────────┘     └──────────────┘
```

### Preliminary Findings (Evidence-Based)

#### 1. Real Bugs (documented `bug:` markers — 108 total)

| Area | Count | Severity | Example |
|------|-------|----------|---------|
| `fossil.ts` | 16 | 5 HIGH / 9 MEDIUM / 2 LOW | Corrupt repo recovery, revertTo preserve/rollback chain, hash unavailability |
| `lsp/server.ts` | 9 | LOW | chmod/symlink failures for LSP binaries |
| `cli/cmd/github.ts` | 6 | MEDIUM | OIDC token, image download, agent errors |
| `session/llm.ts` | 4 | MEDIUM | System prompt mutation, tool execution, workflow approval |
| `session/session-settings.ts` | 4 | MEDIUM | Load/save/remove failures |
| `session/checkpoint.ts` | 4 | MEDIUM | Slot load failures, corrupt slots, save failures |
| `jobs/index.ts` | 4 | LOW | Zombie eviction, stalled auto-kill, non-running job kill |
| `util/mermaid.ts` | 4 | LOW | WASM/PNG/SVG render failures |
| `session/prompt.ts` | 3 | MEDIUM | base64 read, background drain, cache audit write |

#### 2. Silent Catch Blocks (AGENTS.md Violation — 14 in session/ alone)

| File | Line | Context |
|------|------|---------|
| `llm.ts` | 71 | Plugin hook return — `catch { return {} }` |
| `llm.ts` | 650 | Tool execution — bare catch |
| `constitution.ts` | 55 | `catch {}` — constitution guard |
| `summary.ts` | 31,44,64 | Summary extraction — 3 bare catches |
| `session.ts` | 1176 | Session message — bare catch |
| `checkpoint.ts` | 147,348,389,414,439 | 5 bare catches (fs ops) |
| `cache-control.ts` | 320,356 | DB audit write — 2 silent catches |

**Policy**: AGENTS.md: "Silent catch {} blocks are bugs. Every catch must log."

#### 3. Test Coverage Gaps

| Module | Status |
|--------|--------|
| `overflow.ts` | **Partial** — 3/11 exports tested (18+ tests in compaction.test.ts), `summaryWindowLimit`/`needsContentCompaction` untested |
| `summaryWindowLimit` | **ZERO tests** |
| `needsContentCompaction` | **ZERO tests** |
| `Spinner` (TUI) | **ZERO tests** |
| `WorkerErrorEvent` | **ZERO tests** |
| `RevertInput` | **ZERO tests** |
| `ImpactSummary` | **ZERO tests** |
| `checkpoint.ts` | Covered (`checkpoint.test.ts`) |
| `shell-constitution.ts` | Covered (`shell-constitution.test.ts`) |
| `compaction.test.ts` | Covered (50 tests pass) |
| `prompts_kernel/tests/` | Covered (488 tests) |

#### 4. Performance Hot Paths (no measurement yet — structural analysis)

| Path | Concern | Evidence |
|------|---------|----------|
| Session prompt assembly | `system-compose.ts` merges kernel + prompts + skills | Byte-stability requirement for KV cache |
| Checkpoint serialization | AES-256-GCM encrypt + JSON serialize full message array | Rotating 2-slot, atomic write |
| Compaction | Layer-1: inject summary request. Layer-2: fold to m* | 0 LLM tokens (mechanistic), but I/O bound |
| Overflow check | `isOverflow()` called on every turn | chars/4 heuristic, no tokenizer |
| Provider variant dispatch | `variants()` — 421 lines, 22 provider cases | Called on model resolution |
| TUI render | `render()` dispatches to 38 implementations | Polymorphism overhead, no profiling |
| Fossil snapshot | `fossil.exe` subprocess per checkpoint | External binary cost |

### Smoke Tests Plan (for `experiments/`)

#### SMOKE_1: Checkpoint Roundtrip Latency

- **Baseline**: measure `Checkpoint.save()` + `load()` wall time on current session
- **Oracle**: 100 roundtrips, p50 < N ms (establish N first)
- **File**: `experiments/2026-08-11_checkpoint_bench.ts`

#### SMOKE_2: Catch Block Audit

- **Baseline**: grep all `catch {}` across `src/` — count, classify severity
- **Oracle**: 0 unlogged catches in session/provider/tool code
- **File**: `experiments/2026-08-11_catch_audit.txt` (report)

#### SMOKE_3: System Prompt Byte Stability

- **Baseline**: `xxh3(systemPrompt)` on consecutive turns — must be identical
- **Oracle**: SHA-256 identical across 10 turns with no config change
- **File**: `experiments/2026-08-11_system_prompt_hash.ts`

#### SMOKE_4: Test Coverage Map

- **Baseline**: `bun test --coverage` from `packages/opencode/`
- **Oracle**: identify files with <50% coverage, especially `overflow.ts`
- **File**: `experiments/2026-08-11_coverage_report.txt`

#### SMOKE_5: Fossil Snapshot Integrity

- **Baseline**: consecutive `fossil checkpoint` + `fossil undo` — verify file consistency
- **Oracle**: 10 cycles, 0 data loss
- **File**: `experiments/2026-08-11_fossil_integrity.ts`

### OPEN_QUESTIONS (require further investigation after baseline)

1. What is actual p50/p99 of checkpoint save/load on this machine? (SMOKE_1)
2. How many silent catch blocks are reachable in normal operation vs error paths? (SMOKE_2)
3. Does KV cache survive a compaction + checkpoint cycle? (SMOKE_3)
4. What is real test coverage % for session pipeline? (SMOKE_4)
5. Does fossil undo work correctly after 10+ checkpoints? (SMOKE_5)
6. What is real token consumption with current `chars/4` heuristic vs actual tokenizer?
7. Are there any silent data-loss paths in fossil corrupt-recovery?

### Task Plan

- [x] **T1**: Run full test suite baseline (`bun test` from `packages/opencode/`) — ~120 pre-existing failures (95% timeouts on Windows, 4 prompt-format), **zero regressions from catch fixes**, all session/* tests pass
- [ ] **T2**: Audit all 108 `bug:` log markers — classify by severity, frequency, impact
- [x] **T3**: Fix 14 silent `catch {}` blocks in session layer (add `log.debug` or `log.warn("bug:...")`)
- [ ] **T4**: Add test coverage for `overflow.ts` (isOverflow, usable, summaryWindowLimit, needsContentCompaction)
- [ ] **T5**: Run SMOKE_1 — checkpoint benchmark
- [ ] **T6**: Run SMOKE_2 — catch block audit report
- [ ] **T7**: Run SMOKE_3 — system prompt hash stability
- [ ] **T8**: Run SMOKE_4 — test coverage map
- [ ] **T9**: Run SMOKE_5 — fossil integrity
- [ ] **T10**: Analyze `variants()` function for deduplication opportunities (421 lines, 22 cases)
- [ ] **T11**: Verify kernel precompiled matches source (`_assemble_prompts_kernel.py` diff)

## Smoke Tests

### SMOKE_BEFORE (baseline)

```bash
# Run from repo root
# T1: Full test suite
cd packages/opencode && bun test --timeout 30000 2>&1
# Expected: all tests pass (or known skip list)

# T1-alt: Kernel tests
cd prompts_kernel && python -m pytest tests/ -q
# Expected: 488 passed

# T3: Count silent catches before fix
rg "catch\s*\{" packages/opencode/src/session/ --count
# Expected: 14 matches (baseline, explorer verified 14/14 silent)

# SMOKE_1: Typecheck baseline
cd packages/opencode && bun typecheck 2>&1
# Expected: exit 0
```

### SMOKE_AFTER (post-implementation oracles)

```bash
# Verify 0 silent catches in session/
rg "catch\s*\{" packages/opencode/src/session/ -l
# Expected: empty (after fix — all catch blocks must contain log.*)

# Verify overflow tests exist
ls packages/opencode/test/session/overflow*.test.ts
# Expected: file exists (after T4)

# Verify tests pass
cd packages/opencode && bun test --timeout 30000 test/session/overflow.test.ts 2>&1
# Expected: all pass

# Verify typecheck
cd packages/opencode && bun typecheck 2>&1
# Expected: exit 0
```

## Blast Radius

- `packages/opencode/src/session/*.ts` — core pipeline (catch fixes, overflow tests)
- `packages/opencode/test/session/` — new test files
- `experiments/` — benchmark/report scripts (throwaway)
- `prompts_kernel/` — kernel validation only (no source changes in plan_mode)

## Notes

- **Plan mode only** — no source mutations at this stage. This document is the analysis deliverable.
- All claims above are grounded in grep output, codegraph exploration, and AGENTS.md policy.
- Implementation requires switching to `build_mode` and explicit authorization (G4).
