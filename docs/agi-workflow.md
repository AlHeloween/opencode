# AGI Mode Workflow — Review & Operations

**Status:** production (Local_Development)  
**Code:**
- `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx` — loop, persistence
- `packages/opencode/src/util/plan-status.ts` — progress + mechanical hygiene  
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
   plans/ + plans_completed/                              tools + permissions
   (mechanical reconcilePlans)
```

### Phases

| Phase | Wait for | Next |
|-------|----------|------|
| BOOTSTRAP | orch busy | ORCH_BUSY |
| ORCH_BUSY | orch idle | **reconcilePlans** → terminal or ORCH_DISPATCH |
| ORCH_DISPATCH | dispatch workers | WORKERS_BUSY |
| WORKERS_BUSY | all workers idle/error | WORKERS_COLLECT |
| WORKERS_COLLECT | **reconcilePlans** + send results to orch | ORCH_BUSY |

Safety: `MAX_TURNS=100`, `MAX_RUNTIME=24h`, `session.error` deactivates.

---

## Plan hygiene (mechanical standardization)

Aligned with root `AGENTS.md` Plan Maintenance. The runtime **owns file location**; the model still owns checkbox content and master-plan prose.

### Classification (`getPlanStatus`)

| Location | Open `[ ]`? | Class |
|----------|-------------|--------|
| `plans/` | yes | **active** |
| `plans/` | no | **misplaced** (should be completed) |
| `plans_completed/` | no | **completed** |
| `plans_completed/` | yes | **misplaced** (moved too early) |

- `[x]` and `[~]` count as done for a line; only `[ ]` is open.
- Progress bar: `completed/total plans` + tasks; appends `misplaced:N` when non-zero.

### Reconcile (`reconcilePlans(worktree)`)

| Condition | Action |
|-----------|--------|
| `plans/*` with no `[ ]` | **Move** → `plans_completed/` (subdir structure preserved; name collision → `_1` suffix) |
| `plans_completed/*` with open `[ ]` | **Move** → `plans/` (reopen incomplete work) |
| IO failure | Recorded in `ReconcileResult.errors`; status re-read after best-effort moves |

### True completion gate

```
isPlanHygieneClean(status) ⇔ active.length === 0 && misplaced.length === 0
```

AGI evolving / “all plans complete” runs **only** when hygiene is clean.  
**Do not** treat `active.length === 0` alone as success (fully checked files still under `plans/` are debt).

### When hygiene runs

1. **Before** orch terminal decision (after each new orch assistant message)  
2. **After** workers go idle (`WORKERS_COLLECT`), before feeding results to orch  

Toasts: moved count → info; reopened incomplete → warning.

### Hygiene debt injection

If misplaced remain (or files were reopened), and orch output is not already hygiene-focused, AGI **replaces** the next worker directive with a PLAN HYGIENE DEBT task (priority over new features).

### Worker footer (every directive)

`planHygieneWorkerFooter()` always appends:

- Mark `[x]` only when verified in code  
- Move finished plans to `plans_completed/`  
- Do not leave fully checked files in `plans/` or open `[ ]` in `plans_completed/`  
- Update master plan cross-references  

### API surface (`plan-status.ts`)

| Export | Role |
|--------|------|
| `getPlanStatus` | Snapshot |
| `reconcilePlans` | Mechanical moves |
| `isPlanHygieneClean` | Terminal predicate |
| `formatProgressBar` | TUI / prompts |
| `formatPlanHygiene` | Orch context block |
| `planHygieneWorkerFooter` | Worker directive suffix |
| `hasOpenItems` | Checkbox scan |

Tests: `packages/opencode/test/util/plan-status.test.ts`.

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

Workers run **build** (default `*` allow + **`destructive: deny`**). Shell exec is split: `bash` / `powershell` / `cmd` / `run` (all allow by default). Orchestrator inherits destructive deny and has limited edit paths. See `docs/startup-bootstrap.md` (permissions section).

| Risk | Behavior under AGI |
|------|---------------------|
| DESTRUCTIVE shell | TUI permission **destructive** (not bash/cmd/ps/run wildcards). Default **deny**; if set to ask, loop stays WORKERS_BUSY until user allows/rejects. |
| Permanent policy | `/permissions` → Shell & exec (Destructive, Bash, PowerShell, Cmd, Run) |
| Session "Always this cmd" | Until process restart only |

**Recommendation for unattended AGI:** keep Destructive = **Deny** so force-push/rm -rf never auto-run; keep normal bash/cmd/run as needed.

---

## Strengths

- Status-driven loop (busy/idle), not fragile text hashing  
- Shared module-level signals (toggle from command palette updates session badge)  
- **Mechanical plan hygiene** (location standardized without LLM)  
- Plan progress bar from `plans/` + `plans_completed/`  
- Evolving mode + improvement branches  
- Orchestrator memory file under `.opencode/data/memory/`

## Gaps / risks

| Issue | Severity | Mitigation / next step |
|-------|----------|------------------------|
| Worker stuck on permission while user is on another session | Medium | Footer shows permission count; switch to worker session to approve |
| Orchestrator format override fights agent prompt | Medium | Continue XML wrapper enforcement; consider dedicated orch prompt pack |
| Master plan cross-ref **text** after move | Low | Still model-driven; reconcile only moves files |
| Explore-verify before mark `[x]` | Medium | Convention in AGENTS.md; not yet a hard AGI phase |
| Empty orch output → continuation | Low | Already has continuation + empty-output recovery |

---

## Operator checklist

1. Open project worktree; ensure `plans/` has a master plan if you want progress tracking.  
2. `/permissions` — confirm **Destructive** is Deny (default); adjust Bash/PowerShell/Cmd/Run as needed.  
3. Toggle AGI (`<leader>o` / `/agi` / command palette). Timeline remains `<leader>g`.  
4. Approve constitution **destructive** prompts when workers need them.  
5. Re-toggle AGI after restart — orch/main sessions resume from `agi-state.json`.  
6. Prefer checkbox discipline: only `[x]` when code confirms; let reconcile move finished files.
