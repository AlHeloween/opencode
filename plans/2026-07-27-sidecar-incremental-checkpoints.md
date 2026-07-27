# Sidecar incremental project checkpoints

## Intent

Replace the visible Layer-1 synthetic summary/resume lifecycle with a model-authored checkpoint sidecar. The normal visible conversation must remain byte-for-byte unchanged until ordinary Layer-2 compaction.

## Contract

```text
M (visible messages)
  -> ephemeral branch M + checkpoint instruction
  -> model returns checkpoint s
  -> persist s outside Message/Part
  -> restore visible M
  -> next real user turn uses M + user message
  -> later compact materializes message* from persisted checkpoint delta(s)
```

- No synthetic summary user message in `MessageTable`.
- No summary-only visible assistant message and no synthetic resume.
- The sidecar uses the same completed `M`, model, agent, and stable system prefix; it is not a pseudo-agent/personality.
- Sidecar records are system-owned: exact range, predecessor, model/agent identity, status, text, Fossil/CodeGraph enrichment.
- At normal continuation, restore/reuse the pre-sidecar provider checkpoint; only Layer-2 compaction invalidates it.
- The normal target remains the documented 65,536 content-token cadence, with a lower provider-safe fallback; the bounded Recent fold remains mandatory.
- A completed, unmaterialized sidecar record—not an assistant message—is the persisted Layer-1 boundary. Its range must be unique, non-overlapping, and idempotent.

## Smoke Tests

### Baseline — 2026-07-27

From `packages/opencode`:

```powershell
bun test test/session/compaction.test.ts
```

(Exact + baseline) 77 pass, 0 fail. The suite currently asserts the legacy `injectSummaryRequest()` behavior, so those assertions must be replaced rather than preserved.

### Post-implementation

From `packages/opencode`:

```powershell
bun test test/session/compaction.test.ts
bun test test/session/system-compose.test.ts
bun typecheck
```

Pass criteria:

1. A threshold checkpoint stores one sidecar record without adding a `message` or `part` row to the visible conversation.
2. The next normal request sees exactly `M + realUserDelta`; no checkpoint instruction, summary response, or resume reminder is converted to provider messages.
3. A duplicate trigger for the same completed range is idempotent.
4. Later `compact()` materializes stored checkpoint content plus Exact Fossil/CodeGraph data in `message*`, then invalidates the normal provider checkpoint once.
5. System-prefix and normal message fingerprints are unchanged across sidecar capture and restore.
6. A bounded `Recent` fold remains within the provider-safe effective target after materialization.
7. Fork, revert, delete, and in-place message edit paths cannot reuse an overlapping sidecar range.

## Implementation steps

- [x] Add a dedicated Drizzle table, migration, and migration registry entry. Require session FK cascade, chronological index, status/materialization metadata, and a unique session/range/predecessor key. Do not overload `message`, `part`, or encrypted provider checkpoint slots.
- [x] Persist and publish a normal encrypted provider checkpoint for exact completed `M` before capture. The ephemeral branch must never save or publish a checkpoint.
- [x] Extract current range selection, semantic-vector chaining, validation, and Fossil/CodeGraph enrichment into sidecar APIs. Preserve snapshot-disabled debug soft-fail behavior.
- [x] Capture with an isolated LLM stream collector, not `SessionProcessor` or the normal prompt loop: same provider/cache-agent identity and tools schema, `toolChoice: none`, immutable `M + checkpoint instruction`, cancellation handling, and no Message/Part/Event rows.
- [ ] Replace `assistant.summary` as the counter boundary with the latest completed unmaterialized sidecar. Enforce non-overlap and invalidate overlapping sidecars on edit, revert, fork, or deletion.
- [ ] Make Layer-2 compaction consume only eligible sidecars in chronological order and mark them materialized atomically with `message*`; retain Fossil/CodeGraph rendering. Remove the normal provider checkpoint only after that commit succeeds.
- [ ] Remove `injectSummaryRequest`, `hasPendingSummaryRequest`, retry/terminal markers, summary-only tools, and `injectSummaryResume` from normal message processing.
- [ ] Add sidecar, idempotency, restore/fingerprint, materialization, bounded-fold, fork/revert, and failure-isolation regression coverage; replace legacy synthetic-summary tests.
- [ ] Run post-implementation smoke tests, audit the plan against code, and move it to `plans_completed/` only when every item is verified.

