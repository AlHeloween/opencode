# t142 — the plan↔master-goal linkage (archived)

**What this is.** The owner's order of 2026-10-22: every open plan must resolve to the master plan's
level-0 goal or to a subgoal of it, and the missing subgoals are PROPOSED to the owner — not written into
the master plan's head. The proposal is `PROPOSALS.md`; everything else here is the evidence it was built
from and the tools that produced it. The owner ACCEPTED it the same day («Да, с подцелями все верно. Только
что прочитал.»), the five subgoals now live in the master plan's hand-owned head, and the plans carry
their subgoal's md5 — the unlinked count is **0**.

**Born in** `experiments/2026-10-22_subgoal-proposals/` (gitignored scratch), **archived here** per the
canon (`experiments_history/README.md`): a finished experiment whose finding is recorded is tracked. One
copy of the finding is tracked here; the scratch folder is scratch you borrow and return.

## The files

| file | what it is | how to regenerate |
|---|---|---|
| `PROPOSALS.md` | **the finding** — the before→after census, the rule that produced the split, the five proposed subgoals (aim, draft SV, member plans, why together), the 28 plans that still waited (each named), the plans whose remaining work is bookkeeping or a verdict, the two foreign-lane plans, and the head hash before/after — with the owner's ACCEPTANCE on top | by hand — it is the DECISION, the measurement is below |
| `census.py` | the census of every plan's link state; it MIRRORS the product's own parsing (`util/plan-status.ts:323` for the parent, `memory/spine.ts:190` for the label, `util/plan-status.ts:441` for the population) so the numbers are the runtime's own. It resolves a parent against the GOAL TREE — every `md5:` the master plan's HEAD owns (the level-0 goal plus its subgoals), read from the file that owns them | `python census.py <worktree>` |
| `census.json` | the machine-readable census BEFORE the apply (per plan: link class, parent, label, box counts, aim) | written by `census.py` |
| `census_after.txt` | the census's human-readable output after the LINKING pass (51 plans · 28 zeros · 23 goal) | `python census.py <worktree> > census_after.txt` |
| `head_hash.py` | the head hash of `plans/MASTER_PLAN.md` — every byte up to and including the `RENDER_MARKER` (`util/plan-status.ts:584`), which is the hand-owned part | `python head_hash.py <worktree>` |
| `head_diff.py` | the HEAD diff of `plans/MASTER_PLAN.md`: what changed above the `RENDER_MARKER`. It normalises CRLF→LF before comparing, because git's `core.autocrlf` stores LF in the blob and writes CRLF back on checkout — diffing raw bytes would report every line as changed | `python head_diff.py <worktree> <before-rev>` |
| `head_diff.txt` | that diff: **+66 / −0 lines**, content sha256 `2037351ea5f7d6b5d30691abad7b567788bef5b1bcc36971eb09ac077d58e582` → `04f27bcd001027739a18038eff4c1a22825ae1c29beab2b310f587508e477dbf` | `python head_diff.py . e19c42f > head_diff.txt` |
| `mint_labels.py` | mints 32-hex LABELS for the vectors this task created, checked against every label already in `plans/` (the tree already carried TWO 31-hex labels, which is why their plans were invisible to the plan map) | `python mint_labels.py <worktree> <count>` |
| `render_current_source.ts` | renders the master plan through the product's OWN write path (`applyRender`, `src/session/svm.ts:401`) loaded from the CURRENT source — the running TUI in this session predates the linkage gate and cannot print it | `bun render_current_source.ts <worktree>` |
| `planstatus_from_source.ts` | the `planstatus` tool's own output, produced from the current source: the same five functions the tool's `execute` calls (`src/tool/plan-status.ts:49-57`) and the same four lines | `bun planstatus_from_source.ts <worktree>` |
| `census_applied.txt` / `census_applied.json` | the census AFTER the apply: **51 plans, all of them `goal-tree`, 0 unresolved** | `python census.py <worktree>` |

## Reproduce

```
python census.py . > census_applied.txt       # the link census over plans/ (0 unresolved)
python head_diff.py . e19c42f > head_diff.txt  # the head diff of the apply
bun render_current_source.ts .                # the render: unlinked: 0, gapsBefore: []
bun planstatus_from_source.ts .               # the tool's own line: Unlinked: 0 plan(s)
```

## The receipts this task used

- `svm render` through the product's own `applyRender` from the current source — cmd_runner run
  `20261022T030030Z_b143e82f`, exit 0, `unlinked: 28` (after the linking pass) and
  `20261022T035406Z_59166602`, exit 0, `unlinked: 0`, `gapsBefore: []`.
- `planstatus` from the current source — cmd_runner run `20261022T035406Z_51801851`, exit 0:
  `Unlinked: 0 plan(s) name no master-plan goal`.
- `bun test test/tool/planstatus-unlinked-t135.test.ts` — 2 pass / 0 fail (run `20261022T030426Z_a8f255ce`).
- `bun test test/session/svm.test.ts` — 11 pass / 0 fail (run `20261022T030441Z_bcf90c33`).
- The head of `plans/MASTER_PLAN.md` — content sha256 `2037351e…` → `04f27bcd…`, **+66 / −0 lines**: the
  five subgoal entries and nothing else.
- The build receipts are in the `_progress_log.md` rows this task committed.
