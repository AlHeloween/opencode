# plans/postponed/ — plans paused for a reason

A plan lands here when it **neither contradicts the architecture nor is ahead of it — it was stopped**:
a dependency is not ready, a priority was taken over, a resource is busy. The difference from `plans/`
is the debt: an active plan owes open items, while a paused one is worked by nobody and must not be
counted in `owed`. Leaving it in `plans/` displays work that no one is doing.

Owner, 2026-09-22: «если план по каким-то причинам приостановлен то кидаем в postponed, туда же readme
с обьяснениями, и это тоже надо добавить в кернел».

## Rules

- **In:** a plan with a NAMED reason and a signal that would lift the pause: "waiting for PR #N",
  "waiting for the owner's decision on X", "preempted by plan Y until Y closes". A reason without a lift
  signal is not a pause, it is silent forgetting.
- **Not in:** contradicts the architecture (`plans_deferred/`); ahead of the project (`plans/futures/`);
  alive but forgotten (stays in `plans/` and must appear in `owed`).
- **Move:** `git mv plans/<file> plans/postponed/<file>`, one commit naming the reason AND the lift
  signal.
- **Return:** when the reason clears — back to `plans/`; the returning plan checks whether it went stale
  during the pause (external APIs and decisions move).
- **Scanners:** invisible to the flat `collectPlans` **by design** — a paused plan is neither debt nor
  completion, it is a third state with a reason instead of a status.

Terminal family: `plans/` (active) · `plans_completed/` (done) · `plans_deferred/` (contradicts the
architecture) · `plans/futures/` (too far ahead) · `plans/postponed/` (paused, this folder).
