<!-- intention: the turn's felt wait and its snapshot commit sat on the same path, and the mechanism meant to take the commit off it (a settle at the next turn's open) never executes -> the commit runs OFF the input path with strict order held ONE LAYER DOWN by the fossil service's per-repo lock, and the commit's own cost becomes keyed state rather than a line in a log that dies with the session -->
# The turn's commit: off the input path, and in order — held one layer down

**Status:** ACTIVE · re-grounded twice on 2026-09-30, each time against the LIVE instrument. Born as
`plans/2026-09-29_stall-reproducer.md`; that plan's premise — reproduce the 20–36 s post-input stall, then
bisect it — is **refuted by measurement**. What remains is the mechanism its fix left behind. The name is
kept for continuity; the "slot" it promises turned out to be **unnecessary** — see R1.

## Established by measurement — do not re-derive

- ✓ **The felt wait is ABSENT on the live runtime** (2026-09-30, 02:33→03:30 UTC, twelve `turn.prepare`
  lines of that session): `requestMs` = 19, 29, 33, 33, 34, 42, 43, 43, 47, 48, 65, **617** ms. The old
  plan's acceptance — a `requestMs` inside the 20–36 s band in at least one of five turns — cannot be met:
  the band does not reproduce. Its second premise died with the first: the stall was held to be
  history/size-dependent, and that session carried MORE history than 2026-09-29 did while preparing in
  tens of milliseconds.
- ✓ **THE MECHANISM — the settle never executes.** A turn CLOSES by forking its commit into `turn.job`
  (`session/processor.ts:1182`, `Effect.forkDetach`) and OPENS by joining it (`:560-564`). But `endTurn`
  (`:207-209`) **deletes the record that holds `job`**, and it is called at the same turn's close
  (`:1313`), AFTER the fork — so the next `beginTurn` (`:201-205`) always built a fresh record whose `job`
  was `undefined`. The join was unreachable on this path, and the window it measured could only ever read
  0 — which is what the twelve live turns showed. The comment's promise («linear by construction: the
  commit that closes turn N is what turn N+1 waits for») was in the comment, not in the code.
- ✗ **REFUTED on 2026-09-30: «two commits can overlap in one worktree».** That was this plan's own reading
  of the dead settle, and **the code says otherwise**: `snapshot/fossil.ts:164-181` keeps a per-repo
  `Semaphore.makeUnsafe(1)` in `locks` and every fossil operation — `track` included (`:473`) — runs inside
  `locked(...)`, holding that one permit for its whole body. Two commits therefore cannot interleave. The
  order is real; it is simply held by the SERVICE, not by the processor. Recorded as a refutation rather
  than deleted, because the false version was already written into an accepted plan and into memory.
