# Mechanistic Compaction — Stable Continuous Memory

**Status:** production design, sidecar Layer-1 migration in progress
**Last updated:** 2026-07-27
**Code:** `packages/opencode/src/session/{prompt,compaction,incremental-checkpoint,summary,checkpoint}.ts`

## Contract

Layer 1 is a hidden, incremental project checkpoint. It is not a message, a mode,
or a pseudo-agent. The normal conversation remains an uninterrupted sequence.

```text
M (visible conversation)
  -> persist normal encrypted provider checkpoint for exactly M
  -> ephemeral provider branch: M + checkpoint instruction
  -> model returns checkpoint s
  -> persist s + exact range/diff/impact in project_checkpoint
  -> retain visible M unchanged
  -> next real user turn: M + user delta
  -> Layer 2 materializes message* from sidecar checkpoints + Recent
```

The ephemeral branch is never stored in `message`, `part`, event history, or the
normal provider checkpoint. Therefore it cannot replay as a user instruction,
resume a completed task, or alter the next normal provider prefix.

## Model versus system

| Owner | Data |
|---|---|
| Model (Inferred) | `## Semantic Vector`, `## Goal`, `## Key decisions`, `## Current state` |
| System (Exact) | range IDs, sidecar identity/status, cadence counter, Fossil diffs, CodeGraph impact, materialization marker, soft-hide flags, `message*` |

The model must not invent message IDs, session IDs, hashes, file diffs, or graph
results. Exact data is stored beside the inferred body in `project_checkpoint`.

## Layer 1: sidecar capture

- Trigger only after a normal assistant turn fully completes: no unresolved
  reasoning part and no pending tool-call loop.
- The normal target is `SUMMARY_INTERVAL_TOKENS = 65_536` content tokens
  (`chars / 4`), with a lower provider-safe fallback that reserves response and
  reasoning headroom.
- The request uses the same model, agent/cache identity, stable system prefix,
  and tools schema as the normal turn; `toolChoice` is `none`.
- It is collected by an isolated LLM stream, not `SessionProcessor`. Sidecar
  output therefore cannot create tool results, assistant rows, resumes, or a
  new prompt-loop step.
- A valid body has all four required sections. Failed capture logs at debug and
  leaves the visible conversation and normal checkpoint untouched.
- A completed unmaterialized sidecar is the Layer-1 counter boundary. The next
  range starts after its `to_message_id`.

```text
(m, m, m) --capture--> (m, m, m) + sidecar(s)
                         ^ visible provider history is byte-stable
```

## Layer 2: algorithmic materialization

On content/provider overflow, `compact()` soft-hides visible history and emits:

```text
message* = sidecar checkpoint bodies + Exact handles + bounded Recent fold
```

Each sidecar block is labelled `checkpoint_id`, not `summary_message_id`, and
contains its `from_id`/`to_id`, persisted Fossil diff, and CodeGraph structural
impact. After `message*` exists, those sidecars are marked materialized and the
normal provider checkpoint is removed. The next successful normal turn creates
a new checkpoint from the compacted visible set.

`message*` is the only synthetic visible memory artifact. It is user-visible and
provider-visible; older soft-hidden rows remain recoverable through
`session-read`, `messagesearch`, Fossil, and CodeGraph.

## KV-cache rule

Normal turns must preserve byte identity of the provider system prefix and all
prior visible messages. Sidecar capture may add a temporary request only on its
private branch. The saved normal provider checkpoint remains `M`, not
`M + checkpoint request + checkpoint response`. Layer-2 compaction is the one
intentional cache-era boundary.

## Forbidden designs

| Never | Reason |
|---|---|
| Synthetic visible summary user message | It becomes replayable conversation state. |
| Synthetic resume after a checkpoint | It can restart completed work or pressure reasoning. |
| Separate summary agent/personality | It changes the identity/prefix and is outside the actual project flow. |
| Model-authored IDs, diffs, or hashes | Digital facts are system-owned. |
| Hard-delete source messages | The archive is the Exact recovery surface. |
| Publish the ephemeral branch checkpoint | It poisons the next normal cache prefix. |

## Validation invariants

1. Capturing a sidecar does not add a visible `message` or `part` row.
2. The next normal request contains exactly retained `M` plus the real user
   delta; no checkpoint instruction, checkpoint body, or resume exists there.
3. Sidecar ranges are chronological, unique, and non-overlapping.
4. `message*` carries the persisted exact handles without recomputing model
   prose, and Recent remains bounded to the effective provider-safe target.
5. The encrypted normal checkpoint is removed only after materialization.
