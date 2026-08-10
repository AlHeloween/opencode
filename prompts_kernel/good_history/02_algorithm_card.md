# ALGORITHM_CARD — task geometry (routes, not essay)

# Canonical implementation: prompts_kernel.run_task_geometry

# Kernel symbols: ground, goal_seeds, goal_peaks, sv_delta,

# select_fractal_model, generate_fractal_candidates,

# adaptive_tau, adaptive_k, adaptive_depth (v6: evidence_coverage),

# k_medoids_modifications (→ CLARA when N≥100),

# select_medoids_tasks (internal geometry — agent uses read_task_store),

# read_task_store, transition_task (v6.0: executable task store API),

# lsystem_rewrite, residual_recluster (v6: returns (residual, discarded)),

# execute_medoid (v6.0: returns MATERIALIZED|BLOCKED|EXECUTION_FAILED),

# verify_oracles (v6.0: immutable result — returns {passed, failed, blocked}),

# emit_state (v6: +out_of_scope, +terminal, +terminal_mode),

# delta_l1, PLANNING (fractal_only)

# Spine invariant for ALL tasks — no trivial exceptions. One-character typo

# still: ground → scope → oracle → edit → verify → state.

# GROUNDED PATH (v6): speed from evidence density (codegraph indexed + history Exact),

# not task size. Well-mapped territory → shallower lattice via adaptive_depth.

# Task store (v6): kernel auto-materializes medoids via run_task_geometry().

# Orchestrator reads + transitions; todowrite is one interface to the store.

# NO Mode 1 / linear shortcut — soft step lists without lattice+k-medoids forbidden.

