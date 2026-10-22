# t141 — watch3: a spent lineage nudge is an EVENT, and a nudge never moves the lineage

**Finding date:** 2026-10-22 · **session:** `ses_e9e83a349ffeDv64NoAgxwmtK7` (robot t141) ·
**live surface:** `experiments/2026-10-08_robot-wave/watch3.py` + `dispatch.py` (the robot wave is
gitignored — see § *What is NOT fixed*).

## 1. The incident (measured 2026-10-22)

- 06:27 robot **t135** (`ses_e9ffe1e38ffeom6UvwKP1ZNMgo`) finished a step whose SV carried
  `parent-goal-md5: 8581b040…` — **the md5 of watch3's own lineage nudge**, not of the brief
  (`ba748a084f9443aa9d39189641c4f9c4`, t135's real brief md5 in `sessions.json` and
  `session_tasks.json`).
- watch3 printed `lineage: t135 — already nudged once, waiting for a new SV` and kept polling.
  The robot stayed idle from 06:27 to 10:28 — four hours. Nothing woke the delegator, and the hourly
  check did not catch it either (the delegator was unreachable then: `docs/robot-protocol-log.md`,
  the 07:22 row).
- The same capture happened at 05:06: the robot set its parent to an **earlier** nudge's md5
  (`11cf12e6…`).
- The live watcher on t135 is gone (receipt `receipts/live-state.txt`): t135 is not in the host's
  status map and no `watch3.py` names it.

## 2. Root cause — one cause, two faces

1. **The spent-nudge branch was a wait.** `watch3_before_t141.py:322-324`: when the lineage nudge
   was already spent, the watcher printed a line and `continue`d — forever. A silent instrument
   says nothing, and an idle robot was not an event.
2. **A nudge moved the lineage.** A nudge is a **prompt that carries an SV**, and the owner's rule
   (t83, quoted from the owner: «если задание пришло с SV, то этот SV md5 должен стать
   parent-goal-md5») makes a robot that answers a nudge take **the nudge's md5** as its parent. The
   old nudge named neither the parent to keep nor its own md5, so the robot took the nudge's md5 →
   the lineage check failed → the watcher nudged again → the loop the incident shows.
   The old nudge's SV block *did* carry the brief md5 in its parent field; that was never the defect.
3. **«Already nudged» lived in the watcher's memory.** `lineage_nudged` was an in-process counter, so
   a watcher that starts (or restarts) after the nudge nudges again — and the 05:06 capture (an
   *earlier* nudge's md5) is what that looks like.

## 3. The fix

`watch3.py` (patch: `watch3-t141.patch`):

- **The spent nudge + an idle robot is a terminal event with a named reason.** The watcher prints
  `finished-lineage-mismatch: <name> expected <brief md5> got <md5>` (own-md5 faults get
  `finished-lineage-md5: <name> expected a fresh own md5 got <md5>`) and exits. The family prefix
  `finished-lineage-` is what a reader greps. Exit code 0, like every other terminal event of this
  file (`finished` / `asked` / `stopped` / `no-sv`) — the reason line is the event.
- **Every nudge states the parent to keep and denies its own md5.** `lineage_nudge_text()` and
  `plain_nudge_text()` name the brief md5 to keep and say the nudge's own md5 is **not** a parent.
  The SV block is unchanged (same Keywords — the `OUR_SV_MARK` the model route depends on).
- **The spent state is read from the WORLD.** `nudge_state(host, sid)` finds our own nudge in the
  session's user rows and returns its md5 and whether it was a lineage nudge. The watcher therefore
  knows the nudge was spent even if it starts after it — and it knows the md5 a robot must never
  adopt.
- **A parent equal to our own nudge is REPORTED, never adopted.** `dispatch.check_lineage(…,
  nudge_md5=None)` returns the distinct check `parent-is-nudge`; the expected parent stays the
  brief md5, and the nudge's md5 is never written to the lineage registry.

`dispatch.py`: one hunk — `check_lineage` gained the optional `nudge_md5` parameter and the
`parent-is-nudge` branch (the file was rewritten by another lane at 11:03:20; the hunk survived —
`dispatch.py:159,168,169`).

## 4. The replay — `replay_t141.py`, 11 cases, ALL PASS

Receipt: `receipts/replay-t141.txt`. The fixture is the whole world (one JSON file: status, rows,
queues, watchers); no live host, no sleep, no write outside the fixture. The 06:27 world is built
from t135's **real** registry entry, so the old and the new watcher see the same world.

| case | what it proves | new | old (`watch3_before_t141.py`) |
|---|---|---|---|
| L0 | source control: the wait branch is gone, the named reason is there | no wait branch | has the wait branch |
| L0b | the live registry still names t135's brief md5 (the old code has no fixture override) | — | — |
| L1 | the 06:27 case: an idle robot whose parent IS the nudge's md5 | exits `finished-lineage-mismatch: t135-open-plans-triage expected ba748a08… got 8581b040…` in **one poll** | **no event** — it nudges the already-answered robot (live: it waits forever) |
| L2 | after a nudge, the robot keeps the **brief** md5 | `finished: … (SV present, lineage ok, nudges 0)` | the same |
| L3 | after a nudge, the robot takes the **nudge's** md5 | reported as `parent-is-nudge`, the expected parent stays the brief md5, **never adopted** | a plain `parent-mismatch` — the nudge's md5 is not even named |
| L4 | the nudge the watcher sends | names the brief md5 as the parent to keep and denies its own md5 | names neither |
| L5 | the lineage registry (`session_tasks.json`) | byte-identical after the whole run | byte-identical |

The old watcher's wait branch is unreachable in fixture mode by construction (its counter starts at
0 and the fixture mode runs one pass), so the RED half of L1 is shown the way t118 showed its own
baseline: the behaviour on the fixture (no event, a second nudge to an answered robot) **plus** the
source pin of the wait branch (L0). L1's RED is therefore the old watcher's *silence*, not a
timeout — stated here so the next reader does not read more into it than it says.

