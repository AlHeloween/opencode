# Results — 2026-09-12

Environment: Bun 1.4.2 (Windows x64), `@ai-sdk/anthropic@4.0.7`, `ai@7.0.31`,
catalog `packages/opencode/src/provider/models/anthropic.json`.
`ANTHROPIC_API_KEY` unset → tier B not run, every tier-B claim is **Unknown**.

---

## 01 — wire shape [Exact]

Fixture: 7 system slots (real `reasoning_prompt.txt` + real `AGENTS.md`),
3 agentic turns (user → assistant+tool_use → tool_result), 2 tools.

```
idx  role       slot                             chars  marker
0    system     universalEnv                     65     CACHE
1    system     stablePrefix(reasoning+kernel)   27245  CACHE
2    system     path:rules                       4448
3    system     path:skills                      7652
4    system     path:env                         674
5    system     path:instructions(AGENTS.md)     20213
6    system     mutableTail(banner+agentPrompt)  903
...
15   tool       -                                4100   CACHE
16   user       -                                13     CACHE
```

On the wire:

```
where             idx  chars  ttl
system[]          0    131    5m (default)
system[]          1    27788  5m (default)
messages[6].user  0    4095   5m (default)
messages[6].user  1    75     5m (default)

breakpoints on the wire: 4  (SDK hard cap: 4)
```

Static prefix anchored by a system breakpoint:

```
system[0] (universalEnv)                      416 chars
system[1] (stablePrefix(reasoning+kernel))  27661 chars
tools+system total:                         61551 chars (~15388 est tokens)
left OUTSIDE any static breakpoint:         33890 chars (55.1%)
```

Findings:

- **R1.** The cap is fully consumed: 4 of 4. There is no room for a fifth
  marker anywhere in the codebase.
- **R2.** 55.1% of the static prefix — `rules`, `skills`, `env`,
  `AGENTS.md` — sits behind no static breakpoint. It is anchored only by the
  two moving tail markers.
- **R3.** Both tail markers landed in the **same wire message**
  (`messages[6]`, blocks 0 and 1, 75 chars apart). Anthropic merges the
  `tool_result` message with the following user message, so "last 2 messages"
  in our array is one message on the wire. The second tail breakpoint buys
  almost nothing.
- **R4.** No `ttl` is ever set → every breakpoint is the 5-minute tier.

## 02 — layout A/B [Exact, arithmetic]

```
layout                            bps  anchored(chars)  anchored%  re-written on reset
A current (transform.ts:308)      4/4  27661            44.9       33890
B last-stable + mutable + 1 tail  3/4  61551            100.0      0
C last-stable + mutable + 2 tail  4/4  61551            100.0      0
```

Indicative cost per cold start / compaction / fork (static prefix only,
claude-opus-5 list prices, chars/4 estimate — **not** a measurement):

```
A  $0.05641
B  $0.00769      ~7.3x
```

B leaves one breakpoint spare; C spends it on a second tail marker that R3
shows is nearly redundant. **B is the recommendation.**

## 03 — variants vs catalog [Exact]

13 of 14 catalog models flagged; only `claude-opus-4-7` is clean.

```
model                       reasoning_options     mode                         out limit  flags
claude-opus-5               effort                budgetTokens=500000/1000000  128000     BUDGET_ON_EFFORT_ONLY BUDGET_GT_OUTPUT
claude-opus-4-8             effort                budgetTokens=500000/1000000  128000     BUDGET_ON_EFFORT_ONLY BUDGET_GT_OUTPUT
claude-fable-5              effort                budgetTokens=500000/1000000  128000     BUDGET_ON_EFFORT_ONLY BUDGET_GT_OUTPUT
claude-fable-5-1            effort                budgetTokens=500000/1000000  128000     BUDGET_ON_EFFORT_ONLY BUDGET_GT_OUTPUT
claude-sonnet-4-5           budget_tokens         budgetTokens=500000/1000000  64000      BUDGET_GT_OUTPUT
claude-sonnet-4-5-20250929  budget_tokens         budgetTokens=500000/1000000  64000      BUDGET_GT_OUTPUT
claude-haiku-4-5            budget_tokens         budgetTokens=100000/200000   64000      BUDGET_GT_OUTPUT
claude-haiku-4-5-20251001   budget_tokens         budgetTokens=100000/200000   64000      BUDGET_GT_OUTPUT
claude-opus-4-5             effort,budget_tokens  budgetTokens=100000/200000   64000      BUDGET_GT_OUTPUT
claude-opus-4-5-20251101    effort,budget_tokens  budgetTokens=100000/200000   64000      BUDGET_GT_OUTPUT
claude-sonnet-4-6           effort,budget_tokens  adaptive                     128000     NO_DISPLAY
claude-opus-4-6             effort,budget_tokens  adaptive                     128000     NO_DISPLAY
claude-sonnet-5             toggle,effort         adaptive                     128000     NO_DISPLAY
claude-opus-4-7             effort                adaptive                     128000     ok
```

