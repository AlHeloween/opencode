# Mechanistic Compaction — Stable Continuous Memory

**Status:** production (aligned with code 2026-07-30)  
**Last updated:** 2026-07-30  
**Code:** `packages/opencode/src/session/{prompt,compaction,overflow,processor,incremental-checkpoint,summary,checkpoint}.ts`  
**Process graph:** [`session-memory-graph.md`](session-memory-graph.md)  
**Finish-step TX graph:** [`finish-step-tx-graph.md`](finish-step-tx-graph.md)

This document is the **canonical** memory-path description. If another doc
disagrees (especially AGENTS.md excerpts that still say “inject summary
request”), **this file + code win**.

---

## Contract (current production)

Layer 1 is a **hidden sidecar project checkpoint**, not a normal chat message
and not a pseudo-agent. Visible conversation `M` stays byte-stable across capture.

```text
M (visible conversation)
  -> Checkpoint.publish/persist exact model-ready M
  -> maybeCaptureSidecar (ephemeral LLM branch: M + checkpoint instruction)
  -> model returns body s (Inferred sections only)
  -> project_checkpoint row: s + Exact range/diff/impact
  -> visible M unchanged
  -> next real user turn: M + user delta
  -> Layer 2 compact() folds open sidecars + Recent → message* (ZERO LLM tokens)
```

The ephemeral sidecar branch is **not** written to `message` / `part` / event
history / the normal provider checkpoint. It must not replay as a user turn.

### Dual path (Exact — do not document as gone)

| Path | Role today |
|------|------------|
| **Primary** | `maybeCaptureSidecar` → `project_checkpoint` + `computeOpenWindowTokens(…, sidecarBoundary)` |
| **Legacy still in code** | `injectSummaryRequest` / `hasPendingSummaryRequest` / `assistant.summary` rows; `compact()` still **folds** legacy summary assistants when present |

**Target end-state** (not fully shipped): remove synthetic in-band summary
messages; only sidecar + `message*`. Until then, docs must not claim “no
synthetic summary user message exists in the codebase.”

---

## Model versus system

| Owner | Data |
|-------|------|
| Model (Inferred) | `## Semantic Vector`, `## Goal`, `## Key decisions`, `## Current state` |
| System (Exact) | range IDs, sidecar id/status, cadence counter, Fossil diffs, CodeGraph impact, materialization, soft-hide, `message*` |

The model must not invent message IDs, session IDs, hashes, file diffs, or graph
results.

---

## Token geometry (Exact)

| Use | Formula | Notes |
|-----|---------|--------|
| Open-window **cadence** (Layer-1 counter, Layer-2 gate) | `contentTokens = symbols / 4` | `computeOpenWindowTokens`; **no** +10k |
| Layer-1 sidecar **threshold** | `summaryWindowLimit(target=65_536)` | may be **lower** than 65K on small context (LLM headroom) |
| Layer-1 sidecar **request fit** | `content/4 + 10_000 < usable()` | safety only |
| Layer-2 **in-band** compact gate | `needsContentCompaction(openTokens ≥ 65_536)` | **zero LLM tokens** — never `usable()` |
| Emergency compact (processor) | `isOverflow(tokens)` or `requestTokens ≥ usable()` | hard context safety |
| Full-request safety estimate | `requestTokens = content/4 + 10_000` | tokenizer stack **removed** (undercounts providers) |

```text
tokenizer  <  provider_actual  ≤  symbols/4 + 10_000   (empirical)
```

Constants: `SUMMARY_INTERVAL_TOKENS = 65_536`, `CHARS_PER_TOKEN = 4`,
`REQUEST_OVERHEAD_TOKENS = 10_000` in `overflow.ts` / `compaction.ts`.

---

## Layer 1: sidecar capture (LLM tokens)

**When:** after a normal assistant turn fully completes (`stop`, no open tools /
open reasoning). Implemented in `prompt.ts` → `maybeCaptureSidecar`.

**Gate:**

1. `openTokens ≥ summaryWindowLimit({ target: 65_536 })`  
2. `estimateRequestTokens(openTokens) < usable(model)` (input must fit)

