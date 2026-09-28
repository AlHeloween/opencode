# 01 — the empty transcript: agent works, transcript is empty, restart repairs it

<!-- intention: three wrong causes were produced for this defect and the only reason they were wrong
     is that the state was gone by the time anyone looked -> the bug has an address instead of a
     theory, and the one thing standing between the next attempt and a proof is card 02 -->

**Status: OPEN · not independently reproduced · replacement client trace awaits live candidate proof (see card 02).**

## What the owner sees

One `/undo`, then a request. The agent works, the status numbers stay LIVE (in/out/cache), the
working indicator animates — and the transcript is EMPTY. Restarting brings every message back.
Reported 3× in one morning.

## What is measured, and what is only theory

| claim | status | instrument |
|---|---|---|
| The event subscription died | **REFUTED** | the owner's screenshot: the numbers were live, only the text was gone |
| The revert filter `m.id < revertID` hides everything after the cursor | **a real defect** (`5717603350`), **REFUTED as the cause** | a build carrying the fix reproduced it identically |
| The client holds a stale cursor | **REFUTED BY CONSTRUCTION** | `revert` rides every session request — `sync.tsx:119` subscribes to `session.updated` |
| **The cause** | **UNKNOWN** | — |

## Why none of them could be right or wrong until now

- **All five files in `.opencode/data/log` are SERVER-side. There is no client log.** So «zero
  errors in the logs» was a statement about the server while it was read as covering the screen. I
  went back to those logs a THIRD time after writing that down.
- **`logsearch` also matches my own `payload_*.md` and `.diff` files**, so its «no ERROR found» was
  about nothing at all.
- **`revert` is NULL inside every turn BY DESIGN** (`prompt.ts:1478` runs `revert.cleanup` before
  `createUserMessage`; `:649` under `if (session.revert)`). The armed window is between the undo
  and the next message — **so from inside the turn, the state under investigation is unobservable.**

**The state a bug lives in can be invisible to every instrument reachable from inside the bug.**

## The instrument, and its address

`packages/opencode/src/cli/cmd/tui/util/divergence.ts` compares three sets that already exist:

| set | what it is |
|---|---|
| `arrived` | ids a LIVE EVENT named, recorded **before** reconcile can early-out |
| `held` | `message[sid]` |
| `listed` | ids in the computed transcript list (not a pixel capture) |

The replacement compares `arrived`, `held`, and `listed` on every state transition, including
empty state and healthy ids. `listed` is the computed transcript list, **not pixels**. Each bounded,
content-free snapshot is appended under `<Global.Path.data>/tui-divergence/<pid>.jsonl` and survives
the restart. `hidden` means an arrived+held id was not listed and not legitimately reverted;
`missingStore` is a separate class. Neither alone proves a blank terminal frame.

**The oracle caught ITSELF twice before any live run:** it checked ARRIVED but not «absent from
DRAWN» (so it fired on healthy traffic), then a test picked an id that WAS drawn and asserted on
`undefined`. An oracle that fires on healthy traffic is not a weak oracle, it is a broken one.

## Today's run, and what it did NOT establish

Rebuilt `10.0.1143` (run `20260927T133028Z_a679fc61`, 62.3 s, smoke pass), launched the candidate
from `experiments/2026-09-27_empty-transcript/`, drove it live, and it worked: a request, a reply,
`44.5K (4%)` on the meter, 36.1 s.

**The reproduction FAILED, mechanically:** `/undo` was sent as text and ENTER arrived before the
command palette opened, so the undo never executed. The screen showed `/undo Undo previous message`
AND `/undo` sitting in the composer. No undo, no second request, nothing to hide — the transcript
stayed full and healthy.

**Operational rule that came out of it, for whoever retries:** splitting `TEXT` and `ENTER` is NOT
enough. The palette opens asynchronously — **wait until the palette is VISIBLE on screen, then
send ENTER.** Same trap as fuzzy-search row selection.

## The next attempt, in order

1. Finish card 02's caller-level tests and build a **new candidate in `dist/`**, not `bin/`.
2. Launch the candidate in an isolated cwd. Send `TEXT:/undo`, WAIT for the palette row to appear,
   then `ENTER` and verify the session was reverted. Send a second request.
3. Capture `cmd_runner`'s actual frame AND read the JSONL by the candidate's PID before restart.
   No file/zero records means **no verified observation**, not a pass. A healthy `snapshot` proves
   only the computed list, not that the terminal painted text. Establish the cause from both layers.
