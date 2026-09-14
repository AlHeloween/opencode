<!-- intention: reasoning silently dropped between the model and the wire, loops caught only by the user -> deliberation survives its own pipeline, and degenerate loops are broken mechanically -->

# Reasoning continuity and the loop guard

state: DRAFT
scope: `packages/opencode/src/session` (processor.ts, message-v2.ts, compaction.ts), `src/provider/transform.ts`, `src/util/dsml-normalizer.ts`, `src/cli/cmd/tui/component/dialog-model-parameters.tsx`, `src/config/provider.ts`
evidence: this session's live measurements — raw-wire corpus (1976 bodies), `part` tables of both projects (4203 text+reasoning parts, 8516 tool-bearing messages), 40+ direct calls to `api.deepseek.com`, `arxiv.org/abs/2512.04419`

## Context / goal

Three independent measurements landed on the same seam.

**The wire.** Across 1976 captured request bodies, **262,468** DeepSeek assistant tool-call
turns left with `reasoning_content: ""` and **zero** carried CoT text, while the database
held 4,587 messages with both tool and reasoning parts. Reading `message-v2.ts`,
`convertToModelMessages` and `transform.ts` found every layer preserving reasoning — the
chain reads correct and the wire disagrees.

**The boundary census** (shipped this session) localised it: `in.cotAbsent` grows
monotonically inside a single session (0 → 159 of 272 turns), so reasoning is already
missing **before** transform. The injection that fills the hole with `""` is a 400-guard —
re-probed live, the field must be PRESENT on every assistant tool-call turn in thinking
mode when the conversation ends on a tool result — but it also converted a loud vendor
rejection into silent loss. It fired **264 times** in one session.

**The loop.** Two genuine degenerate loops exist in the corpus: `</parameter>` / `</invoke>`
at period 2 (x10, `_1C_Project`) and a sentence repeated x304 (this repo). Neither was
caught by any guard; both were noticed by a human. `detectDisguisedToolCalls` matches
`name{json}` and does not match the XML shape.

The vendor removed every sampling remedy: `temperature` has no effect in thinking mode,
`top_p` is clamped to [0.95, 1.0], both penalties are deprecated and provably do not
perturb the distribution (logprob differential: shift below the 0.5-1.5 noise floor against
a ~90-unit temperature control), and `repetition_penalty` is not an API parameter.
arXiv:2512.04419 offers beam search, `presence_penalty` and DPO — all three unavailable
here. Process intervention is what remains after elimination, not by taste.

## Prior art (REUSE.BEFORE)

- `reasoningCensus()` + the loud injection warn — landed this session, already measuring.
- `patches/@ai-sdk%2Fdeepseek@3.0.26.patch` — predicate `/deepseek-(?:v4|flash)/` on a
  lower-cased id, tail rule made unconditional. Survives `bun install`, in `bun.lock`.
- `collapseToolOutput` / `TAIL_TOOL_KEEP_FULL` — the tail already has a size discipline;
  the reasoning fix rides on it rather than inventing a second one.
- `isDeepSeekThinkingId` — the repo's own case-normalised family predicate, the pattern any
  new predicate must copy.
- `.opencode/data/gateway/raw-wire/` — the capture mechanism exists and is on; what was
  missing is the obligation to read it.

## Tasks

### T1 — find where reasoning parts die upstream of transform  [BLOCKING]

The census says "before transform"; the DB says ~50% of tool-bearing messages never had a
reasoning part, declining 75% -> 25% across one session. Trace stream -> `finishReasoning`
-> part persistence. Everything on the CoT side waits on this.

Secondary hypothesis to settle with the same instrument: the **empty-CoT feedback loop** —
if the decline is caused by the model reading its own `""` turns and copying the pattern,
the ratio must stop falling once the hole is closed.

**First pass (2026-09-13) — two hypotheses eliminated, both by data:**

- *Not stream truncation.* All **372** tool-bearing messages without reasoning carry both
  `step-start` AND `step-finish`; the only 2 messages missing `step-finish` DO have
  reasoning. The streams completed normally.
- *Not a pipeline loss.* The parts were never created — the DB is the record of creation
  and it has no reasoning row for them.
- *The split is structural, not gradual.* By tool parts per message: **1 tool → 43%** have
  reasoning, **2 tools → 92%**, **3+ → 100%**. By tool name: `grep` 98%, `glob` 89%,
  `read` 85%, `memory` 91% versus `run` 14%, `bash` 41%, `cua` 45%. The low group is the
  slow/streaming tools, the high group the fast read-only ones.

