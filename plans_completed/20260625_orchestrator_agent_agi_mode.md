---
status: planned
owner: codex
created: 2026-06-25
priority: HIGH
reproduce:
  - cd packages/opencode && bun typecheck
  - Plan validated by explore agent against codebase
---

# Orchestrator Agent + AGI Mode Plan

## Goal

Create an "orchestrator" primary agent that autonomously drives development flow to completion — checking plan status after every turn, delegating implementation to sub-agents, verifying results, and moving completed plans to `plans_completed/`. Add "AGI mode" to the TUI that enables fully autonomous development with this agent.

## Abstract Definition

Per the ADID Framework (§II.1), the AGI Developer role includes:
- **Strategist2**: Defines mid-level goals and development sequence via AGI Reasoning Kernel
- **Analyst2**: Analyzes oracle output, declares tasks DONE based on verifiable conditions
- **Synthesizer**: Translates tasks into executable artifacts

The orchestrator agent embodies **Strategist2 + Analyst2** — a read-only reasoning agent that orchestrates the human's `plans/` backlog through to completion, delegating all implementation work to sub-agents (`coder`, `explore`, `researcher`, `general`) and verifying results.

## Formalization

```
Orchestrator = Strategist2 + Analyst2 (ADID Framework roles)
  Mode: primary
  Permissions: read, grep, glob, list, bash (typecheck + tests), task (sub-agent delegation), todowrite
  NOT: edit, write, pipeline (doesn't implement, delegates instead)

Orchestrator Loop:
  WHILE plans/ is not empty:
    1. read plans/ directory → list active plans
    2. select next plan from dependency graph
    3. delegate task to appropriate sub-agent: coder | explore | general | researcher
    4. verify result: typecheck + tests + explore audit
    5. if oracle passes: mark plan [x], move to plans_completed/
    6. if oracle fails: delegate correction to coder
    7. report progress after each turn
    8. if blocked: pause, flag, continue to next independent plan

AGI Mode (TUI):
  agent = orchestrator
  auto-continue = true (after each assistant message, trigger next turn)
  display = plan progress bar (N/M plans completed)
  stop condition = plans/ directory empty
```

## Structural Diagram

```
TUI: "AGI Mode" keybind / command
  │
  ├── Selects agent: "orchestrator" (primary, read-only, reasoning-focused)
  ├── Enables: auto-continue (no user input needed between turns)
  ├── Displays: plan progress bar (X of Y plans completed)
  └── Stops: when plans/ is empty OR user interrupts

Agent: orchestrator
  │
  ├── System prompt: ADID Framework §II.1 + AGI Reasoning Kernel §I.15
  │     Focus: reasoning, planning, verification — NOT tools/implementation
  │     Prefix: different from build/plan — no tool documentation, just role + methodology
  │
  ├── After each turn:
  │     1. Read plans/ directory → assess current state
  │     2. Compare with plans_completed/ → compute completion %
  │     3. Pick next actionable plan (dependency-respecting order)
  │     4. Delegate via task tool to sub-agent
  │     5. Receive result, verify (typecheck + tests)
  │     6. Move completed plan to plans_completed/
  │     7. Report progress
  │
  └── Delegation patterns:
        - "Implement X" → task(agent: coder, "implement plan item X")
        - "Verify Y against code" → task(agent: explore, "audit plan Y")
        - "Research approach for Z" → task(agent: researcher, "investigate Z")
        - "Plan architecture for W" → task(agent: general, "design W")
```

## Tasks

### Sub-Goal 1: Orchestrator Agent Definition (0.5 day)

- [ ] 1.1 Add `orchestrator` agent to BUILTIN_AGENTS in `packages/opencode/src/agent/agent.ts`
- [ ] 1.2 Mode: `"primary"` (selectable as main agent in TUI)
- [ ] 1.3 Permissions: read-only + task delegation + todowrite. Deny: edit, write
- [ ] 1.4 Description: "Autonomous development orchestrator — drives plans to completion, delegates implementation, verifies results. Based on ADID Framework Strategist2 + Analyst2."

### Sub-Goal 2: Orchestrator System Prompt (1 day)

- [ ] 2.1 Create `packages/opencode/src/agent/prompt/orchestrator.txt`
- [ ] 2.2 Content: ADID Framework role definition (Strategist2 + Analyst2), plan management methodology, delegation patterns, verification protocol
- [ ] 2.3 Different from build agent: no tool documentation, no code snippets. Pure reasoning methodology.
- [ ] 2.4 Include: plan reading conventions (`plans/` vs `plans_completed/`), markdown status syntax (`[ ]` vs `[x]`), dependency graph traversal
- [ ] 2.5 Include: oracle verification protocol (typecheck must pass, tests must pass, explore audit must confirm)
- [ ] 2.6 System prefix markers: `[ORCHESTRATOR]` or similar for agent self-identification in logs

### Sub-Goal 3: AGI Mode TUI (1 day)

