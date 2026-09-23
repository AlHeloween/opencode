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

- [x] **T1 — windowStart rotation (P0).** DONE, `585973ce50` + the acceptance commit — the counter
  renders as a plain `<text>` ABOVE the markdown, the window rotates in 1 024-character blocks snapped
  to a blank line, and `time.end` takes the exact tail once.
  Oracle, RUN: `test/tui/reasoning-window.test.ts` = **7 pass / 0 fail** (18 expect, 4.99 s, run
  `20260922T144906Z_5275bc4d`, `exit_code 0`) and `bun typecheck` `exit_code 0`
  (`20260922T144906Z_80e5ba45`). The parser pin runs the REAL `parseMarkdownIncremental` over the
  string the component renders: across 2 400 appended deltas the window rotates fewer than 10 times,
  NOTHING is re-lexed from offset 0 between rotations, and token reuse by reference stays > 0 — with
  the LEGACY representation as a POSITIVE CONTROL that fails both assertions (`appended === 0`,
  `reused === 0`), so the oracle CAN fail.
  ACCEPTANCE SUBSTITUTION, named (same class as R2 in `close-open-residuals`): the plan asked for
  «a counter assertion in the component test». `ReasoningPart` is a plain `function` inside the
  3 000-line route (`routes/session/index.tsx`) and is not exported, so a component test would need
  that internal exported for one assertion — and it would assert a COPY of the rendered value. The
  rendered value now comes from the pure `reasoningView` (`text-segments.ts`), and the pin asserts on
  that exact value, which is what the markdown receives.
  NOT evidenced: the pixel oracle (T4) — no frame of a live stream has been captured, so the flicker
  itself is still unobserved; the box above is earned by the two RUNTIME oracles, not by that one.
- [x] **T2 — two modes instead of the race (P1).** DONE, `1e97343dfb` — `CodeRenderable.quietHighlightMs`
  (opt-in; default `0` = synchronous, unchanged), `renderSelf` keeps `_highlightsDirty` SET while the
  stream is younger than the window and asks for one more frame, `updateStreamingPreview` now calls
  `requestRender` (the missing half of P2 — a preview is a visible frame), and `Markdown.ts` turns the
  window on at `createMarkdownCodeRenderable` — the ONE constructor behind all 11 prose call sites —
  plus the fenced-code path.
  Oracle, RUN: `Code.test.ts` = **68 pass / 1 skip / 0 fail** (278 expect, 1.1 s, run
  `20260922T152725Z_30dfd341`, `exit_code 0`) and the package typecheck `exit_code 0`
  (`20260922T152725Z_57b1f250`). The pin is STRICTER than the plan asked: a 25-delta burst with a frame
  per delta runs NO parse at all (asserted after each delta), then exactly ONE parse on the LATEST
  content once the window is quiet, and the `time.end` parse is immediate — 0 during, 1 quiet, 1 final.
  THE FIRST RUN WAS RED (`20260922T152530Z_93e19005`, 60 pass / **8 fail**): the window defaulted to
  75 ms and silently deferred EVERY parse, breaking 8 existing pins that assert synchronous
  highlighting. The tests were right and the default was wrong — so the DEFAULT moved, not the tests.
  Recorded because that is the regression class the 「move behaviour, move its tests」 rule exists for.
  NOT done from the task's wording: «fenced code highlights after the fence closes» as a TRIGGER — the
  quiet window covers those renderables too, but nothing fires on fence-close itself.
  NOT evidenced: no pixel oracle for this path (T4) — no frame was ever captured.
- [x] **T3 — atomic CodeRenderable update (P2). CLOSED 2026-09-23: MEASURED, THE DEFECT IS NOT
  REPRODUCED.** One method `setStreamingContent(content, preview,
  revision)`: content + preview + invalidate + ONE `updateTextInfo` + ONE `requestRender`; a late
  highlight applies only when `revision` is current AND its visible text/line count matches the
  preview; otherwise defer to stabilisation/finalisation.
  Oracle: the same recorder asserts no intermediate plain/blank frame and a single layout per commit.
  **ATTEMPT 1 ROLLED BACK (2026-09-23) — findings are BINDING for the next attempt.** What is missing
  here is smaller than the wording above, and it is NOT a `revision` parameter: `_highlightSnapshotId`
  already discards a late highlight in four places (`Code.ts:383,404,437,458`), and
  `updateStreamingPreview` (`Code.ts:152-163`) is ALREADY the atomic commit — content + preview + ONE
  invalidation + ONE `updateTextInfo` + ONE `requestRender`. The defect sits in the CALLER:
  `Markdown.ts:applyMarkdownCodeRenderable` runs `updateStreamingPreview` FIRST and then NINE setters,
  and `renderable.content = content` at the end is a SECOND invalidation per delta — the preview already
  assigned `_content` and `_lastContentChangeAt` — so it discards the highlight the preview just started.
  That is the re-parse. Reordering it (configuration first, one commit last, `content` assigned only on
  the non-preview path) was written, measured and REVERTED WHOLE: `254 pass` is IDENTICAL in all three
  runs — with the edit (`20260922T171428Z_d6427f99`), after the revert (`20260922T171611Z_15524cae`) and
  with it again (`20260922T171745Z_895fe16d`) — so it neither breaks prose nor is PROVEN by anything,
  because the pin could not be made into an oracle (see (c)). Per the half-edit rule it was rolled back
  rather than kept on a critical path with a note.
  (a) A `CodeRenderable` in `Code.test.ts` MUST be mounted — `currentRenderer.root.add(renderable)`, 61
      call sites. Unmounted, the frame recorder sees ONLY BLANK FRAMES and the pin lies silently: my
      first attempt failed on `previewStart === -1`, which was the instrument, not the code.
  (b) `packages/opentui/packages/core/src/renderables/__tests__/Markdown.test.ts` is ALREADY RED in this
      tree — 5 failures (`streaming structured list updates keep previous item text visible`,
      `streaming nested structured list updates keep previous nested text visible`, `hyperlink capability
      changes preserve custom Markdown code callbacks`, `theme switching (syntaxStyle change)`,
      `paragraph updates do not flash raw markdown markers`). They reproduce with AND without the edit,
      so they are NOT a T3 regression: they are part of the `88 failures accumulated unseen` owned by
      `plans/2026-09-22_opentui-core-test-ci-gate.md` G1. T3's baseline is these 5, never zero.
      MEASURED TRAP, recorded because it cost this cycle: I first read the 5 reds as MY regression and
      reverted a neutral edit — a correlated signal taken for a causal one. The counter that settles it
      is the pass COUNT across a controlled revert (`254` either way), never the presence of reds.
  (c) The control I proposed is INVALID: with `drawUnstyledText === false` the frames are still
      non-empty (measured `20260922T171745Z_895fe16d`: expected `false`, received `true`), so "no blank
      frame" does NOT separate the setter path from the preview path. The next pin must observe what
      does — the rendered TEXT (`captureFrame()`) or the parse count via `recordHighlightContents`.
  **T3 GROUNDWORK DONE (2026-09-23) — the instrument exists; the fix does not.** `Code.test.ts` carries
  «a streaming preview shows the CURRENT text in the frame, and the setter path is the control»: two
  streams of six deltas, a frame captured after each, and the predicate is the frame TEXT —
  `toContain("line N")` per frame — because frame EMPTINESS does not discriminate (fact (c) above). The
  preview stream must show every line as it lands; the control stream (`content =` with
  `drawUnstyledText === false`) must NOT, and that failure is what gives the predicate power.
  Oracle, RUN: `Code.test.ts` = **69 pass / 1 skip / 0 fail** (285 expect, run `20260922T175337Z_e641bfb8`,
  `exit_code 0`) — 68 pre-existing plus this pin.
  TWO INSTRUMENT FACTS the pin cost, both now inside it: (i) a renderable still MOUNTED keeps painting
  its text into every later `captureFrame()`, so a stream must `destroy()` its renderable or the control
  reads the other stream's output — this is exactly how the first version failed, receiving `true`
  (`20260922T175232Z_00a760a7`); (ii) `captureFrame()` is `captureCharFrame` over the WHOLE renderer,
  never over one renderable, so "isolate the subject" means "leave only the subject mounted".
  STILL OPEN, and named so it is not mistaken for done: the `applyMarkdownCodeRenderable` reorder
  (configuration first, ONE commit last, `content` only on the non-preview path). Its effect is a SECOND
  invalidation per delta, and THIS pin does not observe it — it streams through `updateStreamingPreview`
  directly, not through the Markdown path where the double invalidation lives. The next pin must drive
  `Markdown.content` and count parses (`recordHighlightContents`) or count revision bumps; only then can
  the reorder be graded, and until then it stays reverted.
  **T3 MEASURED — AND THE PREVIOUS READING REFUTED (2026-09-23).** That next pin exists now: «streaming
  markdown spends ONE parse per delta» drives `Markdown.content` through the REAL Markdown path and
  counts parses by wrapping `highlightOnce`. Measured: SIX deltas cost **SIX** parses (run
  `20260922T175753Z_756dde2d`) — exactly one per delta, i.e. **NO second invalidation on this path**.
  That REFUTES the reading the rollback above was based on: `applyMarkdownCodeRenderable` does NOT
  double the bump for ordinary streaming, because on this path the preview branch is not taken
  (`initialStyledText` is undefined) and only the setter runs. The reorder must therefore NOT come back
  as written — the instrument saved the fix, which is the whole point of building it first.
  Law now pinned: **≤ 1 parse per delta** (run `20260922T175908Z_a6e49d75`: 181 pass / 5 fail = the 5
  baseline reds of this file with my pin green; `exit_code 1` belongs to the baseline, not to the pin).
  STILL UNKNOWN, named so it is not mistaken for closed: the PREVIEW-ACTIVE path — an existing block
  re-applied while `isHighlighting` is true, where `updateStreamingPreview` runs AND the trailing
  `content =` may still bump a second time. No pin drives that path yet, and until one does, the T3
  wording («One method `setStreamingContent(content, preview, revision)`») describes a fix whose defect
  is not demonstrated. Measure before writing it.
  **CLOSED 2026-09-23 — the fix is NOT needed, and the two pins say why.** Ordinary streaming through
  the REAL Markdown path costs exactly ONE parse per delta (6 deltas → 6 parses, run
  `20260922T175753Z_756dde2d`), and the preview-active sequence — `updateStreamingPreview` followed by
  the trailing `content =` with a parse IN FLIGHT — costs **ZERO** extra parses (run
  `20260922T192112Z_69fae455`; `Code.test.ts` 70 pass / 0 fail, 71 tests). Zero is not an accident: the
  trailing assignment is a no-op because the preview already assigned `_content`, and on the branch
  where it is not a no-op the preview never ran — the two are mutually exclusive BY CONSTRUCTION. There
  is no second revision bump to remove, so `setStreamingContent(content, preview, revision)` would have
  been machinery for a defect that does not exist. Closed on runtime evidence, not on the absence of a
  symptom — and the instrument that closed it is what saved the wasted fix.
  NOT OBSERVED, named so it is not read as covered: «a single layout per commit», the second half of the
  original acceptance. No instrument measures layout count yet, and no consumer has asked for it.