Remaining discriminator: **did the provider send `reasoning_content`, or did opencode not
record it?** The instrument exists — `gateway/per-response/*.md` prints `## Reasoning (N
chars)` explicitly — but response capture is barely running: **1** captured response against
~2000 captured requests. Next step is a short session with tool calls under response
capture, joining per-response reasoning length against the stored parts.

Caution discovered while doing this: the raw-wire corpus is **ephemeral** — it went from
1976 dumps to 1 during this session, and no cleanup path exists in `src/`. Dumps must be
extracted and preserved when they are made; they cannot be treated as an archive.

**RESOLVED (2026-09-14) — the premise was false. T1 closes; nothing to fix here.**

38 captured provider responses with their raw SSE streams settle it. Stored reasoning
parts match the raw stream character for character:

| raw stream | stored part |
|---|---|
| 20,905 | 20905 |
| 9,228 | 9228 |
| 19,920 | 19920 |
| 2,637 | 2637 |
| 0 | nothing stored |

Requests all carry `thinking: {"type":"enabled"}` and `reasoning_effort: "high"`.
**opencode loses nothing** — the provider returns an empty `reasoning_content` on ~58% of
turns (the field is present in every one of 836 chunks, carrying zero characters).

**The real signal is vendor-side and context-dependent.** Reasoning presence collapses as
the prompt grows: at 475k–483k tokens most turns carry 3k–21k chars of CoT; at 499k–518k
almost all are empty, with the last twelve consecutive turns at zero. This matches the
75% → 25% decline seen in the DB exactly, and it means the decline is **prompt size**, not
behaviour.

*Secondary hypothesis falsified.* The empty-CoT feedback loop is dead: the decline tracks
context size, not the accumulation of `""` turns in history.

**New defect found in its place — T9. FIXED 2026-09-14.**

`assembleMessage` / `collectReasoning` in `gateway/raw-diff.ts` read only the **OpenRouter**
dialect on the streaming path — `delta.reasoning` and `delta.reasoning_details[].text` —
and never `delta.reasoning_content`. The non-streaming branch did read the native field,
which is why this survived: opencode always streams. Every DeepSeek / Z.AI / MIMO response
therefore reported `## Reasoning (0 chars)`.

The fix dispatches **by field, not by provider name** — the field is the dialect, and this
repo has been bitten three times by name predicates (`deepseek-v4` vs `deepseek-flash` vs
`DeepSeek-V4-Flash-0731-TEE`). Two accumulation semantics, because they differ:

| field | dialect | deltas | handling |
|---|---|---|---|
| `reasoning`, `reasoning_details[].text` | OpenRouter | cumulative | `ReasoningCollector` suffix dedup |
| `reasoning_content` | DeepSeek / Z.AI / MIMO / Qwen | incremental | plain concatenation |
| `reasoning_text` | GitHub Copilot | incremental | plain concatenation |

Feeding incremental deltas through the collector would have corrupted them: its
suffix-growth dedup assumes the accumulating form, so `"to"` followed by `"tool"` yields
`"ol"`. That is the trap a one-line fix walks into, and it is covered by a test.

Oracle [Exact]: the fixed assembler run against the real captured stream that previously
reported zero returns **18,278** reasoning chars — byte-identical to the raw SSE — with 3
tool calls and `finish_reason: tool_calls`. `bun test test/provider/raw-diff.test.ts` →
41 pass / 0 fail (was 39 before the 6 new dialect tests, 35 originally).

Not covered, deliberately: Copilot also emits reasoning as `delta.content` when
`event === "model_thought"`. No captured specimen exists, and guessing at framing without
one is how the first version of this bug shipped.

### T2 — compaction: stop deleting the only grounding

`tailMessageText` drops `reasoning` on the premise "conclusions live in the text parts".
Measured false for **1,622 of 8,516** tool-bearing messages (19%) which have reasoning and
no text; 58% have no text part at all. Keep reasoning when no non-empty text part exists,
and apply the same condition in `tailContentChars` — today it counts those messages as ~0
chars, so the 32K tail admits more messages and renders each thinner.

### T3 — inject memory into the m* block

**0 of 384** system payloads contain `reasoning.md`. The one layer designed to survive
compaction loads only if the model remembers to call the tool, exactly when it is most
disoriented. m* is byte-stable between compacts, so the cost is `cache_read` price.

### T4 — the loop detector

Cycle of period **1-4** (the live specimen has period 2; an "N identical in a row" rule
misses it entirely), threshold **6**, both `text` and `reasoning` streams. Filters: units
without letters, code fences, ANSI escapes. Calibration: 4203 parts, two genuine specimens
caught, zero false positives after filters.

### T5 — the corrective action