**How:**

- Same model / agent / cache identity / stable system as the main turn  
- Isolated `LLM.stream` with `toolChoice: "none"` (not `SessionProcessor`)  
- Body validated (`isValidSummaryBody` — four sections)  
- Fossil/CodeGraph enrichment is system Exact  
- Persist via `IncrementalCheckpoint.save` → `project_checkpoint`

```text
(m, m, m) --capture--> (m, m, m) + open sidecar(s)
                         ^ visible M unchanged
```

Open-window counter: `computeOpenWindowTokens(msgs, latestOpen?.toMessageID)`.
Legacy `assistant.summary` is **not** the counter boundary (sidecar path).

---

## Layer 2: `compact()` (ZERO LLM tokens)

**`compact()` never calls the provider.** It only reorganizes DB state.

### In-band cadence (prompt loop)

```text
needsContentCompaction({
  openTokens: computeOpenWindowTokens(msgs, sidecarBoundary),
  target: SUMMARY_INTERVAL_TOKENS,  // 65_536 content tokens
})
  → compact({ threshold: summaryWindowLimit(...) })  // threshold trims Recent only
  → Checkpoint.remove
```

**Must not** use `isOverflowFromContent` / `usable()` for this gate (B6). Those
wait until ~85% of a 1M context before firing.

### Emergency (processor finish-step)

```text
isOverflow(provider tokens) OR contentTokenEstimate ≥ usable()
  → needsCompaction → compact()
```

### What `compact()` builds

```text
message* = open sidecar bodies (+ legacy summary rows if any)
         + Exact handles (range, diffs, impact)
         + bounded Recent fold
```

- Soft-hide all current visible rows (`info.compacted = true`) — **never delete**  
- Insert synthetic user `message*` text part  
- `IncrementalCheckpoint.materialize` open sidecars onto the new message id  
- Checkpoint slot removed; next successful turn re-saves from compacted visible set  

Lone `message*` with nothing new is idempotent (no-op).

---

## Loop shape

```text
(m, m, m) + sidecars
  → compact → (message*)
  → (message*, m, m, …) + new sidecars when open window ≥ 65K again
  → compact → (message**)
```

After compact, open-window counter ≈ `len(message* body)/4` until growth.

---

## KV-cache rule

Normal turns preserve byte identity of the stable system prefix and retained
visible messages. Sidecar capture is ephemeral and must not publish into the
normal checkpoint. Layer-2 compaction is the intentional cache-era boundary.

---

## Forbidden designs

| Never | Reason |
|-------|--------|
| Treat compact as an LLM call / gate it on `usable()` for cadence | Compact is zero-token; 1M models never cadence |
| Rely on BPE/tiktoken as sole request size authority | Undercounts vs provider ground truth |
| Model-authored IDs, diffs, hashes | Exact is system-owned |
| Hard-delete source messages | Archive is Exact recovery (`session-read` / search) |
| Publish ephemeral sidecar branch as normal checkpoint | Poisons next prefix |
| New synthetic summary **agent** / personality | Breaks identity / KV |

**Legacy caveat:** `injectSummaryRequest` still exists. Do not add *new*
synthetic visible summary UX; prefer sidecar. Removing the dual path is
remaining cleanup, not “already done.”

---

## Validation invariants

1. Sidecar capture does not add visible `message`/`part` rows for the body.  
2. Next normal request = retained `M` + real user delta (no checkpoint prose).  
3. Sidecar ranges chronological / non-overlapping (idempotent save).  
4. `message*` carries Exact handles; Recent bounded when needed.  
5. Normal encrypted checkpoint removed only after compact materialization path runs.  
6. In-band compact fires near **65K open content**, independent of 1M `usable()`.

---

## Related

| Doc | Role |
|-----|------|
| [`session-memory-graph.md`](session-memory-graph.md) | End-to-end mermaid graphs |
| [`finish-step-tx-graph.md`](finish-step-tx-graph.md) | Step-boundary DB TX (not memory) |
| [`architecture.md`](architecture.md) | Stack diagram (must match this file) |
