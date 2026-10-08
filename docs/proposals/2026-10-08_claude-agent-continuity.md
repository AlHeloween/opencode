# Proposal to the Claude Code team — continuity for an agent that commands

- status: DRAFT (owner, 2026-10-08: «надо потом оформить как пропосал к разработчику клауда»); to be finished and sent
  by the owner's decision.
- sv: { keywords: { agent-continuity 0.35, scheduled-session-resume 0.25, agent-callable-compact 0.20, unattended-permission-profile 0.12, measured-on-a-fleet 0.08 },
        dominant: "An orchestrating Claude needs the continuity its workers already have: one resumable session, a compact it can call, and a permission profile for unattended runs." }

## The situation (measured on this host, 2026-10-08)

We run a fleet: up to 3 opencode robots (DeepSeek V4.1 Flash) do the work; Claude orchestrates and verifies. An
hourly Claude Code scheduled task checks the robots, runs their oracles, refills the slots.

- **The workers have continuous memory, the commander does not.** Each robot lives in one session: it compacts itself
  before a task and writes its memory while working, so experience accumulates. Every scheduled Claude run starts
  blank and must re-derive the fleet state from files (a queue file, a session registry, logs, tickets) — the
  orchestrating role gets the weakest memory in the system.
- **Unattended runs stalled on approvals.** The task ran in the `default` permission mode (no settings tier set
  `permissions.defaultMode`); each run writes new command strings, so stored approvals never covered the next run.
  Workaround: `permissions.defaultMode: "auto"` in the project's local settings, plus a stable CLI for the orchestrator.
- **The agent cannot fold its own window.** `/compact` is the user's; the agent can only persist handles and hand off
  to a fresh session — continuity by re-reading, not by memory.

## The asks

1. **A scheduled task that resumes ONE session** (opt-in): each run continues the previous conversation instead of
   starting fresh, with compaction between runs — the orchestrator keeps its own experience the way the workers do.
2. **An agent-callable compact at a closed boundary** (with a required reason, logged), so a long-lived session folds
   itself before a task instead of waiting for the user or the auto threshold.
3. **A permission profile per scheduled task** (mode + allow rules bound to the task, visible in its settings), so an
   unattended run never waits on a prompt nobody is there to answer — and a prompt that does appear is reported as an
   envelope violation in the run's summary.

## Evidence to attach when sending

- The hourly task's run history (session ids, the approval stalls) and its prompt.
- `docs/robot-protocol-log.md` — what the fleet's errors look like when the commander has no memory.
- The robots' side: one session per lane, self-compaction, memory written during work.