Semantics first (causal re-assembly in fresh words), md5 second (entropy injection — tokens
the loop cannot produce by continuation). Fired **on the event, never on a schedule**: a
periodic breaker joins the rhythm and stops breaking. Delivered as a **tool result, not a
user message** — a synthetic user turn moves `lastUserMessageIndex` and wipes the current
turn's CoT, destroying the context the intervention asks about. Second firing in one turn =
STALL under `@LOOP_PROGRESS` -> surface to the user. The record is a **point on a control
chart**, not a criterion in memory: looping is a common cause, and writing a lesson per
instance is tampering.

### T6 — close the XML gap in `detectDisguisedToolCalls`

It matches `name{json}` only. The live specimen was `</parameter></invoke>`.

### T7 — honest sampling surface

One knob is live on direct DeepSeek (`top_p` in [0.95, 1.0]). Mark the dead ones per
provider, move penalties into per-provider config
(`provider.<id>.models.<model>.sampling`), set the temperature default from vendor guidance
(V4.1 Flash card: 1.0) rather than the inherited DeepSeek-R1 0.6 heritage.

### T8 — wire policy  [AFTER T4/T5]

Decide history CoT with the cache measurement in hand: tail-wipe gives **34%** cache hit
against **91%** for full echo, and echo is cheaper in money (25.7 vs 38.3 units) despite a
4x larger prompt — what breaks the cache is retroactive mutation, not volume. This is also
where the ratchet risk lives, hence strictly after the detector.

## Smoke Tests

Baseline first, post-change second, for every task.

- **T1** — baseline: census `in.cotText / in.cotAbsent` over one real session (today:
  113/159 at 272 turns). Post: the same session shape must not grow `in.cotAbsent` beyond
  the count of turns the model genuinely emitted without thinking, and the raw-wire body
  for that session must carry non-empty `reasoning_content` on tail turns.
- **T2** — unit: a message with a reasoning part and no text part renders its reasoning in
  `tailMessageText` and is counted by `tailContentChars`. Regression:
  `bun test test/session/compaction*` at its current pass count.
- **T3** — artifact: grep a fresh `payload_system_*` dump for a distinctive memory string;
  0 -> >0 is the pass. Cache: `prompt_cache_hit_tokens` on the turn after a compact.
- **T4** — replay both captured specimens (`</invoke>|</parameter>` x10 period 2, and the
  x304 period-1 sentence) -> must fire. Replay the five known false positives (ping output,
  ANSI run, `[tool:write] (error)` x6, test-timeout line, `. . . .`) -> must not fire.
- **T5** — injected as a tool result: `lastUserMessageIndex` unchanged, prior reasoning
  still present in the next outgoing body (read the raw-wire dump, not the code).
- **T6** — `detectDisguisedToolCalls` on the literal captured `</parameter></invoke>` text.
- **T7** — artifact: the outgoing body for a DeepSeek model carries no dead penalty field.
- **T8** — `prompt_cache_hit_tokens` before/after on a matched conversation.

Oracle rule for this plan: any change that alters the request body is verified by reading a
**raw-wire dump**, never by typecheck or by reading the transformation chain. Three times
this session the chain read as correct while the wire disagreed.

## Risks

- **T8 re-opens the ratchet.** Restoring history CoT re-bills 349 -> 1309 prompt tokens for
  an 840-word CoT and gives a degenerate chain a channel to re-prime itself. T4/T5 must land
  first — that ordering is the containment.
- **T4 recall is calibrated on two specimens.** Specificity is measured (0 false positives
  on 4203 parts); sensitivity is not. The first missed loop is the falsifier.
- **T1 may find nothing wrong.** If ~50% of tool turns genuinely need no thinking, the
  decline is normal and the CoT work reduces to T2/T3. The census answers this.

## Rollback

Each task is independently revertable. The patch is a single file in `patches/` plus one
`package.json` key. The census and the warn are log-only — no prompt bytes, no KV impact.
T5 is the only task that changes what the model receives mid-turn; it is gated behind T4's
firing, so disabling the detector disables it.

## Out of scope

- GLM on Novita shows the same empty-field symptom on the openai-compatible path with its
  own cause — separate investigation.
- Weight-level remedies (DPO) — no access, and the vendor route offers no decoder controls.
- `aicall` as an oracle: Inferred at best by its own contract; usable for triaging residual
  detector hits, never for the control chart.

## Open questions (not tasks)

- Two quotes in `_1C_Project`'s `reasoning.md` attributed to arXiv:2512.04419 ("BadCase 3
  repeatedly generates closing statements", "Context Repetition Leading to Probability
  Enhancement") are not in the abstract — BadCase 3 there is PlantUML syntax repetition.
  Read the body or soften the quotes before they harden as first-source.
- That same memory records "the loop lives in tool-call space, not in tokens". Falsified:
  two token-space specimens exist, one in its own database.
