# plans_deferred/ — plans that contradict the architecture

A plan lands here when it is **neither finished nor cancelled, but deferred**: its design requires an
architecture the project has REJECTED. This is the third terminal beside `plans/` (active) and
`plans_completed/` (done), and it exists because both of those LIE about such a plan: a tick would
claim work that was never done, and leaving it in `plans/` brings it back as open debt in every scan,
pulling the project toward the architecture it rejected.

Owner, 2026-09-22: «если план противоречит архитектуре то надо перемещать в plans_deferred, туда
readme.md и прописать это в кернеле и пересобрать.»

## Rules

- **In:** a plan whose `intention` or tasks require a rejected architecture — restoring generated
  boundary summaries, porting upstream opencode architecture, putting state back into loose JSON files.
  The ground is a RECORDED decision (link to `AGENTS.md`, `docs/`, or the superseding plan), never taste:
  without it this is "I changed my mind", not "it contradicts the architecture".
- **Not in:** forgotten work (`plans/`), finished work (`plans_completed/`), debris (git history). A
  deferred plan stays readable — it carries the decision "why we do NOT do this", and that is its worth.
- **Move:** `git mv plans/<file> plans_deferred/<file>`, one commit, whose message names the architecture
  the plan breaks and where that is recorded. A move without that name is a hidden file, not a deferral.
- **Return:** only if the owner reverses the decision — a new cycle with fresh authorization, stating
  what changed in the architecture since. "I reconsidered" is not a return ground.
- **Scanners:** `plan-status.ts` / `collectPlans` read `plans/` and `plans_completed/` only; this folder is
  invisible to them **by design** — deferred work counts as neither debt (`owed`) nor completion. Same
  measure/scope split as everywhere else: visible to reading is not the same as visible to deciding.

Terminal family: `plans/` (active) · `plans_completed/` (done) · `plans_deferred/` (contradicts the
architecture, this folder) · `plans/futures/` (too far ahead) · `plans/postponed/` (paused).
