# Summary Exact handles (tool diffs + CodeGraph)

**Critical contract** for Layer-1 `s` rows (`project_checkpoint` / enrichRange).  
Code: `session/summary.ts` (`collectToolFileDiffs`, `enrichRange`).

**Fossil is not used for summary Exact.** Fossil exists only for **WC snapshot rollback** (`track` / `restore` / undo). Memory Exact is tool-parts + CodeGraph.

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
  → sidecar LLM body (Inferred only)
  → enrichRange: tool filediffs + CodeGraph
  → save s
  → maybeCompactCadence
```

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