Findings:

- **R5.** Four models get `budget_tokens` although their catalog entry offers
  only `effort` — the parameter Anthropic removed on that generation.
- **R6.** **Every** `budgetTokens` emitted is `>= limit.output`
  (`Math.floor(context/2)` against a 64–128k output cap). Invalid even where
  `budget_tokens` is still accepted, i.e. the `high`/`max` variants are broken
  on 10 of 14 models, not 4.
- **R7.** `display:"summarized"` is attached only for `opus-4.7`; the other
  adaptive models default to `omitted` → no visible reasoning in the TUI.
- **R8.** The catalog already carries `reasoning_options` per model
  (`provider-sync.ts:35` parses it). `variants()` ignores it and substring-matches
  ids instead.

## 04 — SDK contract [Exact]

```
C1 system → block                     PASS  system blocks=1
C1 user → LAST block only             PASS  blocks=text,text*
C1 assistant → LAST block (tool_use)  PASS  blocks=text,tool_use*
C1 tool_result → block                PASS  tool_result merges into a user message
C2 cap is 4                           PASS  requested 4 → 4 on wire; requested 5 → 4
C3 5th drop is warning-only           PASS  warnings=[{"feature":"cacheControl breakpoint limit",...}]
C4 static beta header merged          PASS  anthropic-beta: mid-conversation-system-2026-04-07,
                                            interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14
```

Findings:

- **R9.** Message-level `cacheControl` is correct for every role opencode
  marks. The mechanism in `applyCaching()` is sound; only the *placement* is
  wrong.
- **R10.** A fifth breakpoint is dropped with a warning that opencode never
  reads — combined with R1 this is a silent-failure surface.
- **R11.** `provider.ts:167`'s static `anthropic-beta` header is merged with
  the SDK's per-request betas, not clobbered. No bug here.

## Cross-implementation note: oh-my-pi [Inferred — source read, probe not run]

Read from `oh-my-pi/packages/ai/src/providers/anthropic.ts` on 2026-09-12 while
standardising the probe. Recorded here because that checkout is being reset
from upstream and the notes would otherwise be lost. Source-read only — the
probe never ran there (the checkout had no installed workspace:
`node_modules/@oh-my-pi` empty, `pi-catalog/build` unresolvable, `pi-natives`
unbuilt for win32-x64; their own `anthropic-cache-refresh.test.ts` fails the
same way).

| # | Observation | Source |
|---|-------------|--------|
| P1 | `buildAnthropicSystemBlocks` never sets `cache_control` — **no system-side breakpoint at all**. The only writer is `applyPromptCaching`, which marks the last two messages. Two of four breakpoints used, both on a moving target; tools + system have no anchor of their own. | `anthropic.ts:2896`, `:3195` |
| P2 | The anchor position depends on conversation shape: the window shifts by one when the `"Continue."` assistant pad is present. Between consecutive turns the anchor can therefore sit at different distances from the end. | `anthropic.ts:3203-3210` |
| P3 | The first system block is `createClaudeBillingHeader(firstUserMessageText)` — request-derived content at prefix position 0, where any change invalidates everything after it. Existing comments at `:582` and `:625` show prior breakage around that block's exact bytes. | `anthropic.ts:2907` |
| P4 | `applyCacheControlToLastBlock` skips `thinking`, `redacted_thinking` and `fallback` blocks when walking backwards to find the last cacheable block. **This repo has no such guard** — worth porting when T2 lands. | `anthropic.ts:3179-3193` |
| P5 | Retention is already modelled (`getCacheControl`, `short`/`long` → `ttl:"1h"` gated on `model.compat.supportsLongCacheRetention`) and `cache_creation.ephemeral_5m/1h_input_tokens` are parsed. The knob T4 proposes here already exists there. | `anthropic.ts:486-498`, `:1607-1624` |

P4 is the only item that translates into work on this side; it is folded into
T2's task notes. P1-P3 belong to that project.

## 10 / 11 / 12 — live [Unknown]

Not run: no `ANTHROPIC_API_KEY` in this environment. The following stay
unproven until they are:

- that layout B actually raises `cache_read_input_tokens` (probe 10),
- that `ttl:"1h"` works and which beta header it needs (probe 11),
- that today's `variants().max` returns a 400 on Opus 5 / 4.8 / Fable
  (probe 12) — R5 proves only what we *send*.