## Risks

- The sidecar provider request is an ephemeral branch; restoring the normal encrypted provider checkpoint is mandatory so its temporary suffix cannot be published as the next normal state.
- A model-authored checkpoint is Inferred prose. Exact identifiers, snapshots, and structural impact remain system-computed.
- Sidecar failure must log at debug/warn level and leave normal workflow untouched; no retry may create visible messages.
- A 65,536 target is documented current behavior. Do not silently restore 32,768; use `summaryWindowLimit` only as the provider-safe lower bound.

## Runtime completion-flow correction — 2026-07-27

### Baseline

From `packages/opencode`:

- [Exact] `bun test test/session/checkpoint.test.ts` — 18 pass, 0 fail.
- [Exact] `bun test test/session/prompt.test.ts --test-name-pattern "Layer-1 captures a hidden checkpoint after a completed answer"` — 1 pass, 0 fail.

### Scope

- [x] Build and publish the normal provider checkpoint exactly once after the completed main turn; persist its encrypted disk copy asynchronously without delaying the main outcome.
- [x] Feed the 64K sidecar request from that already-built checkpoint's `systemPrompt` and `messages`; do not re-hydrate or re-convert visible history for the sidecar request.
- [x] Keep `summaryInFlight` scoped to the detached capture and clear it in `finally`; its success or failure must not change the main turn's original `break`/`continue` outcome.
- [x] Keep the summary body only in `project_checkpoint` until Layer-2 materializes `message*`; the normal provider checkpoint remains the active main state.
- [x] Add regression coverage for checkpoint publication before detached capture, one 64K sidecar call, and an unchanged next real-user request. Run focused checkpoint/prompt/compaction tests and `bun typecheck`.

### Verification — 2026-07-27

- [Exact] `bun test test/session/checkpoint.test.ts` — 18 pass, 0 fail.
- [Exact] `bun test test/session/prompt.test.ts --test-name-pattern "Layer-1 captures a hidden checkpoint after a completed answer"` — 1 pass, 0 fail.
- [Exact] `bun test test/session/compaction.test.ts` — 78 pass, 0 fail.
- [Exact] `bun test test/session/system-compose.test.ts` — 12 pass, 0 fail.
- [Exact] `bun typecheck` and `git diff --check` — pass.

## Incremental session-diff worker — 2026-07-27

### Baseline

From `packages/opencode`:

- [Exact] `bun test test/session/summary.test.ts` — 11 pass, 0 fail.

### Scope

- [x] Remove the global `SessionSummary.summarize()` launch from ordinary text turns.
- [x] At a completed write-tool step, retain the session's first Fossil base and recompute only files reported by that step from the base to its new snapshot; replace only those entries in `session_diff`. For a legacy session that already has `session_diff` but no base marker, read up to 10,000 messages once to recover its earliest snapshot.
- [x] Preserve exact per-turn Fossil diffs and rare Layer-1 range/CodeGraph enrichment; do not use an LLM or mutate model-visible messages. A no-snapshot path logs and retains the existing tool-`filediff` fallback.
- [x] Add regression coverage proving that normal text turns do not invoke the worker and repeated writes recompute only the changed file set. Reset write paths after every completed provider step; opaque writers reconcile Fossil once because they cannot report paths.
- [x] Run focused summary and snapshot-race tests, compaction regression, typecheck, and `git diff --check`.

### Smoke Tests

From `packages/opencode`:

```powershell
bun test test/session/summary.test.ts
bun test test/session/snapshot-tool-race.test.ts
bun test test/session/compaction.test.ts
bun typecheck
```

Pass criteria: the UI's session diff remains exact for files touched in a write step; normal text turns perform no history scan or Fossil diff; summary sidecar enrichment remains range-scoped.

### Verification — 2026-07-27

