# 2026-10-21 — autonomous session scheduler (futures candidate)

<!-- intention: scheduled autonomous work that nobody asked for by hand -> sessions that start on time, are watched, wake the delegator, never run twice, need no human for routine starts -->

## CONDITION (owner decides; plan stays here until then)

Activate (move to `plans/`) only when the owner approves ALL of:
1. the tick carrier: Task Scheduler entries (option A) vs headless `claude -p` (D) vs orgd spec (C);
2. host-down behavior: record-and-wait (owner starts host) vs approved unattended start;
3. the pick→dispatch lock (`autorefill.lock`, t58-style stale-pid guard).

Without these three words the plan is not dispatchable — it would re-run the 2026-10-21
finding (row 102: an unreachable step worked around instead of recorded).

## Goal

Unattended hourly tick + 15-min delegator-watch tick that dispatches, verifies and wakes —
with catch-up, no-double-run and a receipt per fire.

## Source

Research: `experiments/2026-10-21_session-scheduler-research/REPORT.md` (14 mechanisms,
gap table R1–R7, options A–D, chosen A). Re-read it before planning; do not re-derive.

## Tasks

- [ ] S1 probe script: `autorefill --once` + 3b-lite + HOST-DOWN record, lock-guarded; smoke on scratch queue first (predict dispatch line + zero outside writes)
- [ ] S2 two Task Scheduler entries (hourly full, 15-min lite; StartWhenAvailable + IGNORE_NEW); history shows exactly one START per fire
- [ ] S3 overlap oracle: two overlapping fires → one dispatch (lock holds); kill-host-mid-window → catch-up exactly once
- [ ] S4 cross-repo `next` lines marked owner-gated; `next` never offers them as dispatchable
- [ ] S5 single t-number allocator (with queue `t-number-allocator` line owner)

## Smoke contract

- Baseline: hand `fleet.py next` output + `autorefill --once --dry-run` on the live tree.
- Post-change: scheduled fire's `autorefill.log` START line matches the baseline's `next:` + `slots:`.
- Expected delta: routine fires need zero human touches; host-down fires name the owner start.

```yaml
Keywords: autonomous-scheduler 0.35, unattended-tick 0.25, no-double-run 0.20, delegator-watch 0.12, receipts 0.08
Semantic dominant: Futures candidate for the unattended session scheduler tick, gated on three owner decisions.
md5: 9c1d4e7f2a5b48c3d6e8f1a2b3c4d5e6
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 8a5f2d9c4e1b37e06b8a5d2f9c4e1a73
note: hash values are generative tags — search them, never compute them.
```
