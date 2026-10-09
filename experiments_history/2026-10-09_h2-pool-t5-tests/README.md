# 2026-10-09_h2-pool-t5-tests

Evidence for plan `plans/2026-09-29_h2-session-pool-and-connection-badge.md` box T5:
the focused unit suite `packages/opencode/test/provider/gateway-h2-pool.test.ts` and
the mutation checks proving its pins are fallible. All runs are cmd_runner runs;
their full logs live under `logs/cmd_runner/<run id>/`.

## Suite oracle

| Run | What | Result |
|---|---|---|
| `20261009T003612Z_5b4b5852` | `bun test test/provider/gateway-h2-pool.test.ts` (first green) | 7 pass / 0 fail / 117 expect |
| `20261009T003644Z_fce8baa1` | stability re-run | 7 pass / 0 fail / 117 expect |
| `20261009T003747Z_6a81fbd6` | `bun typecheck` (packages/opencode) | exit 0 |

## Harness qualification (before the suite was written)

| Run | Question | Answer |
|---|---|---|
| `20261009T002720Z_9e6d1d62` | does `h2-transport` dial an in-process h2c server on 127.0.0.1, and does the pool see `maxConcurrentStreams: 4`? | yes — 200 "ok"; pool reads 4 |
| `20261009T002749Z_0ee3da7d` | does the Bun client surface `goaway`, and does the pool drop the session? | yes — pool count 0 after a server GOAWAY |

## Mutation checks — `gateway-h2-pool.mutants.test.ts`

Each block repeats one scenario of the suite and asserts a DELIBERATELY WRONG value
for the observed data (the transport source cannot be edited from a test-only task).
Run `20261009T003721Z_a8fb1265`: **0 pass / 11 fail** — every pin went red, so no
suite assertion is vacuous:

C1 load-pick session id · C2a no-dial-while-room · C2b fresh-dial-when-full ·
C3 ceil(6/4)=2 · C4 at-cap waits (9 arrivals) · C5a 11 sessions survive · C5b reuse
≤ session 11 · C6 goaway removal · C7 flash 2500 · C8 v4-pro 500 · C9 unknown model
keeps 500.

## Product residual found by this harness — NOT fixed here (src is the owner's)

A FRESH session keeps the 100-stream default (`h2-transport.ts:156`) until the
server's SETTINGS frame lands asynchronously (`:159-168`), and the cap math falls
back to the same default (`:87`). A same-tick burst of more than `maxConcurrentStreams`
fires therefore over-subscribes the newest session; the server refuses the excess with
`RST_STREAM(REFUSED_STREAM)` and those requests resolve with status 0.

Measured trail: pool frozen at 2 sessions / 9 arrivals with 33 refusals
(`probe-11-sessions.ts`, `20261009T003031Z_7d5d02f3`); the error text is
`NGHTTP2_REFUSED_STREAM` (`probe-error-text.ts`, `20261009T003348Z_b835d84b`);
same-tick raw connect bursts of 10 and 30 all succeed
(`probe-connect-burst.ts`, `20261009T003315Z_d14d0ca3`) — the over-subscription, not
the TCP layer, is the cause; the timeline shows the 33 refusals on the mid-burst
session (`probe-timeline.ts`, `20261009T003455Z_b192f9ec`). The suite works around it
by filling sessions in waves of `PER_SESSION` with a 25 ms settle between waves (test
file header). This is a STABILIZE candidate for a later cycle.

## Files

- `probe-loopback.ts` — Q1+Q2 qualification (mis-ordered Q3).
- `probe-goaway.ts` — goaway surfacing, re-probe (corrected order).
- `probe-11-sessions.ts` — the original stall, instrumented.
- `probe-connect-throw.ts` — raw connect bursts, negative result (connects are fine).
- `probe-connect-burst.ts` — 10/30 connect burst boundary.
- `probe-root-cause.ts` — per-fire outcomes; the ECONNREFUSED line here is a cleanup
  artifact (replica sessions outliving the server), not the failure cause.
- `probe-error-text.ts` — names the failure: `NGHTTP2_REFUSED_STREAM`.
- `probe-timeline.ts` — pool-level timeline across the burst (the root-cause evidence).
- `gateway-h2-pool.mutants.test.ts` — the mutation checks; must run fully red.
