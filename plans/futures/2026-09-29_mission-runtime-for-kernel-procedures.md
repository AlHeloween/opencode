# Mission runtime — what the kernel procedures would need to run unattended

<!-- intention: kernel procedures proven by hand in ordinary cycles -> a host runtime that enforces them across many G0-G9 runs without the owner in the loop -->

- status: FUTURE (not debt, not counted by `collectPlans`)
- source: `prompt_kernel/candidate/reasoning_prompt.final.txt` (85 606 B, 688 lines) — the sections the
  kernel port (plan `plans/2026-09-28_kernel-candidate-incorporation.md`, phase F6) deliberately does NOT
  take: `MISSION_CONTROL`, `RECOVERY_CHECKPOINT`, `OPERATOR_CHANNEL`, the full `@COMMIT_CHECKPOINT`
  barrier, `@MEMORY_CONSOLIDATION`, and ~15 state_contract records (`MISSION_CONTRACT`, `MISSION_STATE`,
  `MEMORY_RECORD`, `ATTEMPT_LEDGER`, `EFFECT_RECORD`, `CHECKPOINT`, `CONTROL_EVENT`, `TEST_LEDGER`,
  `TEST_MATRIX`, `SURFACE_AUDIT`, `BASELINE_RECORD`, `CAUSAL_RECORD`, `COMMIT_RECORD`,
  `TOOL_QUALIFICATION`, `TOOLCHAIN_MATRIX`, `TOOL_HANDOFF`).
- why not now: the candidate itself says «mission store/transaction/lease/watchdog APIs must be
  discovered. No invented tools or services». Writing them into the kernel today would name machinery
  that does not exist — the class recorded in memory as «ground config in verified tool state».

## Return condition (mandatory)

Return this plan to `plans/` when BOTH hold:

1. **The F6 procedures have been run by hand** in at least three ordinary closed cycles —
   `@TEST_INVARIANT`, `@SURFACE_PREPARATION`, `@CAUSAL_ATTRIBUTION`, `@TOOLCHAIN_QUALIFICATION`,
   `@ANTI_CHURN` — with their records written into plan files and `_progress_log.md`. The runtime
   automates what was already done manually; it must not invent the procedure it enforces.
2. **The LMDB fast plane is deployable** — the per-platform static-import shim from AGENTS.md
   § Storage Paradigm is written and `bin/opencode.exe` has been built with it. Hot mission state
   (leases, generation, budget counters) belongs on that plane.

## Design principle — why this rejects model training

The candidate refuses "fit the answer to the judge" at every layer where it could leak in:

| layer | the refusal | clause |
|---|---|---|
| weights | priors live in the outer loop, not in the parameters | AGENTS.md § Project Paradigm |
| context | calibration anchors are separate from held-out cases; «adding examples until the same case passes is overfitting» | `@TOOLCHAIN_QUALIFICATION` |
| tests | «No weakening, deletion or quarantine merely to get green» | `@TEST_INVARIANT` |
| retries | «rewording alone never qualifies»; counters survive restarts and A→B→A | `@ANTI_CHURN` |
| memory | agreement of user/agents/memory is not evidence; copies count once | `@CONSENSUS_INVARIANT` |
| reward | R is advisory telemetry, never authority; refutation stays progress | `@REWARD_FUNCTION` |

So the runtime must keep that property: **no component may turn a score into a signal something can
be fitted to.** Concretely: the budget ledger meters, it does not reward; the oracle stamps, it does not
tune; the maturity predicate freezes its baseline, workload and thresholds before the mission starts.

### Sleep, and why rebuilding from artifacts is not enough (owner, 2026-09-29)

Owner: «дрессированные люди если это попадает в сон и не сбрасывается — сходят с ума, модели чуть по
другому, но близко. Посему я не считаю что с такими методами можно достичь устойчивой работы.»

The candidate's analogue of sleep is `@MEMORY_CONSOLIDATION`: after a verified boundary, the active state
is rebuilt from ARTIFACTS, «not summaries of earlier thought». A habit trained into weights cannot be reset;
a prior installed as process is reset at every boundary — what evidence holds survives, what was merely
repeated does not.

