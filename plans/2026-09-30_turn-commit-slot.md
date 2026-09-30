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
- [x] ✓ **R2 — the timing is STATE, keyed by the turn.** DONE 2026-09-30. The felt wait and what the
      snapshot commit costs are now FIELDS OF THE TURN rather than a line in a log that dies with the session:
      the `step-finish` part of the turn's own assistant message carries
      `timing: { requestMs?, commitMs?, commitHash? }` (`session/message-v2.ts`, `StepFinishPart`), so a
      distribution over the last N turns is a SELECT and not a log hunt.
      **Two halves, written at different times — which is the whole shape of this box.** `requestMs` is known
      when the part is created, so it rides the part. `commitMs`/`commitHash` CANNOT be: the commit is forked
      at the turn's close and nothing joins it, so those values exist only once that fiber has settled. The
      part is therefore written BEFORE the fork and the fiber writes BACK onto it (`session/processor.ts`).
      `commitMs` counts a wait behind a sibling commit as well — that wait is part of what the trajectory
      costs — and `commitHash` is the commit's address, recorded because its ABSENCE is what a failed or
      aborted commit looks like in state, instead of a failure swallowed by the `Effect.catch` that used to
      end that effect with nothing.
      Oracles: `bun test test/session/turn-timing.test.ts` — a REAL turn driven through the real processor
      against a stub LLM (`provideTmpdirServer` + `TestLLMServer`), then the part read back from SQLite, never
      from the object the writer handed us. RED before the writer (`20260930T034925Z_bdcd40af`: fails exactly
      on `typeof timing.requestMs === "number"` while `expect(ended).toBeDefined()` already passes — so the
      instrument fails on the missing behaviour, not on a broken harness) and GREEN after it
      (`20260930T034957Z_2b1f94d8`: 1 pass / 0 fail, 4 expect, both halves, hash 40-hex). Regressions on the
      proportional surface: **19 pass / 0 fail** over `processor-effect` + `snapshot-tool-race` +
      `snapshot-granularity` + `turn-timing` (`20260930T035033Z_187d6d85`); `bun typecheck` → **exit 0**
      (`20260930T035139Z_7cde9bdc`). Live-store baseline: of 5394 `step-finish` parts in the real database,
      **0** carry a timing — the running build predates this change, so the field appears only after a rebuild
      (`bin/` untouched, by the standing prohibition).
      **The acceptance moved from the source-run to this turn-driver, and the reason is measured rather than
      preferred** — see R4: the runner named here produced NO VERDICT at all. A two-turn source-run could not
      have shown the second half either, and that is worth stating plainly: the CLI process exits at the end
      of the turn, so the detached commit's write-back races the shutdown. That is the owner's CLOSE-RECOVERY
      point, not a property of this box.
- [x] ✓ **R3 — the order is now MEASURED, not read.** DONE 2026-09-30. The claim R1 rests on — the
      per-repo permit means two operations cannot interleave — now has an instrument that CAN FAIL ON IT,
      and the instrument is a TEST rather than a production seam: `test/snapshot/fossil-lock.test.ts`
      hands the service a `ChildProcessSpawner` that answers every `fossil` invocation itself and counts
      how many are running at once, then starts THREE `track()` calls on one repo concurrently and asserts
      the peak is 1. Nothing under `src/` changed — the same stack `defaultLayer` builds, one layer
      replaced — so this box's own proposal («a seam in `snapshot/fossil.ts` exposing how many operations
      are in flight») is **refined rather than followed**: a counter shipped for a test is dead
      production code, and the spawner is where the occupancy is real and already observable.
      **The falsifier is a MUTATION, not an argument.** `locked := identity` (`snapshot/fossil.ts:181`) and
      the file went RED — `Received: 3` at `expect(probe.peak).toBe(1)` (`20260930T035716Z_069ce67f`,
      exit 1, and only 5 of the 6 expects were consumed: the four control assertions ran first and PASSED,
      so the failure sits on the measurement itself and not on a broken harness). Then the file was
      restored from its pre-mutation backup and `git status` shows **no diff in `src/`** — the mutation was
      the only edit and it is gone (`20260930T035735Z_6ec0f1ab`: 1 pass / 6 expect again).
      **The control that keeps this from lying:** every call must have actually RUN. The three results are
      valid 40-hex hashes and BOTH named paths appear in the fossil argv log — a permit that «serialized»
      by never letting the others start, or a service that returned before touching fossil at all, would
      otherwise read as a pass. The stub drives every branch to a COMPLETED commit for the same reason: a
      run that ended in the early skip path would be a shorter program than the one being measured.
      Oracles: the new file alone — GREEN 1 pass / 6 expect before and after the mutation
      (`20260930T035658Z_ca97891a`, `20260930T035735Z_6ec0f1ab`) and RED 0 pass / 1 fail under it; with
      its neighbours `snapshot-granularity` + `snapshot-tool-race` (the R1/R2 regression set) **6 pass /
      0 fail** (`20260930T035752Z_08605fa5`) — which also exercises the recorded trap that a new test file
      can poison the shared `TEST_TEMP` store for whichever file runs after it.

- [ ] **R4 — the source-run oracle yields no verdict, and must be requalified before it is named again.**
      Measured 2026-09-30: `experiments/2026-09-29_source-run/run2.cmd`, the runner R2 originally named as its
      oracle, exits **0 after 8 s** (`20260930T035215Z_19960e3e`) with a log of **181 bytes** holding only its
      startup banner — not even the script's own `echo ---EXIT=%ERRORLEVEL%---` line — and NOTHING is written
      anywhere: no new session and no new part in the real store (the newest foreign `step-finish` is ~16 h
      older than the run), and no store under the stand directory either before or after it. So the run
      performed no turn. Whether the process failed or the ConPTY log dropped its output is NOT measured, and
      both readings fit what is visible. Acceptance: the runner produces a verdict at all — the smallest next
      step is to capture its output OUTSIDE the ConPTY rendering (`> file 2>&1` inside the .cmd) so the exit
      reason becomes readable, and only then re-attempt the two-turn drive. Until that lands, this plan does
      not name it as an oracle.

## Smoke Tests

- R1 (done): before/after on the same predicate — the snapshot suites above, 5/0 → 16/0, plus typecheck
  exit 0. The prediction was that behaviour would NOT change (the join never ran); it did not.
- R2 (done): a real turn driven in-process, then BOTH halves read back from the store — `requestMs` with the
  part, `commitMs`/`commitHash` from the detached fiber's write-back, polled to a deadline. Predicted RED on
  the first half before the writer and GREEN after; it was both. (The source-run first named here is broken —
  R4 — and could not have shown the second half in any case: the CLI exits at the turn's end.)
- R4: the runner's own output captured outside the ConPTY rendering, and a verdict in it.
- R3 (done): three concurrent `track()` calls on ONE repo through a stubbed fossil — peak in-flight
  invocations === 1, with both named paths present in the argv log as the control that each call ran;
  `locked := identity` makes it red with `Received: 3`, and restoring the file makes it green again.

## Out of scope

- Nothing under `bin/` (the owner's live runtime, forbidden without explicit permission).
- Re-instating a WAIT on the input path. The owner's ruling already answers this: for the automatic mode
  «тебе больше нужна траэктория и меньше тормозов», so a blocking settle is not the fix.
- Building a second commit queue in the processor: R1's refutation is exactly the finding that the order
  already exists one layer down, and duplicating it would be the compensation-on-a-defect shape.
