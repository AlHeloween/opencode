# AGI Mode Workflow — Review & Operations

**Status:** production (Local_Development)  
**Code:** `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`  
**Last reviewed:** 2026-07-17

---

## Architecture

```
┌─────────────────────┐         directives (XML)        ┌──────────────────┐
│  Orchestrator       │ ──────────────────────────────► │  Worker (main)   │
│  agent: orchestrator│ ◄────────────────────────────── │  agent: build    │
│  session: orch_*    │      results / plan status      │  session: main   │
└─────────────────────┘                                 └──────────────────┘
         │                                                       │
         │  both sessions persisted in                           │
         │  {data}/state/agi-state.json                          │
         ▼                                                       ▼
   plans/*.md progress                                    tools + permissions
```

### Phases

| Phase | Wait for | Next |
|-------|----------|------|
| BOOTSTRAP | orch busy | ORCH_BUSY |
| ORCH_BUSY | orch idle | parse directives → ORCH_DISPATCH |
| ORCH_DISPATCH | dispatch workers | WORKERS_BUSY |
| WORKERS_BUSY | all workers idle/error | WORKERS_COLLECT |
| WORKERS_COLLECT | send results to orch | ORCH_BUSY |

Safety: `MAX_TURNS=100`, `MAX_RUNTIME=24h`, `session.error` deactivates.

---

## Persistence (daily use)

| Field | Stored | Notes |
|-------|--------|-------|
| `orchSessionID` | yes | Reused on AGI re-toggle if session still exists |
| `mainSessionID` | yes | Current TUI session preferred |
| `evolvingMode` | yes | Survives restart |
| `cycleCount` / `turnCount` | yes | Counters restored; turn resets on activate |
| Path | `{worktree}/.opencode/data/state/agi-state.json` | Portable with project |

---

## Permissions & constitution (AGI)

Workers run **build** (default `*` allow + `destructive: ask`). Orchestrator has `destructive: ask` and limited edit paths.

| Risk | Behavior under AGI |
|------|---------------------|
| DESTRUCTIVE shell | TUI permission prompt **destructive** (not bash:*). Loop stays WORKERS_BUSY until user allows/rejects. |
| Permanent policy | `/permissions` → Destructive shell → Ask / Allow / Deny (config) |
| Session "Always this cmd" | Until process restart only |

**Recommendation for unattended AGI:** set Destructive = **Deny** in `/permissions` so force-push/rm -rf never auto-run; keep normal bash/edit as needed.

---

## Strengths

- Status-driven loop (busy/idle), not fragile text hashing  
- Shared module-level signals (toggle from command palette updates session badge)  
- Plan progress bar from `plans/`  
- Evolving mode + improvement branches  
- Orchestrator memory file under `.opencode/data/memory/`

## Gaps / risks (review findings)

| Issue | Severity | Mitigation / next step |
|-------|----------|------------------------|
| Worker stuck on permission while user is on another session | Medium | Footer shows permission count; switch to worker session to approve |
| Orchestrator format override fights agent prompt | Medium | Continue XML wrapper enforcement; consider dedicated orch prompt pack |
| Empty orch output → continuation spam | Low | Already has continuation + empty-output recovery |
| Cost estimate is rough GPT-4 rates | Low | Cosmetic only |
| Multi-worker IDs beyond main | Low | Parser supports multiple; UI mainly uses main worker |
| Compaction mid-AGI | Handled | session_status compacting treated as busy |

---

## Operator checklist

1. Open project worktree; ensure `plans/` has a master plan if you want progress tracking.  
2. `/permissions` — set **Destructive shell** to Ask (default) or Deny for safer autonomy.  
3. Toggle AGI (`<leader>g` / command palette).  
4. Approve constitution **destructive** prompts when workers need them.  
5. Re-toggle AGI after restart — orch/main sessions resume from `agi-state.json`.
