# Plan: Inline 5 Single-Use @refs

**Goal**: Remove unnecessary indirection — 5 schemas referenced by exactly one gate should be inlined.

## Premises
- C1: `@SIGNAL_CLUSTER` used only by G1 → inline into G1_GROUND
- C2: `@EXPLORER_GOAL` used only by G6 → inline into G6_GROUND_PLAN
- C3: `@BUG_FIX_SCHEMA` used only by G8 → inline into G8_ORACLE
- C4: `@MSG_TAG` used only by G9 → inline into G9_CLEAN_STATE
- C5: `@BLOCKER` used only by G9 → inline into G9_CLEAN_STATE

## Tasks

### T1: Edit `prompts_kernel/reasoning/01_gates.txt`
- G1: replace `schemas: [@ACTION_CLASS, @SIGNAL_CLUSTER]` with inline SIGNAL_CLUSTER definition in gate description
- G6: replace `phases: [...]` with inline EXPLORER_GOAL
- G8: replace `schemas: [@STAMPS, @BUG_FIX_SCHEMA]` with inline BUG_FIX_SCHEMA
- G9: replace `schemas: [@CLEAN_NEXT_STATE, @MSG_TAG, @BLOCKER]` with inline MSG_TAG and BLOCKER

### T2: Remove unused schema definitions from `prompts_kernel/reasoning/03_schemas.txt`
- Remove `# @schema: signal_cluster`
- Remove `# @schema: explorer_goal` (wait, EXPLORER_GOAL is in 03_schemas.txt? Check)
- Actually these are @schema: markers — removing the marker removes the injected YAML

### T3: Update `prompts_kernel/reasoning/05_epistemic.txt`
- If BLOCKER or MSG_TAG definitions are here, remove/inline them

### T4: Reassemble + verify
- `python -c "from prompts_kernel import write_precompiled_kernel; write_precompiled_kernel()"`
- `python -c "from prompts_kernel._assemble_prompts_kernel import write_reasoning; write_reasoning()"`
- `python -m prompts_kernel.tools.refcheck` → expect fewer refs, still 100% resolved

### T5: Verify with guardrails
- `pwsh _build.ps1 check` → all 8 guards pass
