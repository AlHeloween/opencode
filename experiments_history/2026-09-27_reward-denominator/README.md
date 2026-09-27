# Reward denominator — 2026-09-27

status: BASELINE TAKEN — the after-reading waits for a session on a binary rebuilt from the 2026-09-27 kernel.

The kernel premise declares the only reward: both simulations moving toward reality under evidence. A reward
with no number cannot be refuted, so this reader turns "we grew" into a claim that can fail.
`python experiments_history/2026-09-27_reward-denominator/denominator.py [db] [--since YYYY-MM-DD]` — read-only
over `.opencode/data/opencode.db`; one row per (session, model), because a session that switches models is two
populations.

## Metrics — declared before the first reading

| id | metric | status |
|---|---|---|
| M1 | first substantive part of the reply is a tool call (the 2026-09-24 release's falsifier) | ✗ **mis-specified** — G1 requires «state before reasoning: settled, open, next», i.e. text BEFORE the first call, so M1 penalises obeying the kernel (0–4% everywhere) |
| M1' | no LONG text part precedes the first tool call | declared 2026-09-27 for the NEXT reading; not computed yet, so it cannot have been fitted to this data |
| M2 | the reply contains at least one tool call | ✓ primary until M1' exists |
| M3 | asks for the OWNER to rebuild / run tests · builds the agent launched · owner's «пересобрал» reports | ✓ calibrated (below) |
| M4 | the final text carries a ✓ or ✗ mark (ASSERTION_STATUS) | ✓ |

## Calibration of M3 — the filter first undercounted

The first cut read 4 asks in `…5lDMi1qo`. Every prose mention of a rebuild was dumped (SV block removed) and
labelled by hand: the filter missed the imperative «Пересобирай» (6×) and «Скажешь «пересобрал»». After the fix
it reads 10, matching the hand count; non-asks («Пересобирать сейчас смысла нет», «пока кандидат не пересобран»)
stay unmatched. The owner side is read from his own messages: `\bпересобрал\b` in non-synthetic user text.

## Baseline (pre-release binary)

| session · model | turns | M2 | M4 | asks | self builds | owner rebuilt |
|---|---|---|---|---|---|---|
| `rUFqtoqX` · deepseek-flash (09-26) | 40 | 97.5% | 35.0% | 1 | 18 | 1 |
| `578gPpRt` · space-bunny-alpha | 8 | 87.5% | 25.0% | 1 | 3 | 0 |
| `5lDMi1qo` · space-bunny-alpha (09-27) | 141 | 75.2% | 27.0% | 10 | **0** | **10** |

## Falsifier for the 2026-09-27 release

On the rebuilt binary, space-bunny: M2 rises toward the deepseek reference, asks fall, self builds rise from 0,
owner rebuilds fall. **Confound, named in advance:** `1a12d99bd6` (a started job is STARTED, not FAILED) landed in
the same window and removes the instrument lie that produced the first blocker, so a change cannot be credited to
the kernel alone. Separating them needs a session on a binary with one change and not the other.
