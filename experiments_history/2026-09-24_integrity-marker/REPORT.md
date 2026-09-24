# 2026-09-24 — gateway integrity counter: a dead kernel marker

Measured 2026-09-24 on `packages/opencode` @ `Local_Development`.

## Finding

`renderIntegrityReport` (`src/provider/gateway/raw-diff.ts`) counted kernel copies among a request's
system messages using `KERNEL_MARKER = "Semantic Vector (SV)"` — a string present in NO kernel render
(`grep "Semantic Vector" prompt_kernel` → no matches). Every live capture therefore printed
`kernel copies: 0 (EXPECTED 1 — identity accumulation)` while the kernel sat in the body as system
message #1 (46 797 chars, sha `dc981bc4…` = the production prompt). The unit tests could not see it:
they fed a FABRICATED kernel (`"# Semantic Vector (SV) — kernel body"`) — a fixture that does not
repeat production. Introduced by `5d433565df`; born dead, not a regression.

## Instrument

`check.ts <capture.json>` — parses a raw-wire capture body and prints `renderIntegrityReport` over it.

## Oracle

| run | what | result |
|---|---|---|
| `20260924T152119Z_62c1a758` | BEFORE the fix — the pin test over the real prompt | 41 pass / 1 fail: `kernel copies: 0` while the body IS the kernel |
| `20260924T152152Z_51865148` | AFTER — `bun test test/provider/raw-diff.test.ts` | 42 pass / 0 fail |
| `20260924T152203Z_0beb948f` | real capture `15-07-57-555Z` (the fold boundary) | `kernel copies: 1` (the live `.diff` for the same stem printed 0) |
| `20260924T152209Z_a81a6c29` | real capture `15-12-50-981Z`, 64 messages | `kernel copies: 1`, `canonical 19/19` |

Fix + pin: `plans_completed/2026-09-24_gateway-integrity-kernel-marker.md`.

## Prohibitions honoured

No kernel edit (31 B of headroom; the marker belongs to the checker); `bin/` untouched.
