# 2026-10-14 — stop-claim form becomes binding (t36 lane; owner «Да + механизм»)

- Task: `plans/2026-10-14_stop-claim-form.md` — the t42 report's `STOP_CLAIM` form (routes with
  receipts + failing component, untried routes, reopen_when) made binding on two surfaces:
  `planstatus` reports parked/blocked plans without it; the end-of-turn stop-check continues a turn
  that declares a blocked outcome without it.
- New tools: NONE. `util/stop-claim.ts` is a new LEAF module (no imports) — one home for the form,
  consumed by `util/plan-status.ts` and `session/stop-check.ts` (no cycle).
- Blockers: one real one, caught by the oracle — `bun typecheck` exit 2: `agi-mode.tsx:184` builds a
  default `PlanStatus` literal and the new `stopClaims` field made it incomplete. A grep for
  `getPlanStatus|formatPlanHygiene` did NOT name it (it is a TYPE consumer); the typecheck is what
  found it. Fixed in the same change; typecheck exit 0 after.
- Noted for the next cycle: the running host binary predates the change, so the session's own
  `planstatus` tool cannot show the new line until the next install — the live check ran through the
  current source (`experiments/2026-10-14_stop-claim-form/live-planstatus.ts`), which reported
  `STOP CLAIM: 8 plan(s)` for the parked shelf.
