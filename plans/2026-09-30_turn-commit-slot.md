<!-- intention: the turn's felt wait and its snapshot commit sat on the same path, and the mechanism meant to take the commit off it (a settle at the next turn's open) never executes -> the commit runs OFF the input path AND in strict order (one slot, one job at a time), and its timing is keyed state rather than a line in a log that dies with the session -->
# The turn's commit slot

**Status:** ACTIVE · re-grounded 2026-09-30 against the LIVE instrument. Born as
`plans/2026-09-29_stall-reproducer.md`; that plan's premise — reproduce the 20–36 s post-input stall, then
bisect it — is **refuted by measurement**, and what remains is the mechanism its fix left behind.

## Established by measurement — do not re-derive

- ✓ **The felt wait is ABSENT on the live runtime** (2026-09-30, 02:33→03:30 UTC, twelve `turn.prepare`
  lines of this session): `requestMs` = 19, 29, 33, 33, 34, 42, 43, 43, 47, 48, 65, **617** ms, and
  `fossilMs` = **0 in all twelve**. The old plan's acceptance — a `requestMs` inside the 20–36 s band in at
  least one of five turns — cannot be met: the band does not reproduce.
- ✓ **Its history-dependence premise is refuted too.** It read: «on an EMPTY session the whole prepare is
  0.2–0.7 s above fossil ⇒ the stall is history/size-dependent, so a reproducer without the real history
  reproduces nothing.» This session carries MORE history than 2026-09-29 did and prepares in tens of ms.
- ✓ **THE MECHANISM — code, then measurement.** A turn CLOSES by forking its commit into `turn.job`
  (`session/processor.ts:1182`, `Effect.forkDetach`) and OPENS by joining it (`:560-564`, and `fossilMs`
  measures exactly that join). But `endTurn` (`:207-209`) **deletes the record that holds `job`**, and it is
  called at the same turn's close (`:1313`), AFTER the fork — so the next turn's `beginTurn` (`:201-205`)
  always builds a fresh record whose `job` is `undefined`. That is why the twelve live turns report
  `fossilMs: 0`: the join is unreachable in this path, so nothing is ever settled IN ORDER. The comment's
  promise («linear by construction: the commit that closes turn N is what turn N+1 waits for») is false as
  written, and two commits can overlap in one worktree — the race class this project has already paid for.
- ✗ **One observation does NOT fit, and it stays open rather than being argued away.** The old plan records
  a source-run (`experiments/2026-09-29_source-run/run2.cmd`) reporting `fossilMs 2940` and `491` — values
  that only exist inside the `if (turn.job)` branch, i.e. the join DID run there. So the deletion is not the
  only path to a non-zero `fossilMs`, and how that run differed is not measured. R2's source-run is where
  this gets answered; until then the contradiction is recorded, not resolved by preference.
- ✗ **Attribution of the removal is INDETERMINATE, and a story would be a guess.** The absence coincides
  with `d68243a635` («the boundary snapshot commit no longer blocks the turn») and `75a99e1d18` («snapshot
  commit at the END of a turn, settled by the next one»). Which one removed the wait is NOT measured: an old
  commit is not re-runnable in this project (the toolchain moved), and the older session logs are gone —
  eight `.jsonl` files exist under `.opencode/data/log` and all of them are this session's.
- ✓ **The instrument does not survive its own question.** `turn.prepare` is a LOG line in a session-scoped
  file, and the 29th's numbers no longer exist — this plan could not be re-grounded from its own instrument,
  it had to be re-measured. The datum has a KEY (the turn's own assistant message id), and a keyed datum is
  STATE (AGENTS § Debugging Paradigm: a log records only what state cannot show).

## Tasks

- [ ] **R1 — the commit slot: off the input path AND in strict order.** One job at a time, never two
      commits in one worktree, and no turn blocked on the input path for a commit it does not need — while
      the turn's own revert target stays addressable (the `step-finish` part already carries its snapshot
      hash, `processor.ts:1193`). Acceptance, both halves in ONE drive: two turns back to back against a
      deliberately slow commit show (a) no overlap — the second job is queued, not started — and (b) no
      blocked open — the second turn's prepare completes while the first commit is still running.
- [ ] **R2 — the timing is STATE, keyed by the turn.** `fossilMs`/`requestMs` (and, once R1 gives it a
      settle, the commit's own cost) live where their key lives, so a distribution over the last N turns is
      answerable by a DB read instead of by a log that dies with the session. Acceptance: after a
      source-run of two or more turns the per-turn timings are read back from the store, with the log line
      secondary. Oracle: the source-run runner (`experiments/2026-09-29_source-run/`).

## Smoke Tests

- Baseline (before R1): the two-turn drive against a slow commit. `fossilMs` is 0 today, which IS the
  defect's signature — so the no-overlap assertion must FAIL on the current code, and a suite that passes
  before the change is measuring nothing.
- After R1: the same drive passes both halves, and the turn's `step-finish` still carries a resolvable
  snapshot hash (the trajectory stays addressable without the wait).
- R2: a two-turn source-run, then the timings read back from the DB with no log in the loop.

## Out of scope

- Nothing under `bin/` (the owner's live runtime, forbidden without explicit permission).
- Re-instating a WAIT on the interactive input path. The owner's ruling already answers this: for the
  automatic mode «тебе больше нужна траэктория и меньше тормозов», so a blocking join is not the fix and
  the slot is.
