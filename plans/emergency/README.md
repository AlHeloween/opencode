# EMERGENCY — the state of affairs, 2026-09-27

<!-- intention: the empty transcript is unproven and its first client oracle skipped healthy traffic
     -> one page distinguishes the replacement trace from a real terminal frame and states the next
     measurable reproduction without relying on the owner's live bin/ -->

Read this page first. It is state, not work — the work is in the plans it names.

**KNOWN BLINDNESS, read this first:** `collectPlans` in `util/plan-status.ts` is FLAT (no
recursion), so **every file in this folder is INVISIBLE to `planstatus` and to `reconcilePlans`.**
That is deliberate for `emergency` (an emergency is not schedulable debt) and it has one cost:
**these files never move themselves, so a closed card is moved BY HAND.** That is part of the job,
not an excuse for leaving it.

## THE TWO THINGS THAT ARE ACTUALLY URGENT

| | | |
|---|---|---|
| **1** | **Empty transcript** — agent works, transcript empty, restart repairs it. 3× in one morning. **NEVER REPRODUCED.** | `01-empty-transcript.md` |
| **2** | **Client trace replacement** — unit and initial/revert live proof landed; a live new-arrival/frame pair is still open. | `02-oracle-cannot-say-it-ran.md` |

**#2 blocks proof of #1.** The first `alive` patch was refuted at its Session caller: already-listed
ids were filtered before `report()`. The replacement observes each state transition, including healthy
and empty states. Its JSONL proves what the client LISTED; only a separate rendered frame can prove
what the terminal painted. Do not read an empty file as a pass.

## The rest, ranked by what a next cycle can actually DO

| item | where | state | the next measurable step |
|---|---|---|---|
| **DAP debugger** | `plans/2026-09-27_dap-debugger.md` | 5 leaves, 0 done. Surface **measured**: 4 405 lines | T1 protocol core, oracle = a FAKE adapter over stdio |
| **T4b crossing regression** | `plans/2026-09-27_mechanical-s-cadence.md` | open; both of its candidates REFUTED by measurement | prove whether the scenario enters `prompt.ts:2429` |
| **fold carrier T1/T2/T3** | `plans_completed/2026-09-26_fold-carrier-integrity.md` | CLOSED 2026-10-08 (T1–T4, run ids in the plan) | — |
| **settings layers, part 2** | `plans/2026-09-26_unified-settings-layers.md` | TASK-8 part 2 only | per-session protocol override |
| shelf triage, pre-fix verification | two 2026-09-24 plans | open, untouched today | — |

## THE BUILD boundary

The earlier 10.0.1143 candidate (run `20260927T133028Z_a679fc61`) predates the replacement
instrument and did not complete an undo reproduction. Its historical version cannot establish the
current version of the owner's live `bin/`. Build a **new** candidate under `dist/` and drive it
from an isolated cwd; no promotion is needed to reproduce. `bin/` is the owner's live runtime and
may not be touched or launched without an explicit request. The real blocker is a missing paired
frame + client trace for a confirmed undo/second turn, not a deployment decision.

## What was closed today, with artifacts

| commit | what | artifact |
|---|---|---|
| `1d880ed7a9` | the Goal carrier quoted the machine's own panel as the owner's words | baseline RED 13/2, GREEN 15/0, typecheck 0, fold suite 75/0 |
| `a730ac25d1` | the "crossing" test never crossed — measured, then renamed to what it proves | 1/0 and 62/0 across 4 files |
| `874ffc379f` | the DAP plan, surface measured from source | — |
| `56b7bf798e` | the render-divergence oracle (earlier today) | **never fired in a build until today's 10.0.1143** |

## The class that cost the most, and it is not a code class

**A claim that we LACK a thing is a claim about WHAT YOU READ, not about the tree.** Five of my own
claims were refuted today, every one by reading the canonical source instead of a derived surface
(status line, tool output, another repo's README). The expensive one was a `LIKE '%…%'` over a whole
`part` column that matched my own PROSE quoting the thing I was searching for.

Second, and sharper: **an instrument that cannot say "I ran" is a claim, not a capability** — see
card 02. Third: **a null search is a pattern claim, not a fact** — it cost the eighth counted
instance today.
