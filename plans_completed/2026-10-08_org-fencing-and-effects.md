<!-- intention: a queue that loses work at its edges — a worker whose lease was taken over can still write DONE, a wake already delivered before a crash is re-sent blind, and DONE is the worker's own testimony nobody accepts — -> every mutation presents the lease epoch it was won under, every external send is a recorded effect resolved by reading the target session, and the delegator's verdict (VERIFIED | REJECTED->READY | CANCELLED) closes the lifecycle -->

# Org queue — lease fencing, recorded wake effects, delegator verdicts

- sv: { keywords: { lease-fencing 0.28, wake-idempotency 0.24, delegator-verdict 0.20, queue-lifecycle 0.16, crash-consistency 0.12 },
        dominant: "The organization's queue stops losing work at its edges: mutations present the lease epoch (stale refused with the holder named), wakes are recorded effects (PENDING -> COMMITTED|UNKNOWN) resolved by reading the target session, and the delegator's verdict closes DONE." }
- Owner brief, 2026-10-08 (outside review of the organization's queue contract); work lands AFTER t13/t14 on
  the same files: `scripts/org-genesis/org.py`, `orgd.py`. `ticket-schema.sql` already carries
  `idempotency_key` (line 39) and `woken_state` — no DDL is needed, so the schema file stays untouched.
- Branch Local_Development, shared tree with two other robots — commit only this plan's paths.

## Premises (grounded in code, read 2026-10-13)

- `org.py:245-270` `cmd_claim`: epoch taken through the exclusive `O_EXCL` lock — atomic (review ✓); a
  WORKING ticket past `lease_until` is taken over with epoch+1.
- `org.py:273-283` heartbeat / `286-311` report / `314-322` done / `325-333` escalate: `lease_owner`
  checked only — **`cmd_report` checks nothing at all** — and no verb presents its epoch → a worker whose
  lease was taken over can still write DONE (the reviewed hole).
- `orgd.py:180-201` `wake()` + `204-241` `tick()`: `woken_state` is written **only after** the POST
  answered 2xx (header, lines 22-25) → a crash between the 2xx and the write re-sends the same wake;
  a crash after sending cannot tell sent from not sent.
- `ticket-schema.sql:39` `idempotency_key` exists, unused; `woken_state` is the wake bookkeeping field
  (`CLEARED = "-"`, org.py:70 — empty field values are silently ignored by fossil, measured 2026-10-08).
- DONE is today terminal with no acceptance step (`orgd.py:74` selects READY/WORKING/DONE/BLOCKED; no
  verb decides acceptance); the delegator is `delegated_by`. The kernel gates stay inside a worker's RUN —
  the ticket state is the queue's, not a gate (owner brief).
- Test convention: focused Python suites beside the scripts (`test_wiki_put.py`), one file per call; no
  service — a real isolated Fossil repo in `tempfile.mkdtemp`, every call a subprocess.

## Tasks

- [x] **S1 — this plan, written before any edit.**
- [x] **S2 — `scripts/org-genesis/test_queue_contract.py` (new) + RED baseline on HEAD** (the reproduced
  defect; predictions in § Smoke Tests): F fencing — stale-epoch done/heartbeat/report/escalate refused
  with the current holder named and the repo untouched, live epoch accepted, missing `--epoch` refused;
  E wake effect — PENDING + delivered marker resolved by reading (no resend), PENDING + unreadable
  target → UNKNOWN and never sent; V verdicts — verify/reject/cancel by the delegator, non-delegator and
  non-DONE refused, REJECTED → READY + findings technote + attempt+1 + reclaimable, CANCELLED blocks claim.
- [x] **S3 — fencing in `org.py`**: `--epoch` required on heartbeat/report/done/escalate; one
  `guard_lease` (no lease / stale epoch naming the current holder / terminal state refused); `claim` also
  refuses VERIFIED/CANCELLED; claim's stdout shape unchanged (ADID `org_worker` parses it and already
  passes `--epoch`).
- [x] **S4 — effects in `orgd.py`**: effect `idempotency_key = sha256(ticket|state|target|epoch|heartbeat)`
  recorded with status PENDING **before** the POST (never send unrecorded); 2xx → `woken_state=state`;
  a raising POST leaves PENDING, resolved on the next tick **by reading** the target session for the
  marker `[wake <key16>]` — delivered → commit; absent → send (no longer blind); unreadable → UNKNOWN,
  never send. `woken_state` vocabulary gains PENDING/UNKNOWN; the READY wake names rework findings
  (`knowledge_ref`) after a rejection.
- [x] **S5 — verdicts in `org.py`**: `verify` / `reject` / `cancel` verbs; one `create_technote` helper
  shared with `report`; verdicts fenced by `delegated_by` (no lease exists to present); Protocol.md and
  docstrings document the epoch, the effect contract and the lifecycle.
