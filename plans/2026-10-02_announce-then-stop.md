<!-- intention: «Smit's turn in ses_f06a3f279ffed3xB09892N7AfF ended mid-task: the last step's reasoning planned a `run` call and said «Let me do it.», its text announced «Now the RED run — the focused test against the real defect:», no call was emitted, finish `stop` — and the loop recorded the turn as COMPLETE, so the robot went idle with no report and nobody was told» -> «a step that ends `stop` with text promising what follows and no call is never recorded as a finished turn: the processor re-asks the identical request (capped, cheap on a cache hit), and if the model keeps doing it the turn ends as a visible error instead of a silent idle» -->

# Announce-then-stop: the model drops the call, the loop must not drop the turn

- **plan_id:** 2026-10-02_announce-then-stop
- **revision:** 1
- **state:** IMPLEMENTED (S1–S3 below); W1–W2 are owner-side wire items, plan only
- **found by:** owner's measurement 2026-10-02 (Smit, `deepseek`/`deepseek-flash`, variant `max`,
  step `msg_0f965705b001HE9fqp352z0Dqq`, created 05:36:09 local)

## Verdict

**The missing call is model behaviour. The silent end of the turn is ours.** The model emitted
reasoning + one announcement sentence and stopped; nothing on our side ate a call. But the loop
treats `stop` + any non-empty text as a delivered final answer, so the turn ended as «complete»
— the existing Level 4 guard (`processor.ts`, 2026-09-29) only fires when there is NO text.

## Grounded (instrument → result)

| question | instrument | result | mark |
|---|---|---|---|
| did the provider send a call that we dropped? | step usage in `message.data.tokens` | completion = 671 reasoning + **24** output; the stored text is 110 chars ≈ 24 tokens — no room for a `run` call (≥ 40 tokens of JSON args) or for any DSML block | Exact (arithmetic), Inferred (tokenizer ratio) |
| finish reason | `session.processor finish-step` log, `l-1797` | `finishReason: "stop"`; SDK `mapDeepSeekFinishReason` maps raw `stop`→`stop`, `tool_calls`→`tool-calls`; not `length` | Exact (log), Inferred (raw value) |
| did the DSML normalizer swallow markup? | stored text part + `dsml-normalizer.ts` | text has no markup; `normalizeDsmlTokens` only rewrites pipes, never deletes; `detectDisguisedToolCalls` found nothing | Exact |
| output cap / stop sequences | `output token budget` log; grep `stopSequences` in `llm.ts`/`transform.ts` | `maxOutputTokens: 125000`; no stop sequences are set | Exact / Inferred |
| CoT round-trip on this request | `provider.transform reasoning census` (`l-1777`) + DB | out: 77 tool-call turns, **59 with CoT text**, 18 `""`. The 18 have NO reasoning part in the DB and `tokens.reasoning = 0` on all 18 — the model did not think on those steps, nothing was lost | Exact |
| raw provider stream for that step | `.opencode/data/log`, `.opencode/data/gateway/` | **absent**: no raw SSE is kept; the gateway logs only `gateway.policy.success` at 05:36:14.550 | Exact (absence) |
| how often «stop + text + no call + text ends with `:`» occurs | every assistant row of `opencode.db` | 451 steps ended `stop` with text and no call; **exactly 1** ends with a colon — this one. Zero false positives | Exact |
| does a lexical «Let me / Now I'll» tail work instead? | same corpus | 3 hits, all 3 legitimate reports — useless | Exact |

So the colon is the structural signal: a text whose last character promises «what follows» and a step
that emits nothing after it. Two other steps of the same turn ended with `:` and WERE followed by
their call (`tool-calls`) — the normal shape the model was imitating.

## Tasks (non-wire, done here)

- [x] **S1 — Level 5 guard in `SessionProcessor` `finish-step`.** `finishReason === "stop"`, no tool
      call, no file, no error already set, and the step's accumulated text ends with `:`/`：`
      (trailing whitespace, `*`, `_` ignored) → `EmptyResponseError`, the same retry path as Level 4:
      identical request re-sent, capped at `EMPTY_RESPONSE_MAX_ATTEMPTS` (5), then a visible error.
      No prompt is added; the model is not told anything.
- [x] **S2 — focused test, red before green:** `test/session/processor-effect.test.ts`
      «retries a stop whose text announces what follows and delivers no call» + the negative
      «a colon inside a finished answer is not an announcement».
- [x] **S3 — memory correction:** the «CoT never round-tripped» memory is stale for this runtime
      (59/77 at 2026-10-02).

## Owner-side (wire — diagnosis and plan only, not implemented by Claude)

- **W1 — keep a per-step wire receipt.** Today the only evidence of what the provider returned is the
  usage arithmetic. Log once per step, at the stream boundary: raw `finish_reason`, count of
  `delta.content` chars, `delta.reasoning_content` chars, `delta.tool_calls` fragments. One line,
  printed even at zero. Then the next «was it the model?» is read, not computed.
- **W2 — the census WARN is mislabelled.** `provider.transform` warns «empty reasoning injected on
  tool-call turns — vendor CoT round-trip is lost» for every `cotAbsent` turn. On this request all
  18 were steps with `tokens.reasoning = 0`: nothing was lost, `""` is the vendor-required filler.
  Warn only for turns that HAD reasoning text upstream and reach the wire empty.

## Residual

- Announcements without a trailing colon («I'll run the tests now.» + stop) are not caught; the
  corpus has none, and the lexical form has a 100 % false-positive rate. Revisit with data.
- Retry leaves the announcement text part in the message; the retried attempt appends its own parts
  after it. Replay shows «…the focused test:» followed by the call — the shape it promised.

## Smoke Tests

From `packages/opencode`, one named file, through `D:\zPython\opencode\tools\cmd_runner.exe`.

1. **Before the guard (red).** Prediction: the new positive case FAILS on `llm.calls` = 1 (the
   announcement accepted as final); the negative case passes; the rest of the file is unchanged.
2. **After the guard (green).** Prediction: positive case — 2 calls, the report text stored, value
   `continue`; negative case — 1 call; whole file green.
3. `bun typecheck` from `packages/opencode`. Prediction: clean.

### Results (2026-10-02, worktree on `Local_Development` fb8cd6e663)

1. RED — `cmd_runner` run `20261001T215408Z_203274a5`: **14 pass, 1 fail**; the failure is exactly
   the positive case, `llm.calls` Expected 2 / Received 1. As predicted ✓
2. GREEN — run `20261001T215525Z_87c2c007`: **15 pass, 0 fail**, 33.5 s (the retry's 2 s backoff
   included). As predicted ✓
3. typecheck — run `20261001T215600Z_3e445c5c`: prediction MISSED. 5 errors, all `TS2307` (module
   not found) in files this change does not touch: the generated `models-snapshot.js` (×3) and
   `opentui-spinner` (×2), both absent from a fresh worktree. Zero errors in `processor.ts` or the
   test file. Environment, not this change — Inferred; confirm on the main tree's install.

Worktree environment notes (no tracked effect): the ignored wasm `pkg/` build outputs were copied
from the main tree; `bun install --frozen-lockfile` does not produce the optional peer
`@hono/standard-validator` that the main tree's older install hoisted into
`node_modules/.bun/node_modules/@hono/`, so it was junctioned in from the main tree's store.
