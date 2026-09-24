# `marks:` counter — the observed log

Raw readings of the machine census from `<compaction-status>`, taken from this session's own transcript
(positions `#N` are message indices). They are the evidence for this section's whole subject: the counter
exists and runs, and for most of the window it reported that replies carried **no marks at all**.

| position | reading |
|---|---|
| #1365 | `marks: NONE in the last reply — unmarked claims read as CONFIRMED · 1/1 window replies with none` |
| #1407 | `NONE … · 22/24 window replies with none` |
| #1415 | `NONE … · 29/31` |
| #1420 | `NONE … · 32/34` |
| #1428 | `NONE … · 35/37` |
| #1466 | `NONE … · 49/59` |
| #1475 | `NONE … · 56/66` |
| #1478 | `NONE … · 57/67` |
| #1483 | `NONE … · 59/69` |
| #1519 | `NONE … · 71/88` |
| #1581 | `NONE … · 25/42` |
| #1700 | `NONE … · 22/28` |
| #1837 | `NONE … · 72/103` |
| #1839 | `NONE … · 73/104` |
| #1843 | `NONE … · 75/106` |
| #1848 | `NONE … · 77/108` |
| #1863 | `NONE … · 84/117` |

Then, on 2026-09-24, the same counter starts reporting **counted pairs** instead of `NONE`:
`1 ✓ · 0 ✗`, `7 ✓ · 2 ✗`, `6 ✓ · 7 ✗` — the norm reached the output from that point on.

## What the two regimes mean

- **`NONE`** — the reply carried no marks: the norm did not reach this agent's output at all, although it
  was present in the kernel addons, in all three renders and in `.claude/reasoning_kernel.md`.
- **A counted pair** (e.g. `6 ✓ · 7 ✗`) — the norm did reach it.

## What this log does NOT show, and it is the point

The counter spent **84 of 117** window replies at `NONE` while the rule was on disk the whole time — so
«the norm exists» and «the norm runs» are different facts, and only the second one is the subject here.
It also shows why the acceptance for this section's plan must be a measured SHARE over a fixed prompt set:
a zero counter for an entire window is the normal case, not an accident, and «it works in my session» is
what the log above already disproves for everyone else's.

Recorded 2026-09-24 on the owner's instruction («Сохрани их в той же папке»), from the session's own
readings; the raw status lines remain in the transcript and are addressable by position.
