# t142 — the plan↔master-goal linkage (archived)

**What this is.** The owner's order of 2026-10-22: every open plan must resolve to the master plan's
level-0 goal or to a subgoal of it, and the missing subgoals are PROPOSED to the owner — not written into
the master plan's head. The proposal is `PROPOSALS.md`; everything else here is the evidence it was built
from and the tools that produced it.

**Born in** `experiments/2026-10-22_subgoal-proposals/` (gitignored scratch), **archived here** per the
canon (`experiments_history/README.md`): a finished experiment whose finding is recorded is tracked. One
copy of the finding is tracked here; the scratch folder holds the live working copy.

## The files

| file | what it is | how to regenerate |
|---|---|---|
| `PROPOSALS.md` | **the finding** — the before→after census, the rule that produced the split, the five proposed subgoals (aim, draft SV, member plans, why together), the 28 plans that still wait (each named), the plans whose remaining work is bookkeeping or a verdict, the two foreign-lane plans, and the head hash before/after | by hand — it is the DECISION, the measurement is below |
| `census.py` | the census of every plan's link state; it MIRRORS the product's own parsing (`util/plan-status.ts:323` for the parent, `memory/spine.ts:190` for the label, `util/plan-status.ts:441` for the population) so the numbers are the runtime's own | `python census.py <worktree>` |
| `census.json` | the machine-readable census (per plan: link class, parent, label, box counts, aim) | written by `census.py` |
| `census_after.txt` | the census's human-readable output AFTER the task's edits (51 plans · 28 zeros · 23 goal) | `python census.py <worktree> > census_after.txt` |
| `head_hash.py` | the head hash of `plans/MASTER_PLAN.md` — every byte up to and including the `RENDER_MARKER` (`util/plan-status.ts:584`), which is the hand-owned part | `python head_hash.py <worktree>` |
| `mint_labels.py` | mints 32-hex LABELS for the vectors this task created, checked against every label already in `plans/` (the tree already carried TWO 31-hex labels, which is why their plans were invisible to the plan map) | `python mint_labels.py <worktree> <count>` |
| `render_current_source.ts` | renders the master plan through the product's OWN write path (`applyRender`, `src/session/svm.ts:401`) loaded from the CURRENT source — the running TUI in this session predates the linkage gate and cannot print it | `bun render_current_source.ts <worktree>` |

## Reproduce

```
python census.py . > census_after.txt          # the link census over plans/
python head_hash.py .                          # the head hash (before/after: f0cef99e… / 14195 bytes)
bun render_current_source.ts .                 # the render: unlinked: 28, gapsBefore: []
```

## The receipts this task used

- `svm render` through the product's own `applyRender` from the current source — cmd_runner run
  `20261022T030030Z_b143e82f`, exit 0, `unlinked: 28`, 51 plans, `gapsBefore: []`.
- `bun test test/tool/planstatus-unlinked-t135.test.ts` — 2 pass / 0 fail (run `20261022T030426Z_a8f255ce`).
- `bun test test/session/svm.test.ts` — 11 pass / 0 fail (run `20261022T030441Z_bcf90c33`).
- The head of `plans/MASTER_PLAN.md` — sha256 `f0cef99e5f85d7830fae6f8375045b697708f2fda68aa430fa74ee3573ea956c`,
  14 195 bytes — identical before the first edit and after both renders.
- The build receipt is in the `_progress_log.md` row this task committed.
