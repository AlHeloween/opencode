# plans/futures/ — plans that are ahead of the project

A plan lands here when it **neither contradicts the architecture nor is paused — it is simply ahead**:
the design is right but needs something the project does not have yet (hardware, data, a vendor's
stability, a market decision). Keeping such a plan in `plans/` means keeping a debt that will never
close and will distort every count (`owed`); ticking it would be a lie about work not done.

Owner, 2026-09-22: «если план слишком футуристичен то его кидаем в futures, … туда же readme с
обьяснениями и это тоже надо добавить в кернел».

## Rules

- **In:** a plan that becomes executable at a NAMED condition — "when a ≥24 GB GPU is here", "when the
  vendor publishes a stable API", "when the dataset exists". The condition is mandatory and recorded in
  the plan: futuristic without a condition is a wish, not a plan.
- **Not in:** contradicts the architecture (`plans_deferred/`); paused for a reason (`plans/postponed/`);
  forgotten but alive (stays in `plans/`).
- **Move:** `git mv plans/<file> plans/futures/<file>`, one commit that names the RETURN CONDITION.
  Without it the plan is not deferred, it is hidden.
- **Return:** when the condition holds — a normal cycle with fresh authorization; the returning plan
  states what changed since it was deferred.
- **Scanners:** `collectPlans` is flat and reads `plans/` and `plans_completed/` only, so this terminal
  is invisible **by design**: a future plan counts as neither debt nor completion.

Terminal family: `plans/` (active) · `plans_completed/` (done) · `plans_deferred/` (contradicts the
architecture) · `plans/futures/` (too far ahead, this folder) · `plans/postponed/` (paused).
