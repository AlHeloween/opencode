---
title: Summary Exact handles
owner: Local_Development
last_verified: 2026-09-21
reproduce:
  files:
    - packages/opencode/src/session/prompt.ts
    - packages/opencode/src/session/summary.ts
    - packages/opencode/src/session/sidecar-policy.ts
  commands:
    - cd packages/opencode && bun test test/session/summary-anchors.test.ts test/session/summary-sidecar.test.ts test/session/summary-cadence.test.ts test/session/summary.test.ts
  inputs: A Layer-1 capture range whose messages carry snapshot anchors (or completed write/edit/multiedit parts for the fallback).
  expected_outputs: A sidecar checkpoint with model summary body plus system-authored file diffs and CodeGraph impact.
---

# Summary Exact handles (snapshot anchors + tool diffs + CodeGraph)

**Critical contract** for Layer-1 `s` rows (`project_checkpoint` / enrichRange).  
Code: `session/summary.ts` (`summaryRangeStartHash`, `mergeAnchorDiffs`, `enrichRange`), `snapshot/fossil.ts` (`diffFull`).

**The range diff derives from the snapshot anchors the undo/redo chain already stores** (2026-09-21):
`step-start`/`step-finish` carry the turn's baseline and `patch` parts carry the pre-write context, so ONE
fossil diff (anchor → working copy) answers what the whole worktree did in the range — shell-made edits,
deletions and renames included. Tool write/edit/multiedit filediffs are merged on top (they backfill snippets
where the chain ships stats only and carry paths the chain has not taken in yet) and are the whole answer
where no anchor resolves. See [fossil-snapshot.md](fossil-snapshot.md) for the chain itself.

---

## Content vs summary

```text
Content M:  [m m m] …     ← never polluted by s
s in DB:         s1 …     ← outside content; only compact → m*
```

---

## Exact sources (anchors + merge)

```text
range messages (from_id..to_id)
  → summaryRangeStartHash: first anchor in range, else last anchor before it
  → Snapshot.diffFull(anchor)  — fossil <anchor> → working copy (whole worktree)
  → mergeAnchorDiffs(anchored, collectToolFileDiffs(range))
  → CodeGraph impact on the merged file paths (worktree-relative)
```

| Piece | Source |
|-------|--------|
| Range start | `summaryRangeStartHash` — the undo/redo anchors stored on the range's parts |
| Diffs | `Snapshot.diffFull(anchor)` merged with tool write/edit/multiedit filediffs |
| Impact | `mcpTouchThenSqlitePack(worktree, files)` — merged paths |
| No anchor | tool filediffs alone (old rows, `snapshot: false`, recreated repo) |

---

## Pipeline (stop)

```text
await Checkpoint.persist
  → sidecar LLM:
       messages = byte-stable checkpoint M + summaryRequestProse(lastSv)
       system/tools/providerCacheKey = trunk identity; Constitution denies execution
       outputTokenMax = 32k (16K reasoning window + 16K stored answer; floor);
       quality gate isValidSummaryBody (deep sections)
       finish-step = cache/tokens/cost/duration log + session-total accounting
  → enrichRange: anchored range diff + tool merge + CodeGraph
  → save s (outside M)
  → compact only later (usable model; not same stop as new s)
```

The model request uses full checkpoint M for provider-prefix reuse; the Exact
enrichment still scopes only to the new `from_id..to_id` range. One targeted
gap-fill retry is allowed. Failed and successful cycles share the same cooldown.

---

## Tests

```text
summary-anchors.test.ts — resolver, merge, LIVE anchored range (a shell-made file with no tool part)
summary.test.ts — collectToolFileDiffs / range slice / anchors
summary-exact-live.test.ts — tool fallback → enrichRange; CG on monorepo files
```

---

## Claim ledger

| Claim | Mark |
|-------|------|
| s outside content | Exact |
| range diff from the stored anchors (whole worktree) | Exact |
| tool filediffs merge (unseen paths, snippets) | Exact (session DB) |
| CodeGraph over the merged file list | Exact when index/MCP available |
| no anchor ⇒ tool filediffs (unchanged fallback) | Exact |