- ✓ **The revert target does not depend on any settle.** `turn.before` is resolved on the turn's FIRST
  write-class call — `pending.before = snapshot.checkpoint()`, `processor.ts:923`, which fires before that
  tool runs, hence before the turn has changed anything. Live database, 2026-09-30: of the last 24 h of
  parts, 1246 of 1308 `step-finish` carry a hash and 280 `patch` parts exist; the ones that carry none are
  turns with no write-class tool at all (this session's read-only turns are exactly that).
- ✗ **One observation does NOT fit, and it stays open rather than being argued away.** The old plan records
  a source-run (`experiments/2026-09-29_source-run/run2.cmd`) reporting `fossilMs 2940` and `491` — values
  that exist only inside the `if (turn.job)` branch, i.e. the join DID run there. After R1 that branch no
  longer exists, so the question can only be answered by re-running that runner and reading the timing as
  STATE — which is R2. It is recorded, not resolved by preference.
- ✗ **Attribution of the removal is INDETERMINATE, and a story would be a guess.** The absence coincides
  with `d68243a635` («the boundary snapshot commit no longer blocks the turn») and `75a99e1d18` («snapshot
  commit at the END of a turn, settled by the next one»). Which one removed the wait is NOT measured: an
  old commit is not re-runnable in this project (the toolchain moved), and the older session logs are gone —
  eight `.jsonl` files exist under `.opencode/data/log` and all of them are this session's.
- ✓ **The instrument does not survive its own question.** `turn.prepare` is a LOG line in a session-scoped
  file, and the 29th's numbers no longer exist — this plan could not be re-grounded from its own instrument,
  it had to be re-measured. The datum has a KEY (the turn's own assistant message id), and a keyed datum is
  STATE (AGENTS § Debugging Paradigm: a log records only what state cannot show). That is R2.

## Tasks

- [x] ✓ **R1 — the dead settle removed, and the order's real holder named.** DONE 2026-09-30. What the
      box originally asked for — a commit *slot* in the processor — is **not built and not needed**: the
      refutation above shows strict order already holds one layer down, and a second queue on top of an
      existing lock is the compensation-on-a-defect shape this project forbids. What WAS wrong was the dead
      layer itself: `job` (two type declarations plus the `fresh` literal), the `Fiber.join` branch in
      `create`, and the whole `Fiber` import are gone from `session/processor.ts`; the fork no longer stores
      its fiber anywhere; `fossilMs` is gone from `TurnRecord.timing` and from the `turn.prepare` line
      (a metric that could only ever print 0 is not a metric); the two comments that promised a settle
      (`:551-559`) and a commit «at the turn's start» (`:1166-1169`) now say what the code does — including
      the pin to `snapshot/fossil.ts` as the holder of the order. The record type is declared ONCE
      (`TurnRecord`) instead of twice.
      Oracles: `bun test test/session/snapshot-granularity.test.ts test/session/snapshot-tool-race.test.ts`
      → **5 pass / 0 fail** BEFORE the edit (`20260930T033918Z_6920fda9`) and **16 pass / 0 fail** after it,
      same two files plus `session-undo-fossil.test.ts` for the revert target (`20260930T034116Z_f7eda6f5`);
      `bun typecheck` → **exit 0** (`20260930T034216Z_3e9493ff`). Behaviour is unchanged by construction —
      the removed join never ran — so an identical-predicate before/after is the evidence, not a new test.
- [ ] **R2 — the timing is STATE, keyed by the turn.** `requestMs` lives in a session-scoped log and dies
      with the session, which is why this plan could not be re-grounded from its own instrument; the commit's
      own cost is not measured at all any more (the metric was deleted with the dead branch, R1). Both belong
      where their key lives — the turn's own message — so a distribution over the last N turns is a DB read
      instead of a log hunt. Acceptance: after a source-run of two or more turns, the per-turn prepare window
      AND the commit's duration are read back from the store, with the log line secondary. Oracle: the
      source-run runner (`experiments/2026-09-29_source-run/`), whose 2026-09-29 numbers are also the open
      question above.
- [ ] **R3 — the order the plan now RELIES ON is itself untested.** R1 points at the per-repo semaphore as
      the reason no commit can interleave, and that claim currently rests on READING the code: no test in
      `packages/opencode/test` exercises it (checked 2026-09-30 — the only nearby tests are the full-stack
      snapshot ones, which fail *indirectly* if it breaks, not on the property itself). Owing to the rule
      that a test must be able to print a verdict, the guard has to be deterministic rather than a timing
      race: the smallest honest form is a seam in `snapshot/fossil.ts` exposing how many fossil operations
      are in flight at once, driven from a test that starts several `track()` calls concurrently and asserts
      the counter never exceeds one. Acceptance: the counter is observable, and a deliberately removed
      `locked(...)` makes the test red.

## Smoke Tests

- R1 (done): before/after on the same predicate — the snapshot suites above, 5/0 → 16/0, plus typecheck
  exit 0. The prediction was that behaviour would NOT change (the join never ran); it did not.
- R2: a two-turn source-run, then the per-turn prepare window and the commit's duration read back from the
  DB with no log in the loop.
- R3: the in-flight counter reads 1 while several `track()` calls are started together — and the test goes
  red when `locked(...)` is removed from that call path.

## Out of scope

- Nothing under `bin/` (the owner's live runtime, forbidden without explicit permission).
- Re-instating a WAIT on the input path. The owner's ruling already answers this: for the automatic mode
  «тебе больше нужна траэктория и меньше тормозов», so a blocking settle is not the fix.
- Building a second commit queue in the processor: R1's refutation is exactly the finding that the order
  already exists one layer down, and duplicating it would be the compensation-on-a-defect shape.