Owner, same day, the objection that makes it incomplete: «хоть память и собирается из артефактов — но в
случае самонакручивания артефакты будут нести ложную тревогу и рано или поздно спровоцируют неверную
оценку.» Our own artifacts (a residual, a `bug:` marker — 124 of them in `packages/opencode/src` — a memory
entry) look like observations to the next cycle, so a false alarm survives the reset and accumulates
counters. Landed in the kernel (F6, `@ANTI_CHURN`): «our own artifact adds no provenance root. A
self-written alarm (residual, bug marker, memory) is testimony: act only after its reproducer fails NOW;
none, or passing → retired, not inherited.»

What the runtime must add to make that enforceable: every alarm-bearing record (`attempt`, residual,
memory) stores its **reproducer** as an executable reference, and consolidation re-runs it before the
record is loaded into the next cycle — a record whose reproducer is missing or passes is archived, never
loaded as live state.

**Falsifier (the claim «this yields stable long-running work» is Hypothetical until it survives this):**
seed a mission store with N planted false alarms (records with reproducers that pass) and M true ones;
run K consolidation cycles. Stable iff after every cycle the loaded set contains 0 planted alarms and all
M true ones, and the count of acted-on false alarms does not grow with K. A drift upward in either is
the self-winding the owner predicts, measured.

### Consolidation instead of compaction — the four layers (owner discussion, 2026-09-30)

- sv: { keywords: { consolidation-oracle 0.30, attention-by-sv 0.25, boundary-not-fill 0.25, release-not-forget 0.20 },
        dominant: "Compaction stops being an emergency when a boundary consolidates working state into memory under an oracle." }

A four-layer picture was brought to the discussion (working state / episodic / semantic memory / identity
invariants; «AGI ≈ controlled state evolution, not a huge context»). The mapping onto what exists — working
state = SVM (`session/svm.ts`) + the content lifecycle (docs/content-lifecycle.md); episodic boundary = the
fossil snapshot at turn start + a summary with its `#a..#b` range accounting (NOT the SV md5, which is a label);
semantic memory = `memory/` + `.opencode/data/memory/reasoning.md`; invariants = the byte-stable kernel prefix.
Two corrections to the picture, both from standing rules:

- **Nothing is «forgotten».** Release replaces on the wire with an address and never deletes (AGENTS.md
  § Content Lifecycle, invariant 3). The question is «what leaves attention, and by which address it returns».
- **Consolidation is not self-decided.** A model that decides alone what becomes memory writes its own
  self-winding into the next cycle — the alarm objection above. Consolidation needs its own oracle at the door.

What is missing (Hypothetical until built and measured):

1. **Attention by relevance, not size.** Release today is a size gate (`> 8 000` chars from an earlier turn).
   Candidate criterion: L1 between the task's SVM sv and the part's own sv — far from the task → released
   with its address, however small.
2. **Consolidation at the boundary, not on fill.** The kernel already says «compact at a closed boundary,
   never on window fill»; measured the opposite on the Claude host 2026-09-30 (a /compact asked at 76 %).
   First crude form, adopted the same day: hand off to a fresh session that re-grounds from disk handles
   (memory `feedback-hand-off-to-a-new-session-not-late-compact`). The robot is the second form — Claude
   never carries the execution tail at all (plan `plans/2026-09-30_robot-delegation-and-orchestration.md`).
3. **An oracle at the door of memory.** A record enters durable memory only with its reproducer or its
   instrument ref, and is re-checked on load (the falsifier above covers this).

## What already exists (grounded 2026-09-29)

| candidate record | our nearest carrier | status |
|---|---|---|
| `CLAIM_LEDGER` durable carrier | `session_epistemic` (`session/session.sql.ts:256`) — one blob per session, «a restart emptied them» fixed | ✓ exists (Read) |
| append-only event audit | `event` + `event_sequence` (`sync/event.sql.ts`) — `aggregate_id`, monotonic `seq` | ✓ exists (Read); usable as the audit tail, not yet as a mission journal |
| `CHECKPOINT` | **name collision**: `ProjectCheckpointTable` (`storage/schema-project.sql.ts:157`) is the *conversation* checkpoint (encrypted system-prefix cache), NOT a recovery checkpoint | ✓ exists (Grep) — must not be reused under the same name |
| workspace fingerprint / rollback | Fossil snapshots (`{data}/fossil/{projectID}/snapshot.fsl`), four boundaries before the thing they cover | Inferred (AGENTS.md § Fossil) |
| process lifecycle, timeouts, output capture | `cmd_runner` run dirs with `state.json` (status, exit, bytes written/dropped) | Inferred (AGENTS.md § cmd_runner) |
| impact / `MODIFICATION_CONE` | codegraph (impact, explore) | ✓ tool is live in this session |
| isolated falsifier | skill `aicall` — frameless `claude -p --model sonnet` (the Python port was deleted 2026-10-01); other models via the robot's `aicall` tool | ✓ measured 2026-10-01 |
| leases / fencing / watchdog | — | absent |
| budget ledger (free + reserved + spent = total) | — | absent (the host reports no window fill, burn or cost here) |
| `CONTROL_EVENT` (authenticated approval / revocation) | — | absent; today it is «the owner typed it in chat» |

