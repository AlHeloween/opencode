---
title: Summary Exact handles
owner: Local_Development
last_verified: 2026-09-06
reproduce:
  files:
    - packages/opencode/src/session/prompt.ts
    - packages/opencode/src/session/summary.ts
    - packages/opencode/src/session/sidecar-policy.ts
  commands:
    - cd packages/opencode && bun test test/session/summary-sidecar.test.ts test/session/summary-cadence.test.ts test/session/summary.test.ts
  inputs: A Layer-1 capture range containing completed write/edit/multiedit parts.
  expected_outputs: A sidecar checkpoint with model summary body plus system-authored file diffs and CodeGraph impact.
---

# Summary Exact handles (tool diffs + CodeGraph)

**Critical contract** for Layer-1 `s` rows (`project_checkpoint` / enrichRange).  
Code: `session/summary.ts` (`collectToolFileDiffs`, `enrichRange`).

**Fossil is not used for summary Exact.** Fossil exists only for **WC snapshot rollback** (`track` / full-leaf `revertTo` / undo-redo). See [fossil-snapshot.md](fossil-snapshot.md). Memory Exact is tool-parts + CodeGraph.

---

## Content vs summary

```text
Content M:  [m m m] …     ← never polluted by s
s in DB:         s1 …     ← outside content; only compact → m*
```

---

## Exact sources (no Fossil span)

```text
range messages (from_id..to_id)
  → completed tool parts: write | edit | multiedit
  → metadata.filediff (and multiedit results[].filediff)
  → CodeGraph impact on those file paths (worktree-relative)
```

| Piece | Source |
|-------|--------|
| Diffs | DB tool-parts already written by the agent |
| Impact | `mcpTouchThenSqlitePack(worktree, files)` — same paths |
| Fossil | **Not** in this path |

---

## Pipeline (stop)

```text
await Checkpoint.persist
  → sidecar LLM:
       messages = byte-stable checkpoint M + summaryRequestProse(lastSv)
       system/tools/providerCacheKey = trunk identity; Constitution denies execution
       outputTokenMax = 8k; quality gate isValidSummaryBody (deep sections)
       finish-step = cache/tokens/cost/duration log + session-total accounting
  → enrichRange: tool filediffs + CodeGraph
  → save s (outside M)
  → compact only later (usable model; not same stop as new s)
```

The model request uses full checkpoint M for provider-prefix reuse; the Exact
enrichment still scopes only to the new `from_id..to_id` range. One targeted
gap-fill retry is allowed. Failed and successful cycles share the same cooldown.

---

## Tests

```text
summary.test.ts — collectToolFileDiffs / range slice
summary-exact-live.test.ts — tool metadata → enrichRange; CG on monorepo files
```

---

## Claim ledger

| Claim | Mark |
|-------|------|
| s outside content | Exact |
| tool write/edit/multiedit filediffs | Exact (session DB) |
| CodeGraph over tool file list | Exact when index/MCP available |
| Fossil only for rollback | Exact (not summary memory) |
