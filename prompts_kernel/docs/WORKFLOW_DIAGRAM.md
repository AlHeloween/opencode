# Kernel Workflow Diagram

```
[SYSTEM INITIALIZATION]
       │
       ▼
  [@SV_FORMAT] ──(Context Anchor)──► [md5 / prev-md5 Chain]
       │
       ▼
 [IDENTITIES] ──(Mode Switch)──► [BASE_AGENT]
                                     │ (inherits)
                                     ├─► [BUILD_MODE] ──► Gates: G1..G9
                                     ├─► [PLAN_MODE]  ──► Gates: G1..G5
                                     └─► [SUB_AGENTS] ──► Target Gates
                                           (coder, explorer, orchestrator, etc.)

 [GATED WORKFLOW SPINE]
   [G1_GROUND] ──────► Reads Evidence ──► [EPISTEMIC_STATUS: Unknown->Guess]
        │
   [G2_DECOMPOSE] ───► Geometry Math  ──► [Manhattan L1 -> k-medoids -> CENTRAL_TASKS]
        │
   [G3_MASTER_PLAN] ─► Specs Plan    ──► [MASTER_PLAN_SCHEMA + SMOKE_CONTRACT]
        │
   [G4_AUTHORIZE] ───► Evaluates Risk ──► [EXECUTION_ENVELOPE / ACTION_CLASS]
        │                 │
        ├─(Obj)─► [G5_CONCERN_LOOP] ──► Loops back to G2
        │
   [G6_GROUND_PLAN] ─► Code Alignment ──► [Phase 0..2 Exploration]
        │
   [G7_IMPLEMENT] ──► Execution      ──► [CONSTITUTION_BLOCKS + ADID_OPS]
        │
   [G8_ORACLE] ─────► Verification   ──► [PASS: Mint SHA-256 Stamp (Exact) / FAIL: Demote]
        │
   [G9_CLEAN_STATE] ─► Closure       ──► [CLEAN_NEXT_STATE + Emit SV]
```