- [ ] **T4 — pixel oracle for exactly this flow (the missing instrument).** `cmd_runner start --
  dist\bin\opencode.exe` + a prompt forcing a long reasoning stream; capture frames at fixed intervals
  (`cua get_window_state` with `screenshot_out_file`); a reader script asserts: stable lines above the
  live tail are byte-identical between frames; no frame where the visible reasoning is empty/plain; the
  viewport offset changes only when a line is actually appended.
  Falsifier: revert T1/T2 and the same capture must FAIL (frames must differ where the assertion says
  stable) — an oracle that cannot fail proves nothing.
  **LIVE CAPTURE TAKEN 2026-09-23 — the missing instrument now has its first frames.** Until today no
  frame of a live reasoning stream had ever been captured. Two are: `.opencode/data/frame-stream-1.png`
  and `frame-stream-2.png` (kept on disk in `experiments_history/2026-09-23_flicker-pixel-frames/` and
  deliberately NOT tracked: `.gitignore:112` ignores `experiments_history/**/*.png` by design, so the
  frames survive the session but not a clone — re-capture with the recipe below if they are gone), from `dist\bin\opencode.exe` (**10.0.1091**, newer than T1/T2 and therefore
  carrying them — the test binary is `dist/bin`, never the owner's `bin`), launched with
  `cmd_runner start --terminal wt --direct-terminal` and driven by one prompt asking for a long
  deliberation. Recipe that worked: `cua list_windows` → `bring_to_front` → `get_window_state {pid,
  window_id, screenshot_out_file}` — `pid` is REQUIRED, and the window belongs to the `wt` HOST process,
  which the owner's own tab shares: touch only your `window_id`.
  What the frames show: BOTH are mid-stream (`working esc interrupt` visible) and BOTH display the
  reasoning ALREADY FORMATTED — `###` headings, bullet lists, inline code — so the first acceptance line
  («no frame where the visible reasoning is empty/plain») holds on a LIVE stream, not only in a unit
  test. Structural measurement through `imagerender`: ink 13.3% → 14.7%, 25 → 22 ink rows, and the top
  rows shift ONLY while the content grows — the viewport moves because lines are appended, which is the
  second acceptance line.
  NOT DONE, named so it is not read as covered: «stable lines above the live tail are byte-identical
  between frames» was NOT measured — the frames were compared STRUCTURALLY (ink bands, row bands), not
  byte-wise, and the top rows did shift with the growing text. And the FALSIFIER — revert T1/T2 and the
  same capture must fail — was not attempted, because it needs a build of the pre-T1 code. Both stay
  open, and T4 stays unticked.
  **READER BUILT 2026-09-23 — `experiments/2026-09-23_flicker-frame-reader/reader.py`.** Eyes are not an
  instrument, so the comparison is a script: it crops the content area, measures ink as DEVIATION FROM
  THE BACKGROUND (the mode of the brightness histogram) and searches the vertical shift that best aligns
  two frames, reporting the matched-row fraction at that shift. Its own first run is an argument for the
  owner's predicate-power norm — counting DARK pixels as ink turned the dark theme's background INTO ink
  and reported 94% for every frame, `ink_rose=NO` on two frames that plainly grew. Corrected, it agrees
  with imagerender's independent measure: ink **10.7%** against 13.3–14.7%, `ink_rose=yes`.
  **AND THE FIRST COMPARISON WAS DESIGNED WRONG — the reader is what showed it.** The two archived frames
  are MINUTES apart, so most of their content differs; the best alignment is `shift=0 / matched=0.49`,
  which is what an unalignable pair returns. T4's «stable lines above the live tail» can only be judged
  on frames SECONDS apart, one or two appended lines between them. That fixes the next capture's
  contract: a BURST during one stream (~6–8 frames at ~1 s), the reader over CONSECUTIVE pairs, and the
  assertions `ink never falls` and `matched_after_shift ≥ 0.9` at the shift the burst implies. Until
  that burst exists, the stable-lines criterion stays unmeasured — named, not claimed.
  The falsifier still needs a build of the pre-T1 code; unchanged.
  **BURST ATTEMPT 1 (2026-09-23) — script written, blocked by a tooling quirk, NOT yet a measurement.**
  `experiments/2026-09-23_flicker-frame-reader/burst.ps1` implements the contract above (finds the
  newest `cmd_runner:*` window by the ISO stamp in its title, shoots 6 frames at 900 ms, then runs the
  reader over the 5 consecutive pairs) — but it failed twice on its own invocation line, and both
  failures are worth keeping:
  (i) PowerShell `-f` needs DOUBLED braces: `'{"pid": {0}}' -f …` dies with `FormatError`; the working
      spelling is `'{{"pid": {0}}}'`. And never name the variable `$args` — PowerShell reserves it.
  (ii) The deeper one: **PowerShell 5.1 strips the quotes around JSON field names**, so a positional
      JSON argument reaches `cua-driver` as `{pid: 3884, …}` and is refused — the driver says it itself:
      «key must be a string at line 1 column 2 … Pipe the JSON via stdin instead». That is exactly why
      the `cua` TOOL pipes its arguments through stdin, and any script that shells out to the driver
      must do the same or it silently loses the shape of its own payload.
  Worth keeping from the attempt: the window-picking WORKED — it selected the new session's window
  (`33032574`), not the stopped one — but **no frame was written: all six are `MISSING`**, and the reader
  then failed five times on `FileNotFoundError`. An earlier version of this note claimed «frames 1–2
  were written»; that was WRONG — it came from reading the log's TAIL instead of the whole log, which is
  exactly what the canon forbids. Corrected here, because a stale claim is a defect.
  The second attempt (with stdin payloads) produced the same six `MISSING` and NO stated reason, because
  the script piped the driver's output into `| Out-Null`: the failure was hidden by the very line that
  ran the tool. And the run still exited `0` — a script that neither surfaces its instrument's answer nor
  fails on a missing artifact reports success over six missing frames. That is the class: a harness whose
  own report cannot be false is not a harness.
  **BURST ATTEMPT 2 (2026-09-23) — THE CAPTURE WORKS; THE CADENCE IS THE REMAINING DEFECT.** Every
  invocation defect is now fixed and each fix is measured, not assumed: the stdin payload is written by
  the SERIALIZER (`ConvertTo-Json`, so no hand-built escape can be wrong) and fed through
  `Start-Process -RedirectStandardInput` — PS's pipe-to-native delivered NOTHING, and the driver said so
  itself («Missing required integer field pid», which is exactly what it says when it parses the empty
  default `{}`); `screenshot_out_file` is a CLI FLAG (`--screenshot-out-file`), never a body field — read
  off the one working caller in this tree, `packages/opencode/src/tool/cua.ts:147`; the reader path
  pointed at `experiments_history/`, where the file does not exist; and a UTF-8 em-dash inside a
  PowerShell STRING LITERAL makes a BOM-less `.ps1` unparseable (PS 5.1 reads it as ANSI — comments
  survive the mangling, literals do not). With those fixed: **SIX FRAMES WRITTEN** (146030 / 136524 /
  217555 / 282805 / 277402 / 281004 bytes), the driver's own answer printed per frame, and the script now
  FAILS on a missing frame instead of exiting 0 over five of them.
  **WHAT THE READER FOUND.** `best_shift` had to be corrected twice, and both corrections came from the
  frames rather than from theory: (a) it searched only `range(0, limit)` — NON-NEGATIVE shifts — while an
  append-only view anchored at the bottom travels UP, so the hypothesis was inexpressible and it reported
  `shift=0` with `matched≈0.55` on all five pairs, i.e. `matched` never leaving the chrome level;
  (b) scoring ALL rows lets blank rows buy a high score at any shift, since they are byte-identical to
  each other (`matched_all_rows=0.36` against `matched_inked=0.11` on the same pair). Corrected, the
  verdict over the 5 consecutive pairs is `best_shift=0` on all five, `matched_inked` 0.1105 / 0.1099 /
  0.0948 / 0.0752 / 0.0752, `stable_above_tail=no` throughout — while the content plainly GROWS
  (`inked_rows_in_A` 181 → 182 → 211 → 266 → 266; ink 0.0482 → 0.0427 → 0.0824 → 0.1085 → 0.1075 →
  0.1113). Frames 3 and 4 were then READ, not inferred: frame 3 ends at «…bursts are separated by
  pauses» under `## 1. The problem is two clocks, not one`, frame 4 begins at «vsync signal to
  synchronize to…» and is already under `## 2. What exactly is being scheduled`. The two frames share NO
  line at all, so no shift can align them — `matched≈0.1` is coincidence plus chrome, and the reader is
  RIGHT. The crop was also narrowed to the message area (`--bottom 250`): the input box and the
  `81.4K (8%) · $0.01` status row repaint on their own and would cap `matched` for reasons unrelated to
  the stream.
  **THE CADENCE IS THE DEFECT, MEASURED.** Frame mtimes: 13:30:40 · :42 · :44 · :46 · :48 · :50 — a real
  period of **2.0 s**, not the 900 ms the script declares: `Start-Sleep -Milliseconds 900` sits ON TOP of a
  `get_window_state` call that walks the UIA tree and returns ~300 lines of JSON (~1.1 s), and no
  timestamp was ever recorded, so the declared cadence could not be checked against the real one. At 2 s
  the stream advances MORE than one viewport per frame, so consecutive frames cannot overlap and T4's
  «stable lines above the live tail are byte-identical between frames» is not merely unmeasured — it is
  UNEXPRESSIBLE at this cadence. ONE acceptance line is settled again on a second, independent live
  stream: both frames are mid-stream (`working esc interrupt`, `81.4K (8%)`) and both show the reasoning
  ALREADY FORMATTED, so «no frame where the visible reasoning is empty/plain» holds. The OTHER line,
  «the viewport offset changes only when a line is actually appended», does NOT follow from these frames:
  the view moved, and whether it moved only on an append — rather than jumping — is precisely what
  non-overlapping frames cannot show.
  **BURST ATTEMPT 3 (2026-09-23) — THE INSTRUMENT NOW DISCRIMINATES; THE SAMPLE IS TOO SPARSE.** The
  cadence became a measurement (a per-frame `t=+Nms` delta) and the UIA walk was bounded
  (`max_elements: 1`, `max_depth: 1` — the very fields the driver's own `_note` names). Measured `dt`:
  1101 / 1973 / 1930 / 1930 / 1929 / 1927 ms — the bound changed NOTHING (1.93 s against 2.0 s before),
  so «the tree walk dominates» is REFUTED; the ~1.03 s beyond the 900 ms sleep sits somewhere else in
  the driver call. The bounding fields stay in the payload (harmless) but they are NOT the fix, and the
  hypothesis is corrected here rather than kept as a note.
  **THE OVERLAP IS THE REAL CONSTRAINT.** Four of the five pairs returned `overlap=NO` (`matched_inked`
  0.062 / 0.041 / 0.034 / 0.066 against a 0.3 floor): in 1.93 s the stream advances MORE than one crop,
  so those frames share no line and the pair CANNOT judge stability — a verdict the reader now refuses
  to give, instead of reporting ≈0.05 as «lines are unstable».
  **AND THE ONE PAIR THAT DID OVERLAP GIVES THE FIRST REAL READING.** Pair 5→6: `best_shift=-276`,
  `matched_inked=0.6321`, `stable_prefix=67 of 106` considered, frontier at row **371 of 450**. Read
  correctly: A's rows below y=276 have a partner in B (everything above scrolled out of the top), 67 of
  those inked rows are BYTE-IDENTICAL, and the divergence is CONTIGUOUS from row 371 to the bottom edge
  — confined to the last ~3 lines, which is the live tail the stream is writing. That is the append-only
  signature: stable above, divergent only at the bottom edge, nothing changing in the middle.
  `matched_inked=0.63` is not a failure of the criterion — the denominator contains exactly the tail rows
  that are SUPPOSED to differ. A global fraction could never have shown this; that is why the frontier
  measure exists.
  NOT MEASURED, named so it is not read as covered: whether a previously-stable line ever CHANGES — the
  flicker itself. One overlapping pair cannot show a trend; the frontier must be tracked across several
  overlapping pairs, and the burst has to produce them.
  **NEXT, BOUNDED (one edit):** `Start-Sleep -Milliseconds 900` is now pure waste — it DOUBLES the
  cadence on top of a call that already costs ~1.03 s — so it goes to 0 and the frame count rises
  (6 → 12). That nearly doubles the frames per second of stream, and the reader already reports which
  pairs may speak. The reader needs no further change. The falsifier still needs a build of the pre-T1
  code; unchanged.
  **OWNER DIRECTION 2026-09-23 — THE INSTRUMENT IS WRONG FOR THE TIMESCALE; THE FIX IS AN ISOLATED
  REPLAY.** Owner, verbatim: «Бро - ты не сможешь поймать этот дефект так, возьми данные из логгера и
  изолированно просимулируй их в экспериментах. На ране всю систему flick length 0.1 seconds как ты
  можешь их поймать?» The arithmetic agrees: a defect that lives ~100 ms sampled every ~1.9 s is caught
  in ~5 % of frames — a lottery, not an oracle — and the ~1.9 s is not a bug to fix but the instrument's
  floor (the driver call alone is ~1.03 s; bounding the UIA walk did not move it).
  THE DATA EXISTS, GROUNDED: `per-response/*.raw.txt` is the RAW SSE stream — one `chat.completion.chunk`
  per line, so the REAL delta sequence is recoverable byte-exact. Measured on
  `2026-09-22T04-01-53-078Z-2ab6d66e-015b-41b7-9f17-163c01cf7281.raw.txt`: 2258 lines, deltas of 1–5
  characters (`"Two"`, `" tasks"`, `":\n"`, `"1"`, `"."`, `" \""`, `"С"`, `"озна"`, …) — the burst shape
  is real data, not an invention. The DB complements it: 12 796 `reasoning` parts, the longest 268 796
  characters, so a real long reasoning text is available for the replay.
  THE DESIGN (isolated, deterministic, no live capture): replay a real delta stream through the REAL
  renderable and drive the CLOCK BY HAND — deltas delivered at a real rate, a frame captured every ~10 ms
  BETWEEN deltas. A 100 ms event is then not sampled, it is STEPPED THROUGH. Predicate: a frame that
  differs from its neighbour while the delivered content is UNCHANGED is a flicker, and the frame pair
  localises it in the text. Control that gives it power: a legacy drive path (the pre-T2 behaviour —
  repaint from the unstyled source on every delta) must report a non-zero count on the SAME replay, or
  the instrument proves nothing.
  **ISOLATED REPLAY BUILT AND RUN 2026-09-23 — IT MEASURES, BUT IT IS NOT YET AN ORACLE.**
  `packages/opentui/packages/core/src/renderables/__tests__/stream-replay.test.ts` plus
  `…__tests__/fixtures/reasoning-stream.json` (843 real deltas, extracted byte-exact by
  `experiments/2026-09-23_stream-replay/extract.py`). Reconciliation is EXACT: 1129 chunk lines = 843
  reasoning deltas + 1 empty + 285 frames carrying NEITHER field + 0 answer chunks + 0 bad JSON — the
  extractor prints it, because a fixture that silently drops a quarter of its input measures the wrong
  stream. The replay drives the REAL `MarkdownRenderable` (real `TreeSitterClient`, `syntaxStyle`) with
  a frame captured after EVERY delta, and classifies each line TEXT by the sequence of span signatures
  it takes: two signatures is the designed one-way switch, THREE OR MORE distinct values — or a return
  to an earlier one — is a repaint from a second style source while the stream wrote nothing there, i.e.
  the flicker.
  MEASURED (run `20260923T054400Z_cbb59a4a`, 10.6 s): burst run frames=843, `lines=33, oneWay=0,
  flickered=0`, blank frames **126/843**; paused run frames=864, `lines=46, oneWay=0, flickered=0`,
  blank **41/864**. On this REAL stream, through this path, NO line ever changed its span signature —
  not even the designed one-way switch, which is what a prose path that styles SYNCHRONOUSLY produces
  (there is no deferred code parse to land).
  WHAT THIS IS NOT: the count has NO positive control. A metric that has only ever read 0 has not been
  shown able to read anything else, so 0 here is a MEASUREMENT, not a PASS. The control is named: drive
  the pre-T6 preview path (repaint the preview from the UNSTYLED source) on the SAME replay — it must
  produce flips, or the instrument proves nothing.
  TWO INSTRUMENT DEFECTS, one fixed: (a) a single `renderOnce()` was NOT a frame — 843 frames yielded 4
  distinct line texts, i.e. nearly all blank, and the metric would have read 0 for the wrong reason;
  `settle()` (two passes with a macrotask between) fixed it and the harness now prints its own
  blank-frame census. (b) The one-shot equality check captured an EMPTY frame as soon as a third
  renderable joined `renderer.root`; SUSPICION, not a diagnosis (root children lay out in sequence, so
  the subject may sit below the 40-row viewport, or `destroy()` may not detach) — the check was REMOVED
  rather than left red, and the file runs green on instrument-health assertions only.
  NEXT, BOUNDED, in order: (1) the positive control; (2) the root-child suspicion; (3) only then the
  flicker verdict — including a fenced-code fixture, since the prose path styles synchronously and the
  deferred parse this plan fixed lives in `CodeRenderable`.
  **THE LAG THE OWNER REPORTED, ATTRIBUTED BY THE SAME REPLAY (2026-09-23).** Owner: «Вот еще после
  последних правок TUI стала безнадежно лагать.» The 2026-09-23 build changed exactly two things on
  this path, and both were mine: `internalBlockMode="top-level"` (T7) and the quiet window's default
  moving to 0 for every caller (T8c — and NOTHING in `packages/opencode` passes `quietHighlightMs`;
  measured by grep: one hit, and it is `internalBlockMode`). The replay decided between them on the real
  stream, one clock, four configurations (test «the cost of each rendering configuration», run
  `20260923T054647Z_52cdcbbc`, 2 pass / 0 fail):

    coalesced+window75  (the build before today)   5.28 ms/frame
    coalesced+window0                              5.35 ms/frame    (+1.4 % — the window is FREE)
    top-level+window75                             8.40 ms/frame
    top-level+window0   (the build today)          8.60 ms/frame    (+63 % against the pre-today build)

  So the lag is T7's `internalBlockMode="top-level"`, NOT the window: the window's cost sits inside the
  noise, and refuting it cost one line of the table rather than an argument. **The number is a LOWER
  BOUND for the owner's session**: the replay holds ONE markdown block while a real session holds
  thousands, and `top-level` multiplies renderables PER BLOCK — so the cost scales with history, which is
  what «безнадежно» describes.
  WHAT THIS DOES NOT SETTLE, named: (1) whether HIS lag disappears when this is reverted — his runtime
  sat at **1.87 GB** resident (measured, `tasklist`), a second and independent suspect this replay cannot
  see; (2) whether `internalBlockMode` can be switched at `streaming: false` on a live renderable — the
  fix that would keep BOTH the formatting and the speed. That is unverified engine behaviour, so it is
  proposed, never assumed (@ORACLE: measure, do not extrapolate).
  DECISION OWED TO THE OWNER, product-visible both ways: revert `top-level` (cheap markdown returns),
  keep it (the lag stays), or switch it at `streaming: false` (structurally neat, unproven). The
  measurement is the deliverable; the trade is his to make.
  T4 remains unticked.
- [ ] **T5 — ScrollBox (P3), only if T1–T3 leave a residual.** Coalesce `recalculateBarProps()` to one
  call per frame; apply sticky-bottom once after a completed layout transaction; no per-size
  `process.nextTick(requestRender)`.
- [x] **T6 — the computed colour was thrown away and repainted from the unstyled path (owner, 2026-09-23:
  «когда триситер посчитал расцветку ты должен это запомнить, а не пересчитывать каждый раз, а если нет
  — брать данные из внутреннего markdown парсера»). FIXED `Code.ts:updateStreamingPreview`.** The tree
  parser ALREADY stores its result — `_lastHighlights` — and the field was WRITTEN in exactly one place
  (`startHighlight`) and READ NOWHERE: a cache with no reader. So the preview path (added by T2) painted
  the caller's UNSTYLED `initialStyledText` into the buffer on EVERY delta and wiped out whatever the
  parser had computed — the visible colour came from whichever path ran last («то одно, то другое»),
  which is exactly what a fenced ```yaml vector rendered through two sources looks like.
  Now: if `_lastHighlights` exist, the preview is painted FROM THEM (`treeSitterToTextChunks` over the
  appended content — the case their ranges remain valid for) with the conceal line map restored; only
  with nothing computed yet does it fall back to the caller's styled text, which Markdown builds from its
  own tokens. That is the owner's rule verbatim: reuse the parse, else take the markdown parser's data.
  Oracle, RUN: `Code.test.ts` = **70 pass / 1 skip / 0 fail** (287 expect, run
  `20260923T011732Z_e268923b`). NOT yet observed: the live colour itself — this is a rendering claim, so
  its final oracle is a frame, and the burst capture is still owed (see T4).
  OWNER-VALIDATED 2026-09-23: «Все правильно отрисовалось» on a live render of a fenced `yaml`
  document — for this class his eye IS the validation half, and the colour claim now has it. Note what
  that also settles: the ```yaml fence is NOT the defect (owner: «tree sitter должен рендерить yaml
  так») — the defect was repainting the unstyled text over the computed colour, and `@SV_FORMAT`'s
  fenced shape is CORRECT and stays. The frame-based verification of the flicker itself remains owed.
- [ ] **T7 — prose is rendered through the engine's `coalesced` mode; inline structure is destroyed before it
  can be drawn (P0).** Owner, 2026-09-23: «текст уже не дергается, но цвета мерцают, форматирование не
  применяется, markdown рендерится убого» — this task is the «форматирование / markdown» half; T8 is the
  colour half.
  MEASURED ✓ 2026-09-23: upstream `@opencode-ai/tui` renders session text with
  `internalBlockMode="top-level"` + `tableOptions={{ style: "grid" }}`
  (`external/opencode-1.18.29/packages/tui/src/routes/session/index.tsx:1692-1701`), while our `RichText`
  passes no `internalBlockMode` (`routes/session/index.tsx:2200-2207`) and inherits the engine default
  `coalesced` (`packages/opentui/packages/core/src/renderables/Markdown.ts:357`). `docs/rendering.md` §5c
  names the cost: inline tokens (`strong`, `em`, `codespan`, `link`) are destroyed, lists lose their
  hierarchy, headings lose depth — and §5h records that tree-sitter's markdown query highlights only
  STRUCTURAL nodes and never inline formatting, so the destroyed inline structure has no second source.
  Scope: `RichText` (`routes/session/index.tsx:2181-2216`) — the ONE component behind every prose call
  site. Change: add `internalBlockMode="top-level"` and `tableOptions={{ style: "grid" }}` to its
  `<markdown>`. `top-level` already exists in our fork (`Markdown.ts:2075, 2208`) — this SELECTS the mode
  we already ship; it does NOT change the engine default (the mode is per-call, because tool output and
  code blocks share the same constructor).
  STATUS 2026-09-23: code change DONE (`RichText` now passes `internalBlockMode="top-level"` +
  `tableOptions={{ style: "grid" }}`, `routes/session/index.tsx:2208-2217`); unit regression green
  (`bun test test/tui/` = 155 pass / 0 fail, run `20260923T043837Z_69d996db`). The structural pin (a) is
  IN: `Markdown.test.ts` — «top-level keeps markdown block identity — N paragraphs are N prose
  renderables, not one coalesced blob» — green in run `20260923T051143Z_d0c72565` (182 pass / 5 fail;
  the five are EXACTLY the T3 baseline reds, now recorded: `streaming structured list updates keep
  previous item text visible while highlighting`, `streaming nested structured list updates keep previous
  nested text visible while highlighting`, `hyperlink capability changes preserve custom Markdown code
  callbacks`, `theme switching (syntaxStyle change)`, `paragraph updates do not flash raw markdown
  markers`). The pin fails by construction when the two modes stop differing (`coalesced < top-level`
  control half). Still owed: (b) re-run of the two suites after any further change; (c) owner-eye on a
  live stream after the rebuild; and the pixel oracle (T4) remains the named risk.
  **REVERTED 2026-09-23, ON THE OWNER'S CALL — the mode cost more than the structure was worth.** Owner,
  verbatim: «1. Откатить top-level — одна строка, возвращает 5.28 мс/кадр; markdown снова «убогий».» The
  measurement behind that choice is the replay cost table (5.28 → 8.60 ms/frame, +63 %, and it multiplies
  by the number of markdown blocks a session holds). The revert is exactly ONE property:
  `internalBlockMode="top-level"` is gone from `RichText` (`routes/session/index.tsx:2212-2220`).
  `tableOptions={{ style: "grid" }}` STAYS and is not dead config — in `coalesced` mode `grid` IS the
  engine default (`Markdown.ts:1502`), so tables render exactly as before. Verified: `bun test test/tui/`
  = **155 pass / 0 fail** (20 files, 8.75 s). Commit `2463da715d`.
  WHAT THIS RE-OPENS, named so it is not quietly closed: the owner's original complaint («форматирование
  не применяется, markdown рендерится убого») is UNFIXED again, because coalesced destroys inline
  structure. The `top-level` pin STAYS — it tests the engine, which still supports both modes — so the way
  back is one line whenever the cost is affordable: per-block switching at `streaming: false` remains
  UNVERIFIED engine behaviour and is therefore a candidate, not a plan.
  The graph of this whole path now lives in `docs/rendering.md` §2 (mermaid, verified against the code,
  with both defects annotated where they happened).
  Risk (§4): `RichText` is shared by reasoning AND prose — a change that helps one and regresses the other
  is a regression.
- [ ] **T8 — colour must have ONE source per frame; the quiet window must not flip the palette (P1).**
  Same owner report; T6 already removed one half of the class — the preview no longer repaints the buffer
  from the UNSTYLED path, it reads `_lastHighlights` (`Code.ts:152-182`, oracle `Code.test.ts` 70 pass /
  0 fail, run `20260923T011732Z_e268923b`; owner-validated on a live yaml fence). The OTHER half is
  unmeasured: while `streaming` is true the visible style can come from two sources in alternation — the
  marked-derived preview and the last tree-sitter snapshot — with the global quiet window deciding the
  winner (`QUIET_HIGHLIGHT_MS = 75`, `Code.ts:56`, wired for ALL prose at `Markdown.ts:814, 1134`). Under
  a 25–50 delta/s stream the window rarely fires during the burst (no parse while the stream is hot), one
  parse lands on the first pause, and the next delta repaints from the other source — the alternation the
  eye reads as «цвета мерцают».
  STATUS 2026-09-23: (c) DONE BY MEASUREMENT — the global window was the ROOT CAUSE of five red
  streaming pins: `Markdown.ts` hardcoded `quietHighlightMs: QUIET_HIGHLIGHT_MS` in BOTH constructors
  (prose + fenced code), so every markdown parse was deferred past what the streaming pins observe
  (`182 pass / 5 fail`, run `20260923T051143Z_d0c72565` — the exact five named in T7's STATUS below).
  The window is now a PER-CALL option (`MarkdownOptions.quietHighlightMs`, default 0 — the engine is
  synchronous unless a caller opts in), and `Markdown.test.ts` is back to **187 pass / 0 fail** (run
  `20260923T051405Z_0871d8a9`). A caller that knows its deltas are coming (the opencode RichText
  path) may opt in later — that decision belongs to a live-stream observation, not to this plan.
  (a)/(b): with the window gone the style source is marked until the first tree-sitter pass and
  tree-sitter after it — plausibly a single one-way switch per block rather than an alternation,
  which is exactly the case the plan predicted could DELETE the «one source per frame» requirement.
  NOT yet measured on a live stream (rebuild + owner-eye + T4 remain the named validators); no
  machinery is added before that measurement. Note: the two runs above also disprove a process
  assumption — a runner started in the same batch as a multi-step edit CAN read the file mid-write
  (140 fail with `ReferenceError: QUIET_HIGHLIGHT_MS is not defined`, run `20260923T051323Z_c3a36f12`,
  was exactly that race). Edit and run sequentially.
  Order: T7 → T8.
  **2026-09-23 — T8's mechanism is MEASURED and FIXED by T11** (the setter path repainting the caller's
  source over the stored parse: 2 764 returns → 0 on the real stream). T8 stays unticked for its own named
  validators — a rebuilt binary and the owner's eye on a live stream — which have not happened yet.
  Binary REBUILT 2026-09-23: `pwsh _build.ps1 -Task build` exit 0 (log
  `experiments/2026-09-23_stream-sources/build-20260923T125936Z.log`; OpenTUI lib rebuilt as stale),
  `dist/bin/opencode.exe` **10.0.1096**, 302 169 088 B; read back from the artifact: `paintFromStoredHighlights`,
  `_lastHighlightsContent` and the T10 mermaid-cache message are each present once in the binary. The owner's
  `bin/opencode.exe` is untouched. Owed: the owner's eye on a live stream with this build.
  REBUILT AGAIN with T11b steps 1–2 and the parser catch fix: `dist/bin/opencode.exe` **10.0.1097** (log
  `experiments/2026-09-23_render-load/build-20260923T143029Z.log`, exit 0); read back from the artifact:
  `closedAtBreak` ×2, `storedHighlightsFor` ×1, `canPaintFromStoredHighlights` ×2.

### 2026-09-23 — pipeline audit below the content layer (owner: «глянь пайплайн отрисовки и как он влияет на общую скорость»)

Read-only audit, code-read only (✓ = read in code, ? = inferred, nothing measured yet). The LOWER layers are
sound ✓: the agent runs in a Worker (`cli/cmd/tui/thread.ts:172`), a frame is composed whole into the buffer
and diffed once (`renderer.ts:4688-4847`), and every emitted frame is wrapped in `?2026h … ?2026l`
(`native/src/renderer.zig:1745, 2819`) — the terminal never sees a torn frame. The defects sit above:

- **Two style sources alternate per delta ✓ (mechanism), ? (visibility).** `applyMarkdownCodeRenderable`
  ends in `content =` (`Markdown.ts:1172`), which paints marked's styling (`Code.ts:142-143`); the tree-sitter
  result then overwrites it unconditionally (`Code.ts:463-464`) — the §5h guard in `docs/rendering.md` is NOT
  in the code. The markdown query carries no inline scopes (§5h), so bold/italic/code appear and vanish per
  delta. This is T8's class, now pinned to lines.
- **The replay's `oneWay=0` is not yet evidence ?.** `settle()` waits one macrotask between passes; a
  tree-sitter Worker round-trip almost certainly does not land in it, so the instrument may never have seen
  source (c). Discriminator: count `highlightOnce` completions during the replay.
- **Per-delta main-thread work is O(message) and per-frame work is O(history) ✓:** `splitTextSegments` over
  the whole text (`index.tsx:2203`), the incremental lexer's `startsWith` walk (`markdown-parser.ts:35-43`),
  the whole coalesced prose blob re-highlighted from scratch (`parser.worker.ts:837`), `memoryRuns` reading
  every text part (`index.tsx:286-289`), `updateFromLayout` over every loaded message (`Renderable.ts:1447`).
  2–3 frames per delta: `ScrollBox.ts:802` `nextTick(requestRender)` on every size change, and superseded
  highlights still `requestRender` (`Code.ts:403, 424, 457`).
- **Images (owner, same day: «картинки… лагает, потому что явно мы всё перерендерим пачку раз»):**
  rasterisation runs once per mount ✓ (`RichText` `<Index>`/`<Switch>`, `index.tsx:2208-2225`), but there is
  NO rasterisation cache ✓ (`util/mermaid.ts`), so every remount re-runs WASM→SVG→RGBA. On the sixel path a
  placement is dirty whenever its POSITION changes (`renderer.zig:1871-1896`), so an image moving with a
  sticky-bottom stream re-SENDS its whole cached payload every frame; a clipped image changes
  `source_y/source_height`, which are IN the cache key (`renderer.zig:162-174`, `buffer.zig:2581-2603`), so it
  is RE-ENCODED every frame. `setImage` builds a new `NativeImage` per call (`Image.ts:137-139`) and never
  disposes the caller's reference — the skill's contract says the caller must
  (`.opencode/skills/opentui/references/components/text-display.md:305-306`); `pushFrame` does it twice per
  zoom step (`media-image.tsx:396-399` + the effect at `:590`).
- **Small, real ✓:** `index.tsx:355` writes the collapse control into the OLD `collapseControlCache`, which
  line 360 then replaces with the empty `nextControls` — the cache never holds, and the `[-]` row of an
  expanded memory run remounts per delta.
- **Skill vs our choice ✓:** the vendor recommends `internalBlockMode="top-level"` for LLM streaming
  (`code-diff.md:274-287`); T7 reverted it on a cost measured WITHOUT any product cache, on one block. The
  choice is to be re-measured after T11, not before.

Owner direction (Guess, not a requirement): a dumb render cache keyed on our conditions, feeding the
renderer finished products; Zig or Rust «как удобнее». Grounded answer: the caches EXIST (TextBuffer, the
sixel LRU, render-list reuse) — their KEYS churn. The product cache is therefore content-keyed products on the
documented API (`NativeImage.retain()`, `text-display.md:281-306`), in TS where the producers live, and the
native change is confined to the sixel emission path. Rust would be a second native toolchain for no gain.

- [x] **T9 — bytes-per-frame oracle for images in a scrolling ScrollBox (the instrument first).** A real
  `createCliRenderer` over a capturing stdout (the idiom of `tests/image-renderable.test.ts:47-60, 360-391`),
  `protocol = "sixel"`, a sticky-bottom `ScrollBox` holding text + one `ImageRenderable` + text, lines
  appended one per frame. Per frame: total bytes, sixel DCS count (`\x1bP`), and whether the payload equals the
  previous one (re-send) or differs (re-encode). Four cases, and the controls give the predicate its power:
  (A) image scrolled out of view → 0 DCS; (D) nothing appended, render requested → 0 DCS; (B) image fully
  visible and moving → predicted 1 DCS per frame, identical payload; (C) image straddling the top edge and
  moving → predicted 1 DCS per frame, a NEW payload each frame. Falsifier of the audit: (B) or (C) at 0 DCS.
  Acceptance: the file runs green on instrument-health assertions (A/D zero, B/C non-zero) and prints the
  table; the numbers are recorded here.
  **DONE 2026-09-23 — the audit's image claims are now MEASURED.** Instrument:
  `packages/opentui/packages/core/src/tests/image-scroll-cost.test.ts` (40×20 terminal, 10×20 px cells, an
  8×6-cell / 80×120 px gradient, sixel forced, one appended line per step). Run from
  `packages/opentui/packages/core`: `bun test src/tests/image-scroll-cost.test.ts` = **1 pass / 0 fail**
  (7 expect); log `experiments/2026-09-23_image-scroll-cost/run-20260923T121841Z.log`, sha256
  `5cdda65dcccc5c173bb89c04d4cca45916b8b5acd61043171f4379115137adf1`. Two runs gave byte-identical volumes —
  the instrument is deterministic.

    phase            frames  with image  re-sent  re-encoded  avg bytes/step
    static (tick)        4        0          0         0            73
    visible + moving    10       10         10         0        14 074   (payload 13 187 B every step)
    clipped + moving     5        5          0         5        10 981   (a NEW payload every step)
    out of view         15        0          0         0           768

  Read: a moving, fully visible image costs **~18×** the bytes of the same stream with the image out of view,
  because its whole payload is re-sent on every step; a clipped moving image is re-encoded on every step
  (5 of 5). Both controls read zero — a static image emits nothing while other cells change, and an image out
  of view emits nothing — so the predicate CAN tell the cases apart. That is the audit's prediction, now at
  Exact for this harness.
  SECOND FINDING, same run: an appended line costs **2 frames**, an in-place change (the static tick) costs
  **1** — the extra frame is `ScrollBox.ts:802`'s `nextTick(requestRender)`, measured, not inferred. The image
  is sent once per step, not per frame (the second frame finds it unmoved).
  NOT MEASURED, named: (1) CPU cost of the re-encode — the `ms` column is WALL time bounded by frame
  scheduling (≥16.7 ms per frame: 17 ms for 1 frame, 34–36 ms for 2), so clipped (34.9) and visible (36.6)
  cannot be told apart by it; a CPU oracle needs the native encode timed directly (`renderStats`) or the
  bench `native/src/bench/terminal-image_bench.zig`. (2) Scale: 13 KB is an 80×120 px image; a diagram up to
  512 px per side carries far more pixels, so the real per-step payload is larger — unmeasured. (3) The first
  paint emits the payload TWICE (step 0: 2 DCS, 1 re-sent) — a second settle frame re-sends it; unexplained.
  Gate note: `bun run typecheck` exit 0, but `tsconfig.build.json:16` EXCLUDES `**/*.test.ts`, so the
  package's typecheck does not cover this file — bun transpiles and runs it, nothing more.
- [x] **T10 — image ownership and a rasterisation cache.** `setImage` releases the caller's reference after
  the renderable retains it; `pushFrame` publishes ONCE (not signal + direct call); diagrams keep one
  `NativeImage` per `(source, budget, theme)` so a remount reuses the handle and the sixel LRU hits.
  Oracle: T9's case (B)/(C) across a remount shows no re-encode on remount, and a handle count (or
  `NativeImagePool`-style accounting) returns to its baseline after N zoom steps.
  **DONE 2026-09-23 for three of its four parts; the fourth is split out as T10b, named below.** All three
  oracles were written FIRST and ran RED on the unfixed code for the predicted reason, then GREEN after:
  (1) `core/src/tests/image-set-image.test.ts` — every wrapper `setImage` builds is released (`handle` null
      after `dispose()`, `image.ts:646-650`) while the renderable keeps a live 2×2 image. Baseline RED:
      3 of 3 wrappers still held a handle. Fix `Image.ts:setImage`: build, assign, `dispose()` — the
      skill's ownership contract (`text-display.md:305-306`).
  (2) `opencode/test/tui/media-image-publish.test.tsx` — the REAL `MediaImage`, one wheel zoom step.
      Baseline RED at the step assertion: **2** publications per step, while the mount control read 1.
      Fix `media-image.tsx:pushFrame`: `setFrame` only; the frame effect publishes.
  (3) `opencode/test/util/mermaid.test.ts` «returns the stored frame for the same inputs, a new one for
      different inputs» — identity for the same `(source, theme, background, budget)`, a different frame for a
      different budget (240 px wide) or source. Baseline RED (equal content, different object). Fix
      `util/mermaid.ts:renderMermaidToRgba`: an 8-entry LRU of frame promises, failures not stored, cleared by
      `resetRendererCache`.
  Runs, all 0 fail: core `image-set-image` + `image-renderable` + `image-scroll-cost` = 29 pass;
  opencode `media-image-publish` + `media-image-native-layout` + `-size` + `-fallback` + `-subscriptions`
  = 28 pass; `mermaid.test.ts` = 19 pass. `bun run typecheck` (core) exit 0; `bun typecheck` (opencode)
  exit 0. T9's table is unchanged after the fix, as it must be — T10 does not touch the scroll path.
  ACCEPTANCE SUBSTITUTION, named: the plan's oracle asked for a native handle COUNT; there is no handle-count
  API in `core/src/image.ts`, so ownership is read off the wrapper (`handle === null`) — the same fact from
  the JS side. And «no re-encode on remount» is NOT met: a remount now skips WASM → SVG → RGBA (the frame is
  the stored object), but the ref callback still builds a NEW `NativeImage` from it, so the sixel cache key
  (which carries the handle) misses once per remount.
