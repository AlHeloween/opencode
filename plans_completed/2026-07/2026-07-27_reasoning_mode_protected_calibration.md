# Protected Reasoning Mode calibration

## Context / goal

Make Reasoning Mode a project-calibrated, user-controlled diagnostic instrument
inside the existing unified Plan ↔ Build ↔ Reasoning message flow.

The mode is not the universal **REASONING Framework**. The framework remains a
stable epistemic protocol for every mode; Reasoning Mode removes agentic
capabilities so a user can observe and correct project-specific model behavior.

### Contract

1. Only the user changes mode. A model has no exit path from Reasoning Mode.
2. In Reasoning Mode, `memory` is the only exposed and executable built-in
   capability. This must be enforced centrally, not by each tool voluntarily
   asking for permission.
3. Project configuration cannot reopen Reasoning capabilities.
4. Reasoning memory is persistent backing storage, not a second system prompt.
   Its `read`/`write`/`append` interactions belong to the unified transcript,
   after project instructions. Do not inject a parallel memory snapshot on mode
   entry or after compaction.
5. Layer-1 compaction stays a same-agent synthetic continuity act. It must
   preserve the meaningful semantics of completed memory interactions while
   never injecting into a live reasoning/tool turn.
6. Mode text appears exactly once at an explicit transition. The calibration
   prompt must be minimal and must not manufacture autonomous work.

## Prior art

- reuse: local — `674f373015` established the completion gate for Layer-1
  synthetic summary injection; preserve that protocol rather than adding a
  compaction agent or a conventional compaction prompt.
- reuse: local — `be4d42f5d1` on `Trash_Started` documented Reasoning Mode as
  a calibration instrument. Its concept is restored separately from the
  REASONING Framework in `docs/reasoning-mode.md`.
- reuse: local — existing `MemoryTool`, `SessionCompaction`, mode-transition,
  agent-permission, and prompt tests are the implementation seams; extend
  these rather than creating a parallel mode/memory subsystem.

## Implementation steps

- [x] Record focused baselines and characterize the current tool-schema and
  execution escape paths.
- [x] Add a central agent-permission gate that filters tool schemas and blocks
  execution; make native Reasoning restrictions non-overridable by project
  agent configuration.
- [x] Add end-to-end Reasoning tests proving only `memory` is visible and that
  representative forbidden tools cannot execute, including a hostile project
  permission override or native-agent rename.
- [x] Define and test transcript fidelity for `memory.read` and a `memory`
  update across Layer-1 summary and compaction. Preserve the
  existing synthetic continuity flow; do not add memory prompt injection.
- [x] Keep a one-shot, non-agentic Reasoning transition tail. Correct the
  entry UI wording from “zero tools” to “memory only”.
- [x] Make summary resume language mode-aware: retain exact continuity state,
  but do not tell Reasoning Mode to prefer tools or edits.
- [x] Update `docs/reasoning-mode.md` and `docs/system-prompt-order.md` to
  describe the unified transcript, controlled user/Orchestrator transitions, one-shot mode transition,
  and synthetic compaction correctly.
- [x] Run focused tests, typecheck, and reconcile the plan only after all
  behavioral oracles pass.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test --timeout 30000 test/agent/agent.test.ts --test-name-pattern "reasoning agent software guardrail"` (`packages/opencode`) | current static policy test passes | 1 pass, 0 fail [Exact] |
| 2 | `bun test --timeout 30000 test/tool/memory.test.ts` (`packages/opencode`) | memory CRUD passes | 4 pass, 0 fail [Exact] |
| 3 | `bun test --timeout 30000 test/session/compaction.test.ts` (`packages/opencode`) | 73/73 pass | 73 pass, 0 fail [Exact] |
| 4 | `bun test --timeout 30000 test/session/prompt.test.ts --test-name-pattern "Layer-1 summary runs after a completed answer and resumes the agentic flow"` (`packages/opencode`) | completion-gated summary/resume passes | 1 pass, 0 fail [Exact] |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | focused SessionTools/registry tests (`packages/opencode`) | Reasoning resolves only native `memory`; denied schemas and MCP executors are absent |
| 2 | new hostile-config override test (`packages/opencode`) | project config cannot re-allow a Reasoning tool |
| 3 | new memory-compaction fidelity test (`packages/opencode`) | completed memory interaction semantics survive summary/compaction in the unified transcript |
| 4 | `bun test --timeout 30000 test/session/compaction.test.ts` (`packages/opencode`) | all tests pass |
| 5 | targeted Layer-1 prompt test (`packages/opencode`) | completed-turn gate and mode-aware resume pass |
| 6 | `bun typecheck` (`packages/opencode`) | exits 0 |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation only after baseline.
- [x] Post-implementation smoke passed before completion.

## Verification [Exact]

- Reasoning native-policy and hostile-config tests: 2 pass, 0 fail.
- Reasoning tool-registry surface: 2 pass, 0 fail (`memory` only; a custom
  same-named tool cannot shadow the initialized native memory tool).
- Reasoning SessionTools runtime map: 1 pass, 0 fail (only the native
  `memory` executor; MCP discovery itself is not called).
- Memory tool CRUD: 4 pass, 0 fail.
- Layer-1 summary tests: 2 pass, 0 fail with a 60-second test limit, including
  protected Reasoning resume.
- Compaction: 74 pass, 0 fail, including completed `memory.read` and
  `memory.append` transcript fidelity through `message*`.
- `bun typecheck`: exit 0.