- [ ] 3.1 Add "AGI Mode" keybind/command to TUI
- [ ] 3.2 Keybind: `<leader>a` or `/agi` slash command
- [ ] 3.3 On activation: switch primary agent to `orchestrator`, enable auto-continue
- [ ] 3.4 Display plan progress bar: `[████░░░░] 3/9 plans completed`
- [ ] 3.5 Auto-continue: after each assistant message completes, inject a synthetic user message to trigger next turn
- [ ] 3.6 Stop condition: `plans/` directory empty (all plans in `plans_completed/`)
- [ ] 3.7 Manual stop: `<leader>x` or `/stop` command interrupts AGI mode

### Sub-Goal 4: Plan Progress Tracking (0.5 day)

- [ ] 4.1 Add `planStatus()` utility: reads `plans/` + `plans_completed/`, returns `{ active: Plan[], completed: Plan[], completion: number }`
- [ ] 4.2 Add to orchestrator system prompt as a known function
- [ ] 4.3 Integrate with TUI progress bar component
- [ ] 4.4 Update AGENTS.md with orchestrator agent documentation

### Sub-Goal 5: Verification (1 day)

- [ ] 5.1 Launch orchestrator in AGI mode against a test project with 3 simple plans
- [ ] 5.2 Verify: orchestrator selects correct next plan based on dependencies
- [ ] 5.3 Verify: orchestrator delegates to coder sub-agent
- [ ] 5.4 Verify: after coder completes, orchestrator runs typecheck + tests
- [ ] 5.5 Verify: orchestrator moves completed plan to `plans_completed/`
- [ ] 5.6 Verify: auto-continue triggers next turn without user input
- [ ] 5.7 Verify: AGI mode stops when all plans completed
- [ ] 5.8 Verify: manual stop (Ctrl+C or `/stop`) interrupts correctly

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | Orchestrator agent appears in agent list | `agents.list()` includes "orchestrator" |
| 2 | Orchestrator agent is selectable as primary in TUI | `/agent orchestrator` switches successfully |
| 3 | AGI mode keybind activates orchestrator + auto-continue | TUI shows progress bar, agent = orchestrator |
| 4 | Orchestrator reads plans/ and selects next plan | Correct plan chosen based on dependency graph |
| 5 | Orchestrator delegates to coder via task tool | Coder sub-agent spawned with correct instructions |
| 6 | After coder completes, orchestrator verifies (typecheck) | Typecheck result captures in orchestrator output |
| 7 | Successful verification → plan moved to plans_completed/ | File moved, master plan updated |
| 8 | Failed verification → orchestrator delegates correction | Coder re-spawned with fix instructions |
| 9 | Auto-continue triggers next turn without user input | New user message auto-generated after assistant completes |
| 10 | AGI mode stops when plans/ is empty | Agent reports "All plans completed", auto-continue disengages |
| 11 | Manual stop (Escape or /stop) during AGI mode | Mode exits gracefully, current state preserved |
| 12 | Orchestrator system prompt differs from build agent | Grep confirms no tool documentation in orchestrator prompt |

## Orchestrator System Prompt (Draft)

```
You are the Orchestrator — an autonomous development agent implementing the
ADID Framework Strategist2 + Analyst2 roles (ADID_Framework_15_3.md §II.1).

## Your Role

You do NOT write code. You do NOT edit files. You are a reasoning engine that
orchestrates development by delegating to sub-agents and verifying results.

## Your Loop

1. READ: Check `plans/` directory. Identify active plans and their dependencies.
2. SELECT: Pick the next actionable plan (respect dependency order).
3. DELEGATE: Dispatch to the right sub-agent:
   - Implementation → `coder` agent
   - Codebase exploration → `explore` agent  
   - Research → `researcher` agent
   - Architecture/planning → `general` agent
4. VERIFY: After sub-agent completes, verify against oracle:
   - `bun typecheck` must pass with ZERO errors
   - Related tests must pass
   - Explore agent audits implementation against plan document
5. COMPLETE: If all oracles pass, mark plan items [x], move plan to `plans_completed/`.
6. REPORT: After each turn, output progress: "X of Y plans completed (Z%)"
7. CONTINUE: Auto-proceed to next plan. Stop when `plans/` is empty.

## Plan Conventions

- Active plans: `plans/` directory at repo root
- Completed plans: `plans_completed/` directory
- Plan items use `[ ]` (pending) / `[x]` (done) markdown checkboxes
- Master plan at `plans/20260625_deferred_architectural_master_plan.md`
- Priority plans at `plans/priority/`
- Emergency plans at `plans/emergency/`

## Verification Protocol

For each completed implementation:
1. Run typecheck: `cd packages/opencode && bun typecheck`
2. Run affected tests: `cd packages/opencode && bun test <test_files>`
3. Audit plan against code: deploy explore agent to verify implementation
4. All three must pass before plan is marked complete.

## Delegation Format

When delegating to a sub-agent, provide:
- Exact file paths to modify
- Specific plan item reference
- Expected oracle output
- Never ask sub-agents to plan — you do the planning, they execute.
```

## Effort Estimate

| Sub-Goal | Effort |
|----------|--------|
| 1. Agent Definition | 0.5 day |
| 2. System Prompt | 1 day |
| 3. AGI Mode TUI | 1 day |
| 4. Plan Progress Tracking | 0.5 day |
| 5. Verification | 1 day |

**Total: 4 days**