```python
# Bound symbols — every name resolves to a kernel function (read kernel if unsure)
from prompts_kernel import (
    run_task_geometry,           # FULL PIPELINE: ground→seeds→fractal→filter→state
                                 #   v6.0: returns task_store_id, version, goal_sv,
                                 #         execution_envelope
    read_task_store,             # v6.0: read tasks from authoritative store
                                 #   expected_store_version=None → latest snapshot
    transition_task,             # v6.0: atomic status transition with version guard
                                 #   returns {committed, task: {id, version, status,
                                 #            attempts, worker_id, lease_expires_at},
                                 #            store_version}
    execute_medoid,              # v6.0: returns MATERIALIZED|BLOCKED|EXECUTION_FAILED
    verify_oracles,              # v6.0: returns immutable {passed, failed, blocked}
    emit_state,                  # v6.0: {done, pending, blocked, next, goal_sv,
                                 #        out_of_scope, active, terminal, terminal_mode}
    residual_recluster,          # ADID loop closure: pending vs original Goal SV
    PLANNING,                    # policy.planning SPEC — fractal_only
)

# === STEP 0: bind inputs from kernel result ===
goal_sv = result.goal_sv
store_id = result.task_store_id
store_version = result.task_store_version
envelope = result.execution_envelope  # v6.0: explicitly bound — signed by user

# === STEP 1–5: KERNEL PIPELINE (one call) ===
result = run_task_geometry(goal, evidence_texts=[...])
# result = {
#   task_store_id, task_store_version,         # authoritative store handle
#   goal_sv, execution_envelope,                # v6.0: Goal SV + signed envelope
#   seeds_n, peaks, model, depth,               # fractal configuration
#   candidates_n, filtered_n, tau, k_recommended, # filter + cluster params
# }

# === Helper: commit or reload (v6.0 symmetric pattern) ===
# Every transition follows this contract:
#   No local state mutation before store transition is committed.
#   On conflict: reload latest snapshot, skip/resolve, never guess.
def commit_or_reload(tr, store_id, local_list=None):
    if tr.committed:
        if local_list is not None:
            local_list.append(tr.task)
        return tr.task, tr.store_version, True
    # Version race or conflict — reload authoritative state
    snapshot = read_task_store(store_id=store_id, expected_store_version=None)
    return None, snapshot.store_version, False

# === STEP 6–7: execute loop — atomic claim with lease + materialize (v6.0) ===
# REUSE_BEFORE + SMOKE_BEFORE — prior art + baseline before first edit.
# v6.0: each claim includes worker lease (worker_id, lease_id, lease_expires_at).
#       commit_or_reload() — no local state before store transition committed.
#       Executor returns materialization status — NOT Done (only Oracle promotes).
#       EXECUTION_FAILED bounded by envelope.approval_payload.attempts_max.
worker_id = f"worker-{os.getpid()}"
while True:
    tasks = read_task_store(
        store_id=store_id,
        expected_store_version=store_version,
        status="pending",
    )
    if not tasks:
        break

    task = tasks[0]  # one in_progress (PLANNING invariant)

    # Atomically claim with worker lease:
    claim = transition_task(
        store_id=store_id,
        task_id=task.id,
        expected_task_version=task.version,
        from_status="pending",
        to_status="in_progress",
        worker_id=worker_id,
        lease_expires_in_sec=300,  # 5 min — heartbeat refreshes
    )
    task, store_version, ok = commit_or_reload(claim, store_id)
    if not ok:
        continue

    status, output = execute_medoid(task)

    if status == 'MATERIALIZED':
        tr = transition_task(
            store_id=store_id,
            task_id=task.id,
            expected_task_version=task.version,
            from_status="in_progress",
            to_status="materialized",
            worker_id=worker_id,
        )
        task, store_version, ok = commit_or_reload(tr, store_id)

    elif status == 'BLOCKED':
        tr = transition_task(
            store_id=store_id,
            task_id=task.id,
            expected_task_version=task.version,
            from_status="in_progress",
            to_status="blocked",
            reason=output,
        )
        task, store_version, ok = commit_or_reload(tr, store_id)

    else:  # EXECUTION_FAILED — bounded retry
        attempts = task.attempts + 1
        max_attempts = envelope.approval_payload.attempts_max
        target = "blocked" if attempts >= max_attempts else "pending"
        tr = transition_task(
            store_id=store_id,
            task_id=task.id,
            expected_task_version=task.version,
            from_status="in_progress",
            to_status=target,
            attempts=attempts,
            last_failure=output,
        )
        task, store_version, ok = commit_or_reload(tr, store_id)

# === STEP 8: verify — Oracle queue from AUTHORITATIVE store (v6.0 resume-safe) ===
# Materialized tasks read from store — NOT process-local list.
# This enables resume/replay after restart, compaction, or worker handoff.
snapshot = read_task_store(store_id=store_id, expected_store_version=None)
materialized = [t for t in snapshot if t.status == 'materialized']

verification = verify_oracles(materialized_tasks=materialized)
completed, pending, blockers = [], [], []

for task in verification.passed:
    tr = transition_task(
        store_id=store_id,
        task_id=task.id,
        expected_task_version=task.version,
        from_status="materialized",
        to_status="done",
        oracle_stamp=verification.get_stamp(task.id),
    )
    task, store_version, ok = commit_or_reload(tr, store_id, completed)

for task in verification.failed:
    tr = transition_task(
        store_id=store_id,
        task_id=task.id,
        expected_task_version=task.version,
        from_status="materialized",
        to_status="pending",
        oracle_result="FAIL",
    )
    task, store_version, ok = commit_or_reload(tr, store_id, pending)

for task in verification.blocked:
    tr = transition_task(
        store_id=store_id,
        task_id=task.id,
        expected_task_version=task.version,
        from_status="materialized",
        to_status="blocked",
        reason="oracle unavailable",
    )
    task, store_version, ok = commit_or_reload(tr, store_id, blockers)

# Read fresh snapshot for pending/blocked from store (non-materialized):
snapshot = read_task_store(store_id=store_id, expected_store_version=None)
pending   = pending + [t for t in snapshot if t.status == 'pending']
blockers  = blockers + [{'task': t, 'reason': 'blocked in execution'}
                        for t in snapshot if t.status == 'blocked']

# === STEP 9: residual + reconciliation + final state from authoritative store (v6.0) ===
provisional = emit_state(
    goal_sv=goal_sv,
    completed_tasks=completed,
    pending_tasks=pending,
    blockers=blockers,
    next_step=None,
    out_of_scope=[],
    active=[],
    terminal=False,
)
residual, discarded = residual_recluster(provisional, original_goal_sv=goal_sv)

# Commit discarded: pending → out_of_scope
for task in discarded:
    tr = transition_task(
        store_id=store_id,
        task_id=task.id,
        expected_task_version=task.version,
        from_status="pending",
        to_status="out_of_scope",
        reason="did not pass Goal-SV residual threshold",
    )
    _, store_version, _ = commit_or_reload(tr, store_id)

# Read authoritative final snapshot:
final_snapshot = read_task_store(store_id=store_id, expected_store_version=None)
done_tasks      = [t for t in final_snapshot if t.status == 'done']
pending_tasks   = [t for t in final_snapshot if t.status == 'pending']
blocked_tasks   = [t for t in final_snapshot if t.status == 'blocked']
discarded_tasks = [t for t in final_snapshot if t.status == 'out_of_scope']
active_tasks    = [t for t in final_snapshot if t.status in ('in_progress', 'materialized')]

# Lease-aware orphan reconciliation (v6.0):
#   in_progress + lease_expires_at < now + no heartbeat → orphan → blocked
#   materialized → NOT an orphan (ready for Oracle — resume, don't block)
now = datetime.now(timezone.utc)
orphans = [t for t in active_tasks
           if t.status == 'in_progress'
           and t.lease_expires_at
           and t.lease_expires_at < now]
for task in orphans:
    tr = transition_task(
        store_id=store_id,
        task_id=task.id,
        expected_task_version=task.version,
        from_status="in_progress",
        to_status="pending",    # return to queue for another worker
        reason="lease expired — orphaned task",
    )
    _, store_version, _ = commit_or_reload(tr, store_id)

# Re-read after reconciliation:
final_snapshot = read_task_store(store_id=store_id, expected_store_version=None)
pending_tasks   = [t for t in final_snapshot if t.status == 'pending']
blocked_tasks   = [t for t in final_snapshot if t.status == 'blocked']
active_tasks    = [t for t in final_snapshot if t.status in ('in_progress', 'materialized')]
materialized    = [t for t in final_snapshot if t.status == 'materialized']

# Final emit_state (v6.0 — active included, terminal requires both empty):
state = emit_state(
    goal_sv=goal_sv,
    completed_tasks=done_tasks,
    pending_tasks=pending_tasks,
    blockers=blocked_tasks,
    next_step=pending_tasks[0] if pending_tasks else None,
    out_of_scope=discarded_tasks,
    active=active_tasks,                              # v6.0: in_progress + materialized
    terminal=bool(not pending_tasks and not active_tasks),
)
# Terminal modes (v6.0):
#   terminal=True,  terminal_mode=SUCCESS      — pending=[], active=[], materialized=[], blocked=[]
#   terminal=True,  terminal_mode=BLOCKED      — pending=[], active=[], blocked≠[]
#   terminal=True,  terminal_mode=OUT_OF_SCOPE — pending=[], active=[], out_of_scope≠[]
#   terminal=False, terminal_mode=CONTINUE     — pending or active non-empty
#   terminal=False, terminal_mode=RESUME       — materialized non-empty (Oracle pending)
# Precedence: BLOCKED > OUT_OF_SCOPE > SUCCESS.
# Invariant: Gate 9 emission includes active tasks; terminal requires active empty.
# materialized tasks survive restart — read from store, feed to Oracle.
# Never re-fractal the whole universe; no Mode-1 fallthrough.
```

# Spine invariant: no trivial exceptions. Every task — even one character —

# follows the full sequence. Speed from evidence density, not task size.

# v6: ExecutionEnvelope pre-approves MODIFY_CANDIDATE within scope+budget.

# PROMOTE_STABLE and SELF_MODIFY always require explicit user approval.
