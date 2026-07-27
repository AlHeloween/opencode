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