## 5. The regression — the t118 oracle: 15/17, and the two reds are not mine

`experiments/2026-10-21_robot-pending-stop/replay_watch3.py` (t118's receipt R11) was run before and
after the change:

- **before** (10:45): `ALL CASES PASS` (17/17).
- **after** (11:0x, receipt `receipts/replay-t118-after.txt`): 15/17 — the two reds are
  `W3 baseline (the defect: dispatch.MODEL)` and `W8 baseline (the defect)`.

Cause, measured: the oracle compares the baseline's posted model with a **hardcoded constant**
(`muse-spark-1.3-contributor`). The owner's model line (2026-10-22, «партийная установка … minmax
m3.1 flash free») moved `dispatch.MODEL` to `minimax-m3.1-flash-free` in another lane's edit at
11:03:20 (`dispatch.py:39-44`). The baseline's **behaviour did not change**: the receipt
`receipts/t118-baseline-model-probe.txt` shows `baseline posted model == dispatch.MODEL → True`.
So the two reds are an oracle that pins a value the owner changes.

Every case that exercises the **new** watcher passes (W0, W1, W2, W3, W4, W5, W6, W7, W8-new, W9).

**Not fixed here, on purpose:** that oracle belongs to the t118 lane (its plan
`plans/2026-10-21_robot-pending-stop-hook.md` cites R11), and two other robots are live in this
tree. The fix is one line in that file — compare with `dispatch.MODEL["modelID"]` instead of a
constant. My own oracle asserts no model at all, so it survives the next model switch.

## 6. What is NOT fixed (residual)

- **The delegator's wake path is still broken** (`docs/robot-protocol-log.md`, 07:22 row: sending to
  `delegator.json`'s session returns «session not found»). t141 makes the idle robot an **event**;
  who reads that event is the delegator's lane.
- **t135's final is still unverified**, and no watcher runs on it (`receipts/live-state.txt`).
- **The wave is gitignored** (t120's open plan `plans/2026-10-21_portable-delegation-kit.md`): the
  live fix is not in git. `watch3-t141.patch` is the versioned record; the before-state copy sits
  beside the live file as `watch3_before_t141.py` (the t83/t118 convention).
- The 05:06 capture («an earlier nudge's md5») is explained by the memory-only spent state (§ 2.3),
  which the world-state read now closes; it was not reproduced as a separate fixture case (the
  replay reproduces the 06:27 state).

## 7. Privacy check (the archive canon)

The canon (`experiments_history/README.md`, harness
`experiments/2026-09-13_experiments-canon/archive.cjs`) keeps conversation dumps and secrets out of
the tracked archive; its content rules flag the SV-block marker and the JSON role key. This
material trips those two markers **by construction**: `replay_t141.py` builds synthetic fixture rows
and the patch carries the watcher's SV-block string. What was checked, by hand:

- no conversation text — every row in the fixture is synthetic (`msg_u1`, `msg_a1`, invented md5s);
- no secrets, no keys, no tokens, no foreign-project references, no other user's paths;
- only the incident robot's **public** ids appear (t135's session id and its brief md5 — already in
  the tracked `sessions.json`? no: that file is gitignored; the ids are in the brief the owner
  wrote, which is the task's own text).

Precedent: an archived python file already carries the same marker
(`experiments_history/2026-10-20_sv-canary-detector/sv_census.py:284`). The owner can reverse this
decision; the alternative (keeping the patch out of the tracked tree) leaves the fix unversioned.

## 8. How to regenerate every item here

| item | how |
|---|---|
| `receipts/*.txt` | `python make_receipts.py` (runs both replays, the probe and the live-state read) |
| `watch3-t141.patch` | `python make_receipts.py` (diff of `watch3_before_t141.py` vs `watch3.py`) |
| the before-state copy | `watch3_before_t141.py` (sha256 in `receipts/hashes.txt`) — the wave is not in git, so this file IS the baseline |
| the working copy of this experiment | copy this folder back to `experiments/2026-10-22_t141-watch3-lineage/` |

Nothing here is a build target, a node_modules copy or a repo tree copy — nothing to clean up.