- [Exact] `bun test test/session/summary.test.ts` — 12 pass, 0 fail. Includes scoped repeated-write regression.
- [Exact] `bun test test/session/snapshot-tool-race.test.ts` — 1 pass, 0 fail. Opaque `bash` write receives a fresh Fossil hash and non-empty session diff.
- [Exact] `bun test test/snapshot/snapshot.test.ts --test-name-pattern "diffFull scopes a Fossil range to selected paths"` — 1 pass, 0 fail. The public Fossil wrapper forwards selected paths and excludes an unselected changed file.
- [Exact] `bun test test/session/compaction.test.ts` — 78 pass, 0 fail.
- [Exact] `bun test test/session/system-compose.test.ts` — 12 pass, 0 fail.
- [Exact] `bun test test/session/prompt.test.ts --test-name-pattern "Layer-1 captures a hidden checkpoint after a completed answer"` — 1 pass, 0 fail.
- [Exact] `bun typecheck` and `git diff --check` — pass.

### Commit boundary and P0 diagnosis — 2026-07-28

- [x] (Exact) Re-ran `summary.test.ts` (12/12), `snapshot-tool-race.test.ts` (1/1), selected-path `snapshot.test.ts` (1/1), `checkpoint.test.ts` (18/18), focused hidden-sidecar `prompt.test.ts` (1/1), `compaction.test.ts` (78/78), `system-compose.test.ts` (12/12), `bun typecheck`, `git diff --check`, and ADM verification (1,216 OK, 0 warnings). Committed the recovery boundary as `3be75d6`; `541724d` removes XML trailing whitespace. This remains diagnostic-only and is not push-ready until P0 suites pass.
- [x] (Exact) Diagnosed and resolved `processor-effect.test.ts`: raw `SessionProcessor.process()` returns `stop` after a completed turn (prompt run-loop owns continuation), so five stale `continue` expectations were corrected. Twelve live Fossil/Git integration cases now receive an explicit 30 second `it.live` deadline. `bun test test/session/processor-effect.test.ts` — 13 pass, 0 fail (2026-07-28).
- [ ] Obtain a bounded, diagnostic full `prompt.test.ts` result; remove or replace only legacy assertions that contradict the detached-sidecar contract.
- [ ] Use a new ADM descriptor for every corrective source/test/plan mutation. Apply it, run `tools/adm.exe --verify-all packages/opencode/src packages/opencode/test`, then run the affected Bun smoke tests.
- [ ] Only after P0 passes, continue the unimplemented sidecar lifecycle: completed-sidecar counter boundary, invalidation on history mutation, atomic `message*` materialization, and removal of the legacy synthetic summary flow.

### Unresolved validation

- [Exact] Full `bun test test/session/prompt.test.ts` exceeded the 180-second command limit without a diagnostic result.
- [Exact] `bun test test/session/processor-effect.test.ts` produced 1 pass and 12 failures/timeouts, including two asserted `continue` to `stop` mismatches. This is not accepted for a push and needs a separate bounded diagnosis.

<!-- ADID_ROLLBACK (from adm.exe)
  SDID_ROLLBACK {
    "target_file": "D:\\zPython\\opencode\\plans/2026-07-27-sidecar-incremental-checkpoints.md"
    "update_script": "adm.exe"
    "backup_path": "D:\\zPython\\opencode\\plans/2026-07-27-sidecar-incremental-checkpoints.md.backup_20260728T023332_902831"
    "created_at": "2026-07-27T18:33:32.920612+00:00"
    "backup_hash": "9020a7838ad243b50688a5f43ea36066"
    "new_hash": "8fd63aa64678a14289dbfefb21e2769e"
    "goal_id": "record_processor_effect_resolution"
    "semantics": "Record exact P0 resolution: raw processor ends the current turn with stop, prompt owns continuation, and Fossil and Git integration tests have an explicit bounded test deadline."
    "update_attrs": {"relative_path": "plans/2026-07-27-sidecar-incremental-checkpoints.md", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "- [ ] From the resulting clean Git base, diagnose `processor-effect.test.ts` with isolated test names and processor lifecycle traces. Resolve every timeout and `continue` / `stop` mismatch before the next commit.", "replace_present": true}
    "restore_cmd": "python -m adm \u002d\u002drollback \"D:\\zPython\\opencode\\plans/2026-07-27-sidecar-incremental-checkpoints.md\""
  }
-->
