# Plan-mirror noise fix — relevance filter, caps, goal_sv anchoring

**Status:** IMPLEMENTED <!-- workflow: lifecycle IMPLEMENTED | gate G9 -->

## Context (Exact, from a live LAYER-1 panel dump)

The shipped mirror works mechanically but floods summaries: ~20 plans including
July-era SUPERSEDED/DONE/COMPLETE (non-kernel lifecycle strings), fully-checked
files, `plans/README.md` parsed as a plan, duplicate task ids, dozens of PENDING
rows. The session's actual plan is absent (reconcilePlans moved it to
plans_completed/ — mirror only reads plans/). The summary `dominant` is
re-invented per session with no anchor to the plan's goal vocabulary.

## Fix contract

1. **Relevance filter** in `collectPlanState`: skip `README.md`; drop plans whose
   lifecycle is a non-kernel string (anything outside DRAFT/ACTIVE/EXECUTING/
   VERIFYING/IMPLEMENTED/COMPLETED/INVALIDATED); drop fully-checked plans (0
   open tasks) unless lifecycle is ACTIVE/EXECUTING; newest-first by filename
   (ISO prefixes sort chronologically); cap MAX_PLANS=3.
2. **Caps in `formatPlanStateText`**: per plan show only PARTIAL/PENDING tasks
   (max 8), collapse PASS to a `PASS ×N` count line; empty plans-dir → single
   `plan state: none active` line; global text cap 1500 chars with line-boundary
   truncation marker.
3. **goal_sv anchoring**: `summaryRequestProse(lastSv, planGoalSv?)` gains a plan
   hint — «align your dominant with the active plan's goal vocabulary».
   `captureSidecar` collects planState BEFORE the retry loop and passes the
   first non-empty goal_sv.
4. Docs: one-line filter/caps note in compaction.md plan-state paragraph.

## Tasks

- [x] T1 filter+caps in plan-status.ts <!-- sv: filter,caps,relevance -->
- [x] T2 prose goal_sv anchoring (compaction.ts + prompt.ts) <!-- sv: dominant,goal-sv,anchoring -->
- [x] T3 tests (filter/caps/collapse cases; integration still green) <!-- sv: tests,regression -->
- [x] T4 docs line + oracles (typecheck, targeted serial) <!-- sv: docs,oracle -->
