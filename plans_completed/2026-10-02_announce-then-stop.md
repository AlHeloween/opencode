<!-- intention: «Smit's turn in ses_f06a3f279ffed3xB09892N7AfF ended mid-task: the last step's reasoning planned a `run` call and said «Let me do it.», its text announced «Now the RED run — the focused test against the real defect:», no call was emitted, finish `stop` — and the loop recorded the turn as COMPLETE, so the robot went idle with no report and nobody was told» -> «a step that ends `stop` with text promising what follows and no call is never recorded as a finished turn: the processor re-asks the identical request (capped, cheap on a cache hit), and if the model keeps doing it the turn ends as a visible error instead of a silent idle» -->

# Announce-then-stop: the model drops the call, the loop must not drop the turn

- **plan_id:** 2026-10-02_announce-then-stop
- **revision:** 2
- **state:** IMPLEMENTED — S1–S6 done and verified in branch `claude/wizardly-agnesi-bde437`; one box
  open: L1, the live confirmation, owed against the next binary the owner builds and promotes
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
- [x] **S4 — the provider's raw finish reason is STATE** (revision 2; replaces W1). AI SDK 7 hands
      `rawFinishReason` to the `finish-step` event, so no wire code is needed: the `step-finish` part
      stores it beside the turn timings (`message-v2.ts` `StepFinishPart.rawFinishReason`,
      `processor.ts`). The content census W1 asked for already IS state — the stored text, reasoning
      and tool parts of the step; only the raw reason was missing. Commit `6517ed7db1`.
- [x] **S5 — the census false alarm removed** (revision 2; replaces W2). `provider/transform.ts` is not
      `provider/gateway/**`, so it is not wire work. The `bug:` marker is gone; the `reasoning census`
      already counts the fill (cotAbsent → cotEmpty) and shows a real loss (cotText in > out).
      Commit `25dc16e75f`.
- [x] **S6 — fresh-install defect: `@hono/standard-validator`** (found while running S2). hono-openapi
      1.3.1 imports it unconditionally while listing it as an optional peer; nothing declared it, so
      `bun.lock` never carried it and every fresh `bun install --frozen-lockfile` broke the server
      routes. Declared at 0.2.3 (newest inside the peer range ^0.2.0). Commit `3da87807d3`.
- [x] **L1 — CLOSED 2026-10-07 on live data.** The promoted binary carries the code (bin\opencode.exe 2026-10-06, literals
  «The turn delivered an announcement, not its action», `rawFinishReason` present ✓). Half A ✓: 732/732 `step-finish`
  parts since the first one carry `rawFinishReason` (main DB, read-only, 2026-10-07). Half B — the Level 5 retry itself —
  NOT observed: 0 of the 36 stop+text+no-call steps since ended in a colon, so the trigger never fired (not a refutation).
  Residual, reopen_when: a step with finish `stop`, text ending in «:» and no tool call appears without the retry.
  Code hashes after the rebase: `550b1cbddd`, `34abb0276f`, `46d4c186be`, `e5ebc3eb14`. Original box:
  **L1 — live confirmation.** Against the next binary the owner builds and promotes: a
      deepseek-flash step that stops right after a colon-ended announcement shows the Level 5 warn
      and a retry instead of an idle turn, and every new `step-finish` row carries `rawFinishReason`.
      Instrument: the read-only DB probe used above (`part.data` of type `step-finish`).

W1/W2 of revision 1 were filed as owner-side wire items; both turned out to be off the wire —
`rawFinishReason` arrives through the SDK event, and the transform is not the gateway (the memory's
boundary is `packages/opencode/src/provider/gateway/**`). Raw SSE capture stays the owner's, and is no
longer needed for this question.

## Residual

