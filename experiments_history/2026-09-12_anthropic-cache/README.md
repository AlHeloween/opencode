# Anthropic prompt-cache + thinking-variant probes (2026-09-12)

Evidence base for `plans/2026-09-12_anthropic-cache-breakpoints.md`.

`01_wire_shape.mts` follows the wire-probe standard below, so its numbers are
comparable across implementations and across time.

## The wire-probe standard

A conforming probe:

1. drives the **real** provider through its public entry with a stub `fetch` —
   never a hand-rolled request builder, because the point is to see what
   production actually sends;
2. builds the system prompt from **real repo artifacts** (the agent prompt,
   `AGENTS.md`), so printed sizes are production sizes, not a toy;
3. prints exactly these four sections, in this order:

```
=== marker placement on the system blocks ===      idx | slot | chars | marker
=== cache_control blocks ON THE WIRE ===           where | idx | chars | ttl
    breakpoints on the wire: N  (Anthropic hard cap: 4)
=== static prefix anchored by each system breakpoint ===
                                                   breakpoint | anchoredChars | estTokens
    tools+system total / left OUTSIDE any static breakpoint (chars, %)
=== request headers (secrets redacted) ===
```

4. redacts any header whose name contains `key` or `token`, or is
   `authorization`, and never prints a credential value or its length;
5. needs no credentials — a canned response envelope stands in for the answer.

The headline number is the last line of section 3: **what share of the static
prefix (tools + system) is left outside any breakpoint that survives a tail
reset.** That single figure is what to compare. For this repo, today: 55.1%.

Two tiers, because only one of them can run without credentials:

| Tier | Probes | Proves | Status without a key |
|------|--------|--------|----------------------|
| **A — offline** | `01`–`04` | what opencode *emits* (wire body, breakpoint count/placement, thinking payload, SDK contract) | runs now, results are Exact |
| **B — live** | `10`–`12` | what Anthropic *answers* (cache hits, 1h TTL, the 400) | SKIPPED → Unknown, not a failed oracle |

Tier A is not a weaker version of tier B. It answers a different question:
tier A pins *our* behaviour and fails loudly when an SDK bump changes it;
tier B pins the provider's. A claim about cost or about a 400 needs tier B.

## Run

From the repo root (the probes use deep relative imports into
`packages/opencode`, so the cwd does not matter, but the paths do):

```bash
bun run experiments/2026-09-12_anthropic-cache/01_wire_shape.mts
bun run experiments/2026-09-12_anthropic-cache/02_breakpoint_ab.mts
bun run experiments/2026-09-12_anthropic-cache/03_variants_matrix.mts
bun run experiments/2026-09-12_anthropic-cache/04_sdk_contract.mts
```

`03` and `04` set a non-zero exit code on failure, so they work as gates.
`01` and `02` are measurement, not assertion — read the numbers.

Live tier (each refuses to run without `ANTHROPIC_API_KEY` and says so):

```bash
ANTHROPIC_API_KEY=sk-ant-... bun run experiments/2026-09-12_anthropic-cache/10_live_cache_ab.mts
ANTHROPIC_API_KEY=sk-ant-... bun run experiments/2026-09-12_anthropic-cache/12_live_variants_400.mts
# 11 is two-phase, with a >5 min gap between them:
ANTHROPIC_API_KEY=sk-ant-... bun run experiments/2026-09-12_anthropic-cache/11_live_ttl_1h.mts --phase=write
ANTHROPIC_API_KEY=sk-ant-... bun run experiments/2026-09-12_anthropic-cache/11_live_ttl_1h.mts --phase=read
```

Live probes spend real money. `10` is 6 requests over a ~15k-token prefix,
`12` is 8 short requests, `11` is 2+2 short requests.

## Probes

| File | Question |
|------|----------|
| `lib/fixture.mts` | the shared prompt. System slots are built from the **real** `reasoning_prompt.txt` and `AGENTS.md`, so printed prefix sizes are production sizes, not a toy. |
| `lib/live.mts` | key guard + a provider built the way `provider.ts` builds it (static beta header included). |
| `01_wire_shape.mts` | How many `cache_control` blocks reach the wire, where they land, how much of the static prefix each one anchors. |
| `02_breakpoint_ab.mts` | Placement arithmetic for three layouts: how much static prefix survives a tail reset. |
| `03_variants_matrix.mts` | `variants()` output vs the catalog's own `reasoning_options`, per model. Exit 1 on `BUDGET_ON_EFFORT_ONLY`. |
| `04_sdk_contract.mts` | The four SDK assumptions `applyCaching()` rests on (C1–C4). Exit 1 on any FAIL — run after every `@ai-sdk/anthropic` bump. |
| `10_live_cache_ab.mts` | Does layout B actually read more cache than layout A? |
| `11_live_ttl_1h.mts` | Does `ttl:"1h"` survive a >5 min gap, and which beta header does it need? |
| `12_live_variants_400.mts` | Does today's `variants().max` really 400 on Opus 5 / 4.8 / Fable? |

Results: [REPORT.md](REPORT.md).

## Caveats

- `estTokens` = `chars/4`. An estimate for relative comparison; never quoted as
  a token count. Real token numbers come from the live tier.
- The `$ per reset` column in `02` is an indicative model over catalog list
  prices, not a measurement.
- `11`'s default beta header (`extended-cache-ttl-2025-04-11`) is an unverified
  guess; the probe prints whatever the API says about it.