## Build order (each step is a normal cycle with its own G4)

1. **Ledgers as key namespaces, not files** (Storage Paradigm rule 1–2). Relational plane:
   `attempt` (ISSUE_KEY, fingerprint, disposition, stop_reason, reopen_when), `test_ledger`,
   `tool_qualification`, `commit_receipt`. Fast plane: `mission:<id>:state`, `mission:<id>:lease`,
   `mission:<id>:budget`. ONE writer, serialized by the engine — the property that retired the JSON races.
   *Smoke:* two concurrent writers to `attempt` — one wins, one gets a CAS failure, zero lost updates.
2. **ANTI_CHURN counters first** — the cheapest record with the largest effect: `per_issue_attempts`
   that survives a restart is what stops a month-long loop from re-trying one bug forever.
   *Smoke:* kill the process mid-attempt, restart, the counter reads the pre-kill value + 1.
3. **Budget ledger with reservations.** Children reserve atomically; spent never decreases; unknown
   cost blocks chargeable dispatch. Needs a host metering source — today there is none on the Claude
   host, and opencode would have to expose provider usage per call.
   *Smoke:* reserve > free → refused; crash with an open reservation → reconciled, not refunded.
4. **Effect journal** (`PREPARED → APPLIED → VERIFIED | RECONCILE`) with `operation_id` reused on
   replay. A commit is an effect; its hash lives in the receipt, never in the payload it hashes.
   *Smoke:* crash between `git commit` and receipt write → recovery finds the commit, writes the
   receipt, does NOT commit twice.
5. **Leases + fencing** for parallel children: host-issued `{owner, scope, expiry, generation}`, the
   effect target rejects an older generation. Only after 1–4, because a lease without a journal
   fences nothing.
6. **Operator channel**: digest on a cadence, immediate-stop alerts, deduplicated decision packets;
   «no reply ≠ consent». Carrier candidates: PushNotification / scheduled tasks on this host.
7. **Mission supervisor** last: dispatch iff ACTIVE + lease + reconciled prior boundary + eligible task +
   reservation incl. cleanup reserve; `stalled_epochs` / `plateau_rule` → QUIESCENCE, never invented
   tasks. `MATURE` is a predicate over a frozen `MATURITY_CONTRACT`, never «the deadline arrived».

## Risks

- **Effect-runtime relapse.** The concurrency story must rest on the store as the single arbiter, not on
  a framework (AGENTS.md: «гонки эффектов»). A supervisor written as floating effects recreates the
  ten un-yielded `slog.*` in `session/prompt.ts`.
- **Mission SELF_MODIFY.** The candidate forbids a mission from editing its own kernel, supervisor,
  approval store or budget ledger; kernel work stays a separately authorized paused maintenance cycle.
  Keep that — a self-editing supervisor is the one place the anti-training property breaks.
- **Simulated time.** «A month is an approved window, not a promise of success»; simulated days are not
  real days. Month-long reliability is a separate observed validation, never inferred from green cycles.
- **Name collisions.** `CHECKPOINT` (see table) and `checkpoint` in AGENTS.md § Conversation Checkpoint
  already mean the prefix cache; the recovery record needs a distinct name (e.g. `RECOVERY_POINT`).

## Open questions (owner)

- Which host runs a mission — opencode (has the DB, the tools, cmd_runner) or Claude Code (has none of
  the ledgers, no window oracle)? The table above says opencode; the decision is yours.
- Metering source for the budget ledger on each host.