- Announcements without a trailing colon («I'll run the tests now.» + stop) are not caught; the
  corpus has none, and the lexical form has a 100 % false-positive rate. Revisit with data.
  reopen_when: a stop+text+no-call step without a colon is found mid-task in the DB.
- Retry leaves the announcement text part in the message; the retried attempt appends its own parts
  after it. Replay shows «…the focused test:» followed by the call — the shape it promised.
- **Not in this branch's power:** the fix reaches Smit only after a rebuild and promotion into `bin\`
  (owner's procedure), and the branch reaches `Local_Development` only by the owner's merge — the
  main tree carries Smit's uncommitted `run.ts` / `run-lifetime.test.ts`.
- **Desktop-app trap (owner decided to keep `origin/HEAD` as is, 2026-10-02):** `origin/HEAD` points
  at `origin/dev`, the upstream mirror, and the app births new worktrees on it — this one started on
  upstream `10765ff2a9` and its first-loaded AGENTS.md was upstream's (default branch `dev`, «run
  `bun run generate`», «regenerate the SDK»). Re-based on `Local_Development` before any work; nothing
  from upstream was followed. Same day, on the owner's choice: `git remote set-url --push upstream
  no_push`, and the 11 stale `branch.Local_Development.github-pr-owner-number` entries (closed,
  unmerged upstream PR #34719) removed. Fetch from upstream stays — the owner reads its code, never
  merges it.
- **Plan-to-code gap, separate issue:** `packages/opencode/src/provider/models/` is in `.gitignore`
  (line 193) while `test/provider/transform.test.ts` calls `openrouter.json` «the COMMITTED CATALOG»
  and `packages/opencode/AGENTS.md` says to commit those JSON files separately. On a fresh checkout
  that test fails with ENOENT. Not fixed here — which side is right is the owner's call.
- **Fresh worktree prerequisites** (ignored build outputs, copied from the main tree for these runs):
  `packages/wasm/core/pkg`, `packages/wasm/markdownify/pkg`, `packages/opencode/src/provider/
  models-snapshot.{js,d.ts}`, `packages/opentui-spinner/dist`, `packages/opencode/src/provider/
  models/openrouter.json`.

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

Worktree environment notes: the ignored wasm `pkg/` build outputs were copied from the main tree;
`bun install --frozen-lockfile` did not produce `@hono/standard-validator` (the main tree's older
install had hoisted 0.1.5 into `node_modules/.bun/node_modules/@hono/`), so revision 1 ran with a
temporary junction into the main tree's store. Revision 2 removed the junction and fixed the cause (S6).

### Results, revision 2 (2026-10-02)

4. S6 — RED, junction removed: run `20261001T233925Z_d943ecc1`, **1 pass / 14 fail**, «Cannot find
   module '@hono/standard-validator'». As predicted ✓ GREEN after the declaration + `bun install`
   (lock diff: 3 lines): run `20261001T234011Z_c0f9bc2e`, **15 / 0** ✓ `consolidate_catalog.py
   --dry-run`: nothing about the new entry ✓
5. S4 — RED: run `20261001T234218Z_0a0b520f`, the new case fails `rawFinishReason` Expected "stop" /
   Received undefined, 15 others pass. As predicted ✓ GREEN: run `20261001T235431Z_e8ebc5e8`,
   **16 / 0** ✓ consumer test `finish-step.test.ts` (named by codegraph): run
   `20261001T235526Z_ee758d24`, **6 / 0** ✓
6. S5 — RED: run `20261001T235623Z_45dbc125`, the new case finds the «…round-trip is lost» entry in
   `Log.bugReport()`, 3 others pass. As predicted ✓ GREEN: run `20261001T235645Z_b220540d`, **4 / 0** ✓
   `transform-reasoning.test.ts`: **27 / 0** ✓ `transform.test.ts`: first 169 / 1 — the 1 is ENOENT on
   the ignored `models/openrouter.json` (see Residual), not this change; with the file present, run
   `20261001T235731Z_352b0cc3`, **170 / 0** ✓
7. typecheck with the build outputs present: runs `20261001T235507Z_aaa3576c` and
   `20261001T235736Z_9665ba5c`, **exit 0** ✓ — revision 1's five TS2307 were the missing build outputs,
   now confirmed (Exact) rather than Inferred.