- [x] **S6 — green**: new suite + `test_wiki_put.py` regression pass; `_build.ps1` through cmd_runner
  (state.json read).
- [x] **S7 — install**: sha256-verified copy of org.py/orgd.py/Protocol.md into the genesis copy
  (`%USERPROFILE%/.org/genesis`) + `init.py` there (idempotent; republishes Protocol); restart orgd so
  the daemon runs the new code.
- [x] **S8 — close**: `_progress_log.md` entry; `svm render`; move this plan to `plans_completed/`; one
  commit naming it.

## Smoke Tests

Harness = the suite itself (`python scripts/org-genesis/test_queue_contract.py -v`), run on HEAD first —
predicted reds below (trader's rule: an off-prediction outcome is a divergence, logged) — then post-change.

| # | case | pre-change (HEAD) | post-change |
|---|------|-------------------|-------------|
| F1 | done with a stale epoch after takeover: refused, current holder named, state still WORKING | FAIL — no `--epoch` flag; nothing refused | PASS |
| F2 | heartbeat / report / escalate with a stale epoch refused; report_ref / failure_code untouched | FAIL | PASS |
| F3 | done with the live epoch closes the ticket; done WITHOUT `--epoch` is refused | FAIL | PASS |
| E1 | PENDING effect + delivered marker → tick resolves by reading: `woken_state=DONE`, one part in the target session, no resend | FAIL — woken stays PENDING, no resolution | PASS |
| E2 | PENDING effect + unreadable target → `woken_state=UNKNOWN`, nothing sent | FAIL | PASS |
| V1 | verify: delegator only, DONE only; VERIFIED blocks claim | FAIL — no verb | PASS |
| V2 | reject → READY + findings technote + attempt+1; the assignee can claim it again | FAIL — no verb | PASS |
| V3 | cancel → CANCELLED; claim refused; a non-delegator is refused | FAIL — no verb | PASS |
| R1 | `test_wiki_put.py` regression | PASS | PASS |

## Risks

- R1: the install touches the LIVE org's genesis copy — file copy + sha256 only; `init.py` there is the
  sanctioned idempotent path (t14 precedent); the orgd restart is a daemon bounce, its state lives in the
  repository, ticks resume.
- R2: ADID `org_worker` already passes `--epoch`: existing success outputs stay byte-identical; only new
  refusals are new text.
- R3: `report` gains the claim requirement (it checked nothing) — a caller must claim first; the refusal
  message teaches it.
- R4: the guard is read-then-write (the fossil CLI has no CAS): the window is milliseconds for
  done/heartbeat/escalate; `report` re-checks the fence after the slow technote creation.

## Out of scope

- `ticket-schema.sql` DDL (existing columns suffice); kernel gates inside a worker's run; the live org's
  content; `opencode_host.py` (vendored, unchanged).

## Evidence

- RED on HEAD: `20261013T113550Z_f688d499` — `Ran 8 tests ... FAILED (failures=8)`, every failure the
  predicted case (no `--epoch` flag; `verify`/`reject`/`cancel` are not verbs yet).
- GREEN post-change: `20261013T114015Z_df54af8b` — `Ran 8 tests in 9.539s ... OK`, exit 0, every predicted PASS.
- Regression: `test_wiki_put.py` `20261013T114033Z_5e45cf57` — `Ran 15 tests ... OK`, exit 0.
- Build: `_build.ps1` `20261013T114131Z_e3fec434` — exit 0, `[OK] Build complete - artifacts in dist/`,
  smoke `10.0.1303`.
- Install: sha256-verified copies into `%USERPROFILE%/.org/genesis` (org.py `00e1f7ee…`, orgd.py `8f8d9656…`,
  Protocol.md `fce4f6e5…` — repo == installed); `init.py` there rc 0 (`tickets=43`, `fields present`,
  `server up`); orgd bounced old pid 25144 -> new pid 19540 (ticks advancing, no tracebacks in `orgd.log`);
  live `org.py protocol` serves the new text (10 916 B — VERIFY bullet, `--epoch N`, the effect contract
  all present); installed `done -h` shows `--epoch`.
- Divergences (trader's rule): (1) the FIRST baseline run `20261013T113356Z_36e315ba` was off-prediction —
  red for my own fixture bug: the schema `INSERT` had two values for three columns (`init.py:143` also sets
  `now()`), and `fossil sql` swallows a failed statement's exit code (t11) — the fixture now READS THE SCHEMA
  BACK and refuses to run without it; (2) the first post-change run was off-prediction at V2 — the test
  asserted a technote in `wiki list`, measured: `--technote` writes a tech note that `wiki list` never shows
  (`timeline -t e` lists it) — the instrument was corrected, the assertion kept.
- One commit names this plan (code + tests + Protocol + this file, at its `plans_completed/` path, + the
  rendered `plans/MASTER_PLAN.md`).
