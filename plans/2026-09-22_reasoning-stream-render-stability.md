<!-- intention: a long reasoning stream flickers — formatting arrives late or never, the viewport jumps, artifacts appear -> the visible reasoning window is append-only again and highlight commits atomically at quiet-window and at time.end -->

# Reasoning stream render stability — an append-only window and a two-phase commit

Owner, 2026-09-22: «Блин баг опять…» — no: the report that opened this plan is the flicker analysis
(an outside agent's, delivered Inferred with pins). Owner's correction of it is recorded in §0.

## 0. What is established, and the one claim that was stale

**Confirmed by code (`✓` read this session):**

- **P0 root cause ✓✓.** `routes/session/index.tsx:2116-2137`: `THINKING_DISPLAY_MAX = 6_000` and the
  markdown's FIRST token is `` `*Thinking:* … ${omitted} characters omitted …` `` — the counter changes
  on every delta. `renderables/markdown-parser.ts:31-46` (`parseMarkdownIncremental`) looks for a prefix
  match **strictly from offset 0** ⇒ `reuseCount` collapses to 0 ⇒ the whole 6 000-char tail is
  re-lexed per delta. The append-only stream became replace-head + append-tail.
- **P1 race ✓.** `renderables/Code.ts:118-136`: every content change calls `invalidateHighlights()`
  (`_highlightSnapshotId++`); `updateStreamingPreview:138-144` sets content + preview + line info;
  `context/sync.tsx:156-160`: `DELTA_DEBOUNCE_MS = 25`. A highlight result that arrives after the next
  delta is stale and discarded.
- **`Code.ts:138-144` already batches half of P2** — `updateStreamingPreview` is one call for
  content+preview+invalidate. What is missing is a single `requestRender` and the revision rule.

**Stale claim, corrected (owner, 2026-09-22: «мы уже тестировали mermaid и отрисовку пиксельной
графики») ✗:** the report says a full TUI pixel-run with Markdown/Mermaid was never performed. That
was true **at the re-base commit** and is false since: `702a2da02d` — «mermaid diagrams and pasted
screenshots showed empty space… **Verified live on 10.0.1058 (owner: works)**» plus a test that
«mounts the real MediaImage through testRender and asserts the pixels land in the captured frame»;
`88204c8680` — a test that flips capabilities to sixel and asserts the native `<image>` appears.
Plan closed: `plans_completed/2026-09-21_media-image-zero-layout-after-opentui-rebase.md`.
The pixel instrument EXISTS (`imagerender`, cmd_runner frames, `cua verify_state`); what is missing is
its **application to this stream**, which is §2's oracle.

## 1. Prior art (REUSE.BEFORE)

- The analysis itself (Inferred, pins checked, open items noted in §0).
- Existing focused tests that passed: «coalesces streaming updates while highlighting» and
  «streaming … should not jump when fenced code blocks are concealed» — they do NOT model the real
  combination: 25–50 deltas/s · reasoning > 6 000 · slower-than-stream highlighter · sticky ScrollBox ·
  `streaming=true → false`.
- `disableWriteOptimization` / frame-admission machinery (`renderer.frame-admission.test.ts`) — the
  viewport half is already instrumented; reuse its recorder idiom rather than inventing one.

## 2. Tasks

- [ ] **T1 — windowStart rotation (P0).** Keep an append-only visible window: move the
  «N characters omitted» line OUT of `<markdown>` into a plain `<text>`; pin `windowStart` to a
  paragraph/block boundary; append only; rotate the window in blocks (1000–2000 chars) and only at a
  blank line; on `time.end` take the final last-6 000 once.
  Oracle: `parseMarkdownIncremental` reuseCount stays > 0 across deltas between rotations (unit pin on
  the parser with a synthetic stream, plus a counter assertion in the component test).
- [ ] **T2 — two modes instead of the race (P1).** While streaming: render `initialStyledText`
  synchronously; run Tree-sitter for markdown prose only after a quiet window (75–100 ms without
  deltas); fenced code highlights after the fence closes or at `time.end`. At `time.end`: one final
  parse, one atomic commit. State machine: `LIVE_PREVIEW → QUIET_HIGHLIGHT → FINALIZED`.
  Oracle: a recorder counts highlight runs — during a synthetic 25-delta burst with a slow highlighter
  the count must be ≤ 2 (one quiet, one final), never per-delta.
- [ ] **T3 — atomic CodeRenderable update (P2).** One method `setStreamingContent(content, preview,
  revision)`: content + preview + invalidate + ONE `updateTextInfo` + ONE `requestRender`; a late
  highlight applies only when `revision` is current AND its visible text/line count matches the
  preview; otherwise defer to stabilisation/finalisation.
  Oracle: the same recorder asserts no intermediate plain/blank frame and a single layout per commit.
- [ ] **T4 — pixel oracle for exactly this flow (the missing instrument).** `cmd_runner start --
  dist\bin\opencode.exe` + a prompt forcing a long reasoning stream; capture frames at fixed intervals
  (`cua get_window_state` with `screenshot_out_file`); a reader script asserts: stable lines above the
  live tail are byte-identical between frames; no frame where the visible reasoning is empty/plain; the
  viewport offset changes only when a line is actually appended.
  Falsifier: revert T1/T2 and the same capture must FAIL (frames must differ where the assertion says
  stable) — an oracle that cannot fail proves nothing.
- [ ] **T5 — ScrollBox (P3), only if T1–T3 leave a residual.** Coalesce `recalculateBarProps()` to one
  call per frame; apply sticky-bottom once after a completed layout transaction; no per-size
  `process.nextTick(requestRender)`.

## 3. Smoke Tests (PRE_FLIGHT — before any edit)

Baseline [Exact], from `packages/opencode`:

1. `bun test test/tui/` — record pass/fail counts (2026-09-22: **158 pass / 0 fail**, run
   `20260922T124815Z_724fe65e`).
2. `bun typecheck` — exit 0 (2026-09-22: exit 0).
3. Pixel baseline: one capture run of the flow in T4 with the CURRENT build — recorded as the
   reference the fix must move.

Post-implementation: the same three, plus T1–T3 unit counters and the T4 capture PASS.

## 4. Risks and rollback

- **The tail is the only live feedback during a long thought** — a rotation that hides text mid-thought
  is worse than flicker. Rotation only at blank lines, and the omitted-count line stays visible.
- **`parseMarkdownIncremental` is shared** (Markdown renderable, not only reasoning) — the parser pin
  must cover both callers; a change that helps reasoning and regresses prose blocks is a regression.
- Rollback: each task is one commit; T1/T2 are confined to `ReasoningPart` + the Markdown/Code call
  path, so reverting the commit restores the previous rendering without touching the renderer core.
