# ALGORITHM_CARD — task geometry hybrid

**Status:** Phase 1 done; reasoning.txt lean rewrite done  

**Scope:** opencode only  
**Style:** algorithm with comments — coding logic bound to real Python symbols

## Goal

Restore algorithmic routes (“void jail without routes”) without restoring full v3 essay.
Sierpinski + k-medoids **cut evaluation area** — finite medoids, not infinity.

## Prior art

- ADID Framework 15.4 Mode 1/2 + fractal + k-medoids
- `opencode_prompts_kernel.py` `k_medoids_modifications`, `PLANNING`
- Existing synthetic plan/build: `plan.txt` / `build-switch.txt` on last user (KV-safe)

## Design

| Surface | Where | Content |
|---------|-------|---------|
| **ALGORITHM_CARD** | System identity (shared) | Commented Python pipeline bound to kernel symbols |
| **plan.txt / build.txt** | Conversation tail synthetic | Mode-specific; plan↔build switch same model/session |
| **Kernel Python** | `opencode_prompts_kernel.py` | Real `select_planning_mode`, `select_fractal_model`, `run_task_geometry`, … |
| **Path order** | `assemblePathSystem` | rules → skills → env → AGENTS |

**[KV-CACHE]** plan/build **never** go in `agent.prompt` / system prefix — only synthetics on last user.

## Smoke Tests

### Baseline (before further edits)

```
cwd: packages/opencode
cmd: bun test test/session/system-compose.test.ts
expected: pass (algorithm card + order)
```

```
cwd: repo root
cmd: python -c "from opencode_prompts_kernel import select_planning_mode, select_fractal_model, run_task_geometry; print(run_task_geometry('fix x', ['a','b','c','d']))"
expected: mode_1, medoid_count < candidate_count when N>1
```

### Post-impl oracles

- [x] `algorithm_card.txt` exists; systemPromptParts includes algorithm between reasoning and kernel
- [x] build has no `agent.prompt`; `build.txt` injected in `insertReminders` when agent=build
- [x] pathSystem via `assemblePathSystem` (rules → skills → env → instructions)
- [x] system-compose tests pass (12/12)
- [x] kernel task-geometry helpers callable

## Tasks

- [x] Freeze ALGORITHM_CARD (commented Python)
- [x] Kernel symbols for card bindings
- [x] Wire card into compose / transform / llm
- [x] Path order fix
- [x] Build spine as conversation-tail synthetic (not system)
- [x] Tests green
- [x] Docs updated (system-prompt-order.md)