- [ ] **T10b — reuse the native handle across a remount — ONLY if the encode is shown to cost.** One
  `NativeImage` per stored frame (a `WeakMap<frame, NativeImage>` with a `FinalizationRegistry` disposing the
  native side when the frame is collected), handed over as `source` instead of `setImage`. Gate: T9's
  residual (1) — the CPU cost of a sixel encode — must be measured first; one encode per remount is not worth
  a disposal protocol until a number says so (DISAS).
- [x] **T11 — content-keyed text products; one style source per finished block.** Key `(block raw, width,
  theme, conceal)` → styled lines, produced ONCE by our rules (marked for prose, tree-sitter for code); a
  finished block is a lookup. Then re-measure `top-level` vs `coalesced` on the replay with the cache ON.
  Oracle: the replay with tree-sitter completions COUNTED (the discriminator above) shows 0 style flips on
  stable lines, and the cost table is re-run. Supersedes T8's open half.
  **DONE 2026-09-23 for the flicker half; the cache half is split out as T11b, named below.**
  THE INSTRUMENT FIRST (T11a): `core/src/renderables/__tests__/stream-replay-sources.test.ts`. The old
  replay's zero had THREE independent reasons to be zero, all read in its code: a one-entry stylesheet (every
  source resolves to the same colour), a classifier that folded A → B → A into [A, B], and no wait for or
  count of tree-sitter results. The new file uses the TUI theme's scope names, records every change including
  returns, captures a frame right after each delta AND one `DELTA_GAP_MS = 25` later, and counts
  `highlightOnce` completions through a pass-through wrapper. Powers: POSITIVE control (the stylesheet swapped
  under fixed text) = returns on 4 of 4 lines; NEGATIVE control (flat stylesheet) = 0; health = 843 of 843
  parses delivered.
  MEASURED BEFORE THE FIX (log `experiments/2026-09-23_stream-sources/run-20260923T124857Z.log`): 3 lines
  returning, **2 764 returns**; the worst, a list line «1. "Сознай папку emergency…», changed signature on
  **1 642 of 1 686 frames** — plain default colour (`#d9d9d9`) on all 820 frames right after a delta, the
  list-marker colour (`#66ccff`) on all 820 frames one gap later. So every delta reset the parse's colour and
  the parse painted it back ~25 ms later; lines holding `` `code` `` also alternated their CONCEAL (the
  backticks shown, then hidden). ALSO REFUTED by the same data: `docs/rendering.md` §5h's «tree-sitter's
  markdown query never highlights inline formatting» — the tree ships a `markdown_inline` injection
  (`lib/tree-sitter/default-parsers.ts:39-58`); the observed difference was the list marker and conceal, not
  bold/italic.
  THE FIX — the owner's T6 rule, applied to the second path. T6 made `updateStreamingPreview` reuse the
  stored parse; the `content` SETTER still painted the caller's styling (or plain text) on every delta. Both
  now go through one helper, `Code.ts:paintFromStoredHighlights` (stored ranges reused only while the content
  they were computed for is a PREFIX of the current one — a guard the T6 preview path did not have), and the
  setter uses it only where the caller allows not-yet-parsed text on screen (`drawUnstyledText`).
  THE FIRST VERSION OF THE FIX WAS WRONG, and a filter trap nearly hid it: running
  `src/renderables/__tests__/Code.test.ts` looked like «the Code suite» and was green — the 70-test suite that
  holds the T2/T3/T6 pins is `src/renderables/Code.test.ts`, a DIFFERENT file, and it was RED: «streaming with
  conceal and drawUnstyledText=false should not jump when fenced code blocks are concealed», 5 frames of raw
  ``` — the stored ranges cover only the old prefix, so the unparsed tail was painted raw on a block whose
  caller had forbidden exactly that. The `drawUnstyledText` guard is the correction.
  AFTER (each file run SEPARATELY, counts per file): `src/renderables/Code.test.ts` 70 pass / 1 skip / 0 fail
  (back to its baseline); `__tests__/Code.test.ts` 2 pass; `__tests__/Markdown.test.ts` 187 pass;
  `__tests__/stream-replay.test.ts` 2 pass; `__tests__/stream-replay-sources.test.ts` 2 pass with **rich:
  returning 0, returns 0** (flat control still 0, 843 parses delivered); opencode `bun test test/tui/` 156
  pass / 0 fail; core `bun run typecheck` exit 0.
  COST, re-run: the fix removes flicker, NOT CPU — `coalesced+window0` 5.30 ms/frame (5.35 before),
  `top-level+window0` 8.54 (8.60 before). A second run of the same table gave 6.65 / 7.97: the proxy's
  run-to-run noise is ~25 %, so only the ratio (top-level ≈ 1.2–1.6× coalesced) is a finding. The vendor's
  `top-level` recommendation therefore still does not pay here; `coalesced` stays.
  THE OLD REPLAY'S CLASSIFIER is corrected in place (it now records a change back), and still reads 0 — as
  it must under its one-entry stylesheet, which the new negative control shows cannot produce a return.
  Observed and NOT explained: that file reports `lines=350` when run in one `bun test` invocation with other
  files and `lines=33` alone — the instrument depends on what runs beside it.
  NOT DONE from the task's wording: the content-keyed cache itself → T11b.
- [ ] **T11b — the render cache that takes the LOAD off (owner, 2026-09-23: «кэш нужен не только для
  устранения мерцания, кэш нужен чтобы снять нагрузку»).** The earlier gate («only if a profile shows the
  CPU») is withdrawn on the owner's word; the measurement stays, as the BASELINE the cache must move and as
  the map of WHERE it must sit.
  BASELINE, instrument `experiments/2026-09-23_render-load/profile.ts` (real 843-delta stream through the
  real MarkdownRenderable, production config: coalesced, no quiet window, real tree-sitter, theme-shaped
  stylesheet, 25 ms delta gap; `stream <P>` streams on top of P chars already written, `history <N>` puts N
  finished messages in a culling, sticky-bottom ScrollBox; raw rows in `baseline.jsonl`):

    scenario            main ms/delta   of which content setter
    stream, P = 0            1.45              0.78
    stream, P = 12 000       5.39              3.95
    stream, P = 30 000      13.89             11.60
    history, N = 10          1.46              0.63
    history, N = 40          1.69              0.66

  Read: the load is LINEAR in the length of the message being written (~0.42 ms per 1 000 chars per delta,
  almost all of it in the synchronous `content` setter); history is nearly free (+16 % for 40 messages —
  culling works). At 25 deltas/s a 30 000-char message already takes ~35 % of the main thread, and a
  100 000-char one no longer fits a frame. So the cache belongs on the message BEING WRITTEN, not on history.
  CPU profile of P = 30 000 (`bun --cpu-prof-md`, `prof/stream30k.md`): marked's `inlineTokens` ≈ 38 % total,
  called by `createInitialStyledText` (601 samples against 10 from the block `lex`); `setStyledText` 25.8 %
  (all of it under `paintFromStoredHighlights`); `bufferDrawTextBufferView` 7.5 %; yoga 7.4 %;
  `treeSitterToTextChunks` ≈ 4.5 %; `parseMarkdownIncremental` 0.2 % (the block lexer is incremental and
  cheap). Cause of the first: the coalesced run is ONE synthetic token `{ tokens: [], text: raw }`
  (`Markdown.ts:createMarkdownBlockToken`), so `createInitialStyledText` re-lexes the WHOLE run inline on
  every delta — and since T11 that result is thrown away whenever the stored parse paints.
  - [x] **Step 1 — do not build what is thrown away.** `applyMarkdownCodeRenderable` takes the styling as a
    thunk and builds it only when `CodeRenderable.canPaintFromStoredHighlights(content)` (new, the same
    conditions the setter and preview apply) is false; otherwise the renderable keeps the styling it holds as
    its fallback. The hot call site (`updateBlockRenderable`) passes the thunk. MEASURED (`step1.jsonl`):
    P = 30 000 **13.89 → 7.13 ms/delta (−49 %)**, setter 11.60 → 5.01; P = 12 000 5.39 → 3.79 (−30 %);
    P = 0 1.45 → 1.15. Suites, each file separately: `src/renderables/Code.test.ts` 70 pass / 1 skip,
    `__tests__/Code.test.ts` 2, `__tests__/Markdown.test.ts` 187, `stream-replay` 2, `stream-replay-sources`
    2 with rich returns still 0; core typecheck exit 0.
  - [x] **Step 2 — finished blocks are products, the tail is the only thing rebuilt.** Cut the coalesced run
    at the parser's `stableTokenCount` and close stable runs at a size cap at token boundaries, so a closed
    run's raw never changes again: `updateBlocks` already reuses a block whose `tokenRaw` is unchanged, so a
    closed run costs NOTHING per delta (no `setStyledText`, no parse), and the per-delta work becomes O(tail).
    The remaining 25.8 % (`setStyledText` of the whole run per delta) is its target. Visual-equivalence oracle
    required first: the final frame with the cut must equal the frame without it (a trailing `\n` must still
    yield the blank line between paragraphs — `getInterBlockMargin` gives 0 between two synthetic paragraphs).
    **DONE 2026-09-23.** ORACLE FIRST: `core/src/renderables/__tests__/markdown-closed-runs.test.ts` —
    snapshots (text AND spans) WRITTEN BY THE PRE-CHANGE CODE for three renders: the real fixture streamed,
    a synthetic 12 000-char document (headings, inline marks, lists, fences) streamed, and a 9 048-char
    FINISHED message (`streaming: false`; its snapshot was written with step 2 stashed — `git stash push` of
    `Markdown.ts` only — so the reference is the old code, not the new one grading itself). Streamed must also
    equal a one-shot render of the same text.
    THREE WRONG VERSIONS, each caught by an instrument, recorded because each is a trap:
    (1) cut at the parser's boundary with the run's trailing `\n` kept → 2 blank lines LOST (one per cut)
        against the reference; (2) a margin added, trailing `\n` still kept → a one-shot drew the trailing `\n`
        as an empty line (block h = 31) while the streamed block had it concealed (h = 30): PATH-DEPENDENT —
        fixed by storing a cut run with NO trailing newline and restoring the blank line by the margin alone
        (`closedAtBreak`); (3) cut at the parser's `stableTokenCount` → `stream-replay-sources` went from 0 to
        3 returns, and `experiments/2026-09-23_render-load/flip-trace.ts` showed why: block 0 was 327 chars at
        delta 106, 10 at 107, 327 at 108 — the parser's count is `matched − 2` and moves BACKWARDS, and a token
        it calls stable can still grow (a list absorbs an item after a blank line). A clipped-highlights path
        for shrinking content (`Code.ts:storedHighlightsFor`) was added on the way; it is correct and kept, but
        it was NOT the fix.
    THE RULE THAT HOLDS: a run is closed only at `CLOSED_RUN_CAP = 2 000` chars, only right after a paragraph
    and a blank line (the only boundary the text before cannot move across), only inside
    max(parser stable end, previous closed prefix) — so closure is STICKY (`_closedLength` / `_closedPrefix`,
    reset only when the content is rewritten rather than appended).
    AFTER (`step2-final.jsonl`): P = 30 000 **13.89 → 2.01 ms/delta (−86 %)**; P = 12 000 5.39 → 1.69
    (−69 %); P = 0 1.45 → 1.10; history 40 1.69 → 1.53. The load no longer grows with the message: 12 000 and
    30 000 cost nearly the same, the per-delta work is bounded by the cap plus the live tail.
    Suites, each file separately: `src/renderables/Code.test.ts` 70 pass / 1 skip; `__tests__/Code.test.ts` 2;
    `__tests__/Markdown.test.ts` 187; `stream-replay` 2; `stream-replay-sources` 2 with rich **returns 0**;
    `markdown-closed-runs` 3 pass against the old-code snapshots; flip trace 0 plain deltas; core typecheck
    exit 0; opencode `bun test test/tui/` 156 pass.
  - [x] **Step 3 — remount.** A finished message re-entering the view re-lexes and re-highlights from scratch;
    a product cache keyed by the closed run's raw (+ width, theme, conceal) serves it. Measured need first
    (the history scenario does not remount, so it cannot show this yet).
    **DONE 2026-09-23 — and the measurement moved the cache to a different key than the one guessed above.**
    Instrument `experiments/2026-09-23_render-load/remount.ts` (N finished messages mounted into a culling,
    sticky-bottom ScrollBox, destroyed, mounted again; main-thread time for construction, first frame and
    settle, parses counted). Before (`remount.jsonl`): 40 × 12 000 chars — construct 188 ms first / 139 ms
    remount, first frame 38 / 9, settle 17 / 6, **6 parses** either way. Tree-sitter barely takes part
    (culling: only visible blocks highlight); the whole cost is the synchronous construction of EVERY message,
    and a CPU profile (`prof/remount40x12k.md`) puts marked's block `lex` at 278.9 ms of the two mounts —
    ~85 % of construction — against 25 ms for `setText`. So the key is the MESSAGE TEXT → its tokens, not a
    styled product per run: `markdown-parser.ts:lexWhole` stores full lexes (≥ 512 chars, LRU, ≤ 256 entries
    and ≤ 2 000 000 chars) and returns the stored array; tokens were checked read-only downstream (a
    control-checked grep over `renderables/` for writes to token fields: none but the synthetic
    `closedAtBreak`; opencode passes no `renderNode`).
    Oracle first, RED on the old code (`markdown-parser.test.ts` «a full lex of the same long content returns
    the stored tokens; different content does not»: equal content, different array), GREEN after; its
    controls: different content → a new array, short content → uncached, and a streaming call on stored
    tokens still computes its own `stableTokenCount`.
    AFTER (`remount-step3.jsonl`): remount construct 40 × 12 000 **139.3 → 30.5 ms (−78 %)**; 40 × 3 000
    51.2 → 13.3 (−74 %); 100 × 3 000 117.0 → 17.0 (−85 %). Suites per file: parser 20 pass, Markdown 187,
    markdown-closed-runs 3, Code 70 / 1 skip, stream-replay-sources 2 with returns 0; core typecheck exit 0.
    NOT helped, named: the FIRST mount (154 ms for 40 × 12 000, 122 ms for 100 × 3 000) — nothing is stored
    yet. → Step 4.
  - [ ] **Step 4 — the first entry into a session: do not lex what nobody sees.** Every loaded message is
    constructed (lexed) at mount, visible or not; culling then skips painting the off-screen ones, but their
    construction was already paid. Defer `updateBlocks` of a message until it first becomes visible (or the
    frame is idle). Oracle: `remount.ts` first-mount construct time, plus the closed-runs equivalence test and a
    scroll-into-view frame for a deferred message.
- [ ] **T12 — move pixels with the terminal, not with a repaint (Hypothetical).** Probe on Windows Terminal:
  does a DECSTBM region + scroll-up (`CSI n S`) carry an on-screen sixel with it? The fork already drives a
  bounded scroll region (`renderer.zig:1726`, split-footer). If yes: a sticky-bottom append becomes a
  terminal scroll plus the new rows, and case (B) drops to ~0 image bytes. If no: the fallback is to show a
  placeholder, not pixels, for a clipped image while the view is moving. Oracle: T9's bytes per frame.

## 3. Smoke Tests (PRE_FLIGHT — before any edit)

Baseline [Exact], from `packages/opencode`:

1. `bun test test/tui/` — record pass/fail counts (2026-09-22: **158 pass / 0 fail**, run
   `20260922T124815Z_724fe65e`). DRIFT, unexplained: the same set re-measured later that day gives
   **140 pass / 0 fail** (738 expect, run `20260922T140344Z_d25a6938`) — do not treat 158 as current
   until the difference is named; it is a finding, not a baseline.
2. `bun typecheck` — exit 0 (2026-09-22: exit 0).
3. Pixel baseline: one capture run of the flow in T4 with the CURRENT build — recorded as the
   reference the fix must move.

Post-implementation: the same three, plus T1–T3 unit counters, the T7/T8 counters, and the T4 capture PASS.

## 4. Risks and rollback

- **The tail is the only live feedback during a long thought** — a rotation that hides text mid-thought
  is worse than flicker. Rotation only at blank lines, and the omitted-count line stays visible.
- **`parseMarkdownIncremental` is shared** (Markdown renderable, not only reasoning) — the parser pin
  must cover both callers; a change that helps reasoning and regresses prose blocks is a regression.
- Rollback: each task is one commit; T1/T2 are confined to `ReasoningPart` + the Markdown/Code call
  path, so reverting the commit restores the previous rendering without touching the renderer core.
