# t135 — box context: section, following lines, manifest, receipts

## plans/2026-09-12_anthropic-cache-breakpoints.md  — open 0 / done 0 · lifecycle DRAFT


## plans/2026-09-19_database-truth.md  — open 0 / done 0 · lifecycle UNKNOWN


## plans/2026-09-21_mstar-order-and-summary-restore.md  — open 6 / done 18 · lifecycle ACTIVE

- **L15** [Статус пунктов (машиночитаемо — AGENTS.md § Plan Maintenance «JOB FAILED»)] · TASK-11 · manifest MISSING — `mStarRow` в манифесте: строка памяти переживает undo (попытка откачена; первый шаг — прочитать T-real целиком и назвать публикатора удаления). Имя выбрано владельцем 2026-09-22 вместо `summaryRow`
    L16: — still open 2026-10-09 (t27): the attempt stays rolled back; the §9.3 binding stands (read T-real fully, name the remover, then the fold-authored marker; `unrevert` untouched).
- **L17** [Статус пунктов (машиночитаемо — AGENTS.md § Plan Maintenance «JOB FAILED»)] · TASK-12 · manifest MISSING — **Карта «план ↔ SVM ↔ носитель» в памяти, обновляемая на КАЖДОЙ свёртке** — это ровно то, что несла сгенерированная сводка и что теперь не производит никто (владелец 2026-09-22: «Раз мы убрали summary
    L18: — superseded in FORM 2026-10-09 (t27): the memory map was replaced by plan-header labels (`parsePlanMap` removed 2026-10-01, `memory/spine.ts:164-167`); reword the oracle to the new carrier before working it.
- **L25** [Статус пунктов (машиночитаемо — AGENTS.md § Plan Maintenance «JOB FAILED»)] · TASK-15 · manifest MISSING — Инвалидация боковых сводок, попавших в откатанный диапазон
    L26: — still open 2026-10-09 (t27): no invalidation path exists in `revert.ts`.
- **L27** [Статус пунктов (машиночитаемо — AGENTS.md § Plan Maintenance «JOB FAILED»)] · TASK-16 · manifest MISSING — Снимок `memory/reasoning.md` и `planState` при фолде, чтобы откат мог их вернуть
    L28: — still open 2026-10-09 (t27): the fold only READS memory (`compaction.ts:2910`); no snapshot is taken.
- **L30** [Статус пунктов (машиночитаемо — AGENTS.md § Plan Maintenance «JOB FAILED»)] · TASK-18 · manifest MISSING — Приёмка отката: репетиция «фолд → undo через границу → окно `m*` + хвост, `unrevert` возвращает кадр» — **binding §9.3 выполнен на две трети:** (1) T-real прочитан целиком (`revert-crossing.test.ts:24
    L31: — still open 2026-10-09 (t27): 2/3 stands; the rehearsal now also sits under the tree's redo red (`revert-compact.test.ts:658`, recorded in `2026-09-21_close-open-residuals.md`).
- **L32** [Статус пунктов (машиночитаемо — AGENTS.md § Plan Maintenance «JOB FAILED»)] · TASK-19 · manifest MISSING — Гигиена планов §8: рекурсивный скан, завершение по явному `Status` со ссылкой на оракул, ключ цели («ревизия, не сосед»), перенос на шаге G9 обычной сессии. ЧАСТЬ СДЕЛАНА 2026-09-22 (`2a4c355c0d` — ин
    L33: — still open 2026-10-09 (t27): only the recursive-scan half; the lifecycle-reader half landed (`caf66e1e19`).

## plans/2026-09-22_reasoning-stream-render-stability.md  — open 10 / done 12 · lifecycle UNKNOWN

- **L165** [2. Tasks] · T4 · manifest MISSING — **T4 — pixel oracle for exactly this flow (the missing instrument).** **SUPERSEDED (2026-09-24), not done:**
    L166: its live-burst method was dropped on the owner's own finding below («ты не сможешь поймать этот дефект так»);
    L167: the flicker oracle is now the isolated replay (T11a) plus the live render trace (T13a). Its acceptance lines and
    L168: falsifier were never rewritten, so this box stays open until T13a's live trace closes the question. `cmd_runner start --
    L169: dist\bin\opencode.exe` + a prompt forcing a long reasoning stream; capture frames at fixed intervals
    L170: (`cua get_window_state` with `screenshot_out_file`); a reader script asserts: stable lines above the
    L171: live tail are byte-identical between frames; no frame where the visible reasoning is empty/plain; the
    L172: viewport offset changes only when a line is actually appended.
    L173: Falsifier: revert T1/T2 and the same capture must FAIL (frames must differ where the assertion says
    L174: stable) — an oracle that cannot fail proves nothing.
    L175: **LIVE CAPTURE TAKEN 2026-09-23 — the missing instrument now has its first frames.** Until today no
    L176: frame of a live reasoning stream had ever been captured. Two are: `.opencode/data/frame-stream-1.png`
    L177: and `frame-stream-2.png` (kept on disk in `experiments_history/2026-09-23_flicker-pixel-frames/` and
    L178: deliberately NOT tracked: `.gitignore:112` ignores `experiments_history/**/*.png` by design, so the
    L179: frames survive the session but not a clone — re-capture with the recipe below if they are gone), from `dist\bin\opencode.exe` (**10.0.1091**, newer than T1/T2 and therefore
- **L377** [2. Tasks] · T5 · manifest MISSING — **T5 — ScrollBox (P3), only if T1–T3 leave a residual.** STILL LIVE (2026-09-24): T9 MEASURED the residual —
    L378: an appended line costs 2 frames against 1 for an in-place change, the extra one being `ScrollBox.ts:802`'s
    L379: `nextTick(requestRender)`, still in the code. Coalesce `recalculateBarProps()` to one
    L380: call per frame; apply sticky-bottom once after a completed layout transaction; no per-size
    L381: `process.nextTick(requestRender)`.
- **L402** [2. Tasks] · T7 · manifest MISSING — **T7 — SUPERSEDED by T13b (2026-09-24), not done.** Owner: «А top level вообще нах»; closed runs (T11b step 2)
    L403: give finished blocks their stability without `top-level`, and the formatting complaint this task carried is now
    L404: T13b's (prose styled by marked only). The box stays open as a record, never to be ticked on its own wording.
    L405: Original title: **prose is rendered through the engine's `coalesced` mode; inline structure is destroyed before it
    L406: can be drawn (P0).** Owner, 2026-09-23: «текст уже не дергается, но цвета мерцают, форматирование не
    L407: применяется, markdown рендерится убого» — this task is the «форматирование / markdown» half; T8 is the
    L408: colour half.
    L409: MEASURED ✓ 2026-09-23: upstream `@opencode-ai/tui` renders session text with
    L410: `internalBlockMode="top-level"` + `tableOptions={{ style: "grid" }}`
    L411: (`external/opencode-1.18.29/packages/tui/src/routes/session/index.tsx:1692-1701`), while our `RichText`
    L412: passes no `internalBlockMode` (`routes/session/index.tsx:2200-2207`) and inherits the engine default
    L413: `coalesced` (`packages/opentui/packages/core/src/renderables/Markdown.ts:357`). `docs/rendering.md` §5c
    L414: names the cost: inline tokens (`strong`, `em`, `codespan`, `link`) are destroyed, lists lose their
    L415: hierarchy, headings lose depth — and §5h records that tree-sitter's markdown query highlights only
    L416: STRUCTURAL nodes and never inline formatting, so the destroyed inline structure has no second source.
- **L451** [2. Tasks] · T8 · manifest MISSING — **T8 — colour must have ONE source per frame; the quiet window must not flip the palette (P1).**
    L452: Same owner report; T6 already removed one half of the class — the preview no longer repaints the buffer
    L453: from the UNSTYLED path, it reads `_lastHighlights` (`Code.ts:152-182`, oracle `Code.test.ts` 70 pass /
    L454: 0 fail, run `20260923T011732Z_e268923b`; owner-validated on a live yaml fence). The OTHER half is
    L455: unmeasured: while `streaming` is true the visible style can come from two sources in alternation — the
    L456: marked-derived preview and the last tree-sitter snapshot — with the global quiet window deciding the
    L457: winner (`QUIET_HIGHLIGHT_MS = 75`, `Code.ts:56`, wired for ALL prose at `Markdown.ts:814, 1134`). Under
    L458: a 25–50 delta/s stream the window rarely fires during the burst (no parse while the stream is hot), one
    L459: parse lands on the first pause, and the next delta repaints from the other source — the alternation the
    L460: eye reads as «цвета мерцают».
    L461: STATUS 2026-09-23: (c) DONE BY MEASUREMENT — the global window was the ROOT CAUSE of five red
    L462: streaming pins: `Markdown.ts` hardcoded `quietHighlightMs: QUIET_HIGHLIGHT_MS` in BOTH constructors
    L463: (prose + fenced code), so every markdown parse was deferred past what the streaming pins observe
    L464: (`182 pass / 5 fail`, run `20260923T051143Z_d0c72565` — the exact five named in T7's STATUS below).
    L465: The window is now a PER-CALL option (`MarkdownOptions.quietHighlightMs`, default 0 — the engine is
- **L616** [2026-09-23 — pipeline audit below the content layer (owner: «глянь пайплайн отрисовки и как он влияет на общую скорость»)] · T10b · manifest MISSING — **T10b — reuse the native handle across a remount — ONLY if the encode is shown to cost.** One
    L617: `NativeImage` per stored frame (a `WeakMap<frame, NativeImage>` with a `FinalizationRegistry` disposing the
    L618: native side when the frame is collected), handed over as `source` instead of `setImage`. Gate: T9's
    L619: residual (1) — the CPU cost of a sixel encode — must be measured first; one encode per remount is not worth
    L620: a disposal protocol until a number says so (DISAS).
- **L811** [2026-09-23 — pipeline audit below the content layer (owner: «глянь пайплайн отрисовки и как он влияет на общую скорость»)] · TASK-18 · manifest MISSING — **T13 — prose is styled by marked ONLY; tree-sitter only for fenced code (owner, 2026-09-24: «Блин, ну
    L812: вот почему нельзя сделать буфер, это раз ts применять только к кодовым блокам», «А top level вообще нах»).**
    L813: The owner still sees flicker live after T11/T11b. Grounded against the originals: upstream opencode 1.18.29
    L814: renders text parts with `<markdown internalBlockMode="top-level">`
    L815: (`external/opencode-1.18.29/packages/tui/src/routes/session/index.tsx:1692-1701`) and reasoning with
    L816: `<code filetype="markdown" drawUnstyledText={false}>` (`:1635-1643`); inside the engine every prose block is
    L817: a `CodeRenderable` with `filetype: "markdown"` (`external/opentui-0.5.11/…/Markdown.ts:796-807`) — i.e.
    L818: tree-sitter on ALL prose, a second, asynchronous style source over marked's, with a conceal that changes
    L819: line widths when the parse lands. The original has the same disease; T6/T11 patched it, this removes it.
    L820: `top-level` is not needed: closed runs (T11b step 2) already give finished blocks stability without one
    L821: renderable and one parse per paragraph.
    L822: Change: (1) `CodeRenderable` gets `highlight: false` — the caller's styled text is the ONLY paint, no parse is
    L823: ever started; (2) every prose renderable Markdown builds (runs, headings, list children, quote content,
    L824: fallback, top-level blocks) is styled synchronously by marked through ONE styler, with the block prefixes
    L825: tree-sitter used to colour — list markers (`markup.list`), quote bars (`markup.quote`), headings
- **L838** [2026-09-23 — pipeline audit below the content layer (owner: «глянь пайплайн отрисовки и как он влияет на общую скорость»)] · T13a · manifest MISSING — **T13a — the seam.** Every paint of a text block goes through ONE function that keeps, per block, the
    L839: content hash, the style signature and the SOURCE of the last paint; under an env flag it writes a trace
    L840: and flags a flicker itself (style changed while the text did not, or returned to an earlier style). Off,
    L841: it costs one boolean check. Oracle: a unit test that drives a known alternation and must see it flagged,
    L842: and a control that must not. Then a `dist` build; the owner runs with the flag; the trace names the
    L843: block, the moment and the source.
    L844: **BUILT 2026-09-24; the box waits for the live trace.** `core/src/lib/render-trace.ts` +
    L845: `CodeRenderable.paint(source, text)` — all 12 buffer writes of `Code.ts` go through it (control-checked: 12
    L846: `paint(` calls, the only direct writes left are the two inside `paint`). Enabled by `OTUI_RENDER_TRACE=<path>`
    L847: (JSONL, buffered 250 ms) or an in-memory sink.
    L848: THE OWNER ASKED WHETHER THE ORACLE IS RIGHT («Ты бы вообще проверил что оракул написан правильно и учитывает
    L849: все тонкости рендеринга»). The first version was NOT: it judged per WRITE and per BLOCK. Corrected, each
    L850: subtlety with its own control in `__tests__/render-trace.test.ts` (5 pass):
    L851: (1) PER LINE, not per block — a streaming block changes its text on every delta, so «same text, other
    L852: style» only exists per line; the POSITIVE control reproduces the T11 bug (a stable line flipping
- **L886** [2026-09-23 — pipeline audit below the content layer (owner: «глянь пайплайн отрисовки и как он влияет на общую скорость»)] · T13b · manifest MISSING — **T13b — the cure above**, sized by what the trace shows, and confirmed by the same seam reading
    L887: zero flickers live.
    L888: 
- **L889** [2026-09-23 — pipeline audit below the content layer (owner: «глянь пайплайн отрисовки и как он влияет на общую скорость»)] · TASK-21 · manifest MISSING — **T14 — the memory-run collapse control is recreated on every delta (small, real, found by the 2026-09-23
    L890: audit).** `routes/session/index.tsx:359` writes the control into the OLD `collapseControlCache`, and `:364` then
    L891: replaces the cache with the empty `nextControls` — the cache never holds, so the `[-]` row of an expanded memory
    L892: run remounts per delta. Fix: write into `nextControls`. Oracle first: the route is mounted by no test, so extract
    L893: `displayItems`' construction into a pure function and pin the control object's identity across two calls.
    L894: 
- **L895** [2026-09-23 — pipeline audit below the content layer (owner: «глянь пайплайн отрисовки и как он влияет на общую скорость»)] · T12 · manifest MISSING — **T12 — move pixels with the terminal, not with a repaint (Hypothetical).** Probe on Windows Terminal:
    L896: does a DECSTBM region + scroll-up (`CSI n S`) carry an on-screen sixel with it? The fork already drives a
    L897: bounded scroll region (`renderer.zig:1726`, split-footer). If yes: a sticky-bottom append becomes a
    L898: terminal scroll plus the new rows, and case (B) drops to ~0 image bytes. If no: the fallback is to show a
    L899: placeholder, not pixels, for a clipped image while the view is moving. Oracle: T9's bytes per frame.
    L900: 
    L901: ## 3. Smoke Tests (PRE_FLIGHT — before any edit)
    L902: 
    L903: Baseline [Exact], from `packages/opencode`:
    L904: 
    L905: 1. `bun test test/tui/` — record pass/fail counts (2026-09-22: **158 pass / 0 fail**, run
    L906: `20260922T124815Z_724fe65e`). DRIFT, unexplained: the same set re-measured later that day gives
    L907: **140 pass / 0 fail** (738 expect, run `20260922T140344Z_d25a6938`) — do not treat 158 as current
    L908: until the difference is named; it is a finding, not a baseline.
    L909: 2. `bun typecheck` — exit 0 (2026-09-22: exit 0).

## plans/2026-09-24_to-be-confirmed-shelf-triage.md  — open 3 / done 1 · lifecycle ACTIVE

- **L51** [Tasks] · T2 · manifest MISSING — **T2 — close the TUI gateway-row plan (BLOCKED on instrument, 2026-09-24).** Isolated candidate ran (version 10.0.1117, `dist/bin/opencode.exe`, cwd `experiments/2026-09-24_tui-protocol-smoke/wc/`, co
- **L52** [Tasks] · T3 · manifest MISSING — **T3 — re-verify and route the remaining 14.** One file at a time: re-run its acceptance criteria against current code, drop stale items, name the remaining criterion. Deliverable per file: verdict + 
- **L53** [Tasks] · T4 · manifest MISSING — **T4 — settle the shelf readme and the top level.** Update `readme.md` to the final disposition; run `planstatus`; confirm top-level consistency (no misplaced; debt = only the plans lawfully returned 
    L54: 
    L55: Envelope: T1/T3 — read-only checks (sessions, code, `git log`) plus `MODIFY_PROJECT` limited to plan files and `git mv` between plan shelves; T2 additionally drives that plan's own candidate oracle; T4 plan-file edits only.
    L56: Prohibitions: no product-code edits (a defect found during verification becomes its own bounded item, not a fix inside this plan); no `bin/` access; no history rewrite; no kernel/system-prompt work.
    L57: Rollback: `git mv` back; plan-file edits by `git checkout`.
    L58: Bounds: per-file verdict ≤ 2 verification attempts; after that record `Unknown` with its falsifier and move on.
    L59: 
    L60: ## Smoke Tests
    L61: 
    L62: - **BEFORE:** `planstatus` recorded — 167/168 plans, 445/602 tasks (99%), misplaced: none, debt 3 open boxes (all in `2026-09-24_pre-fix-artifact-verification.md`); shelf invisible. ✓ Recorded this session, 2026-09-24.
    L63: - **AFTER:** each of the 19 shelf files has a proven terminal; `readme.md` matches the tree; `planstatus` consistent; no moved file without its named ground.
    L64: 
    L65: ## Claims
    L66: 
    L67: | claim | falsifier | rung |

## plans/2026-09-28_kernel-candidate-incorporation.md  — open 3 / done 47 · lifecycle ACTIVE

- **L228** [F8 — follow-up to the 39e04ddbe7 install (owner-directed, 2026-09-29)] · TASK-44 · manifest MISSING — NOT RUN this cycle, stays open under F5: the TS parity suite (`kernel-identity-tools`, `registry`,
    L229: `kernel-alignment`) and `bun typecheck` — the product tool rows did not change, but «did not change» is
    L230: a claim, not a run.
    L231: RUN 2026-10-08 at d27eeca940 (cmd_runner, `packages/opencode`, one file per run): `kernel-identity-tools.test.ts`
    L232: no longer exists — deleted as superseded in `86e4a5c564`, its successor is `test/agent/kernel-identity-manifest.test.ts`
    L233: (`1a437f6def`). Results: `registry.test.ts` 11 pass / 0 fail (run `20261007T170448Z_50a5a012`);
    L234: `kernel-alignment.test.ts` 5 pass / 0 fail (`20261007T170505Z_ca57329f`); `kernel-identity-manifest.test.ts`
    L235: **RED 0 pass / 1 fail** (`20261007T170424Z_60b4484f`): «every native identity's live tool sets equal
    L236: prompt_kernel/identity_tools.json» — the live allowed set holds `samply`, the manifest does not. Origin (Inferred
    L237: from history, no before/after run): the `samply` tool landed in `d582038233` (2026-10-06) without re-running
    L238: `script/kernel-tools-manifest.ts`; `identity_tools.json` last moved in `1a437f6def`. `bun typecheck` → exit 0, no
    L239: diagnostics (`20261007T170314Z_718c4158`). Box stays OPEN until the manifest suite is green; not fixed here.
    L240: 2026-10-08 FINDINGS (fresh runs at `b65757638e` — the cherry-pick of `3df5a222e4` onto Local_Development;
    L241: it touches only this plan and `_progress_log.md`, so the run code equals `2c0835cf30`):
    L242: - `python -m pytest prompt_kernel/tests/ -q` → **145 passed, 0 skipped** (`20261008T002202Z_c95b83a1`, exit 0).
- **L290** [F5 — Release] · TASK-57 · manifest MISSING — Final pytest + parity suite + typecheck; render vs caps; **diff to the owner**; `--install` + repin; claude/codex receivers refreshed (no identity rows).
    L291: 2026-10-08: pytest 144 passed / 1 skipped, typecheck clean, parity RED on `kernel-identity-manifest` (`samply`) — see F8; open.
    L292: 2026-10-08 fresh at `b65757638e`: pytest 145/0 (`20261008T002202Z_c95b83a1`); parity trio in F8 — registry
    L293: 11/0, kernel-alignment 5/0, manifest **RED** (`samply`); `bun typecheck` exit 0 (`20261008T002838Z_7951fe73`).
    L294: Not closable here: `--install` is the owner's act and the manifest red needs the F8 fix (kernel row).
- **L297** [F5 — Release] · TASK-59 · manifest MISSING — Commits naming this plan; move to `plans_completed/` when boxes close; scan for stale refs.
    L298: 2026-10-08: `b65757638e` (triage, cherry-picked) + the same day's findings commit name the plan; the move
    L299: waits for F8's lift path and F5's install box.
    L300: 
    L301: ## Smoke Tests
    L302: - Per phase: `python -m pytest prompt_kernel/tests/ -q` (baseline 117) + render bytes/tokens; BEFORE rewording, grep the exact phrase in `prompt_kernel/tests/` — tests quoting rule text move in the same change.
    L303: - Release: `bun test test/agent/kernel-identity-manifest.test.ts test/tool/registry.test.ts test/tool/kernel-alignment.test.ts` + `bun typecheck` (cmd_runner, from `packages/opencode`); `PIN_OK`. (Path corrected 2026-10-08: `kernel-identity-tools.test.ts` was deleted as superseded in `86e4a5c564`, s
    L304: 
    L305: ## Acceptance frame
    L306: | # | Criterion | Surface | Instrument | Falsifier |
    L307: |---|-----------|---------|-----------|-----------|
    L308: | 1 | New edges/conditions render and validate | rendered §0 | kernel pytest | validator error / edge absent |
    L309: | 2 | Budgets present in §2 and envelope | rendered §1–§2 | kernel pytest + read | field absent |
    L310: | 3 | Formulas exact (digest / rights / reward) | rendered §2 | read + grep | mismatch |
    L311: | 4 | No host leakage into source.py | source vs add-ons | review | host path/command in source |

## plans/2026-09-29_codegraph-impact-decoupling.md  — open 1 / done 5 · lifecycle ACTIVE

- **L39** [Tasks] · C2 · manifest MISSING — **C2 — the sync keeps happening; the turn stops waiting for it.** It is NOT to be deleted (it is what makes the times fresh), NOT gated, NOT verified, and NOT made precise — it only has to run somewhe

## plans/2026-09-29_cua-windows-debug-input.md  — open 15 / done 13 · lifecycle UNKNOWN

- **L101** [Baseline before product-source edit] · B1 · manifest MISSING — **B1 page read path:** Drive `page get_text`/`query_dom` on an isolated source-built driver/WebView2 fixture in standard mode, verify target app text, and confirm `page execute_javascript` remains ref
- **L106** [Baseline before product-source edit] · S2 · manifest MISSING — **S2 four-state capture baseline:** Four-state capture baseline on the MAIN monitor (minimized / shown-no-activate / occluded) with WinUI3 Calculator, predicted: minimized → `window_minimized` refusal
- **L107** [Baseline before product-source edit] · S3 · manifest MISSING — **S3 hypervisor guard:** Host hypervisor baseline recorded: `HypervisorPresent=False` (✓ 2026-09-30), re-read after every host-level install. <!-- sv: hypervisor-guard, vmware-compat -->
    L108: 
    L109: ### Post-change oracles
    L110: 
- **L111** [Post-change oracles] · P1 · manifest MISSING — **P1 Rust drag tests green:** Focused Rust core and Windows adapter tests cover both endpoints, one-shot consumption, wrong session/window and changed frame; unaffected Linux/macOS builds or explicit 
- **L113** [Post-change oracles] · P2 · manifest MISSING — **P2 live GUI chain:** Source-built driver and disposable GUI confirm screenshot→capture-bound drag→fresh screenshot/state change, plus `get_text` without unrestricted; record command, endpoint, PID, 
- **L114** [Post-change oracles] · P3 · manifest MISSING — **P3 mode A game checks:** Game-specific relative pointer, hold and victory/defeat checks remain open until game URL, control scheme and signal are available. <!-- sv: mode-a, game-input, outcome-sign
    L115: 
    L116: ## Work
    L117: 
- **L119** [Work] · W1 · manifest MISSING — **W1 baseline error cases:** Establish the exact baseline/error cases including the 2026-09-12 Go control; keep `execute_javascript` policy refusal as a negative control, not a defect to erase. <!-- s
- **L121** [Work] · W2 · manifest MISSING — **W2 Rust input path (conditional):** THEN, only if the Windows fixture/game oracle demonstrates missing capability after restoring the old short workflow: implement the smallest safe Rust input path 
    L122: **Condition MET by W3 (run `20260930T024021Z`):** an unobserved drag is dispatched and a `capture_id` on drag is silently ignored. Design consequence, read in code after the run: the Windows WINDOW-scope drag never goes through the contract — only `scope:desktop` calls `parse_typed_projection::<Drag
- **L125** [Work] · W4 · manifest MISSING — **W4 game revisit:** Revisit the game criterion when its target and outcome signal exist. If unavailable, move only proven scoped work to completed and park the remaining criterion with an explicit re
    L126: 
    L127: ### Tier work (added 2026-09-30, order = cheapest first; one bounded task open at a time)
    L128: 
    L129: Owner prerequisites (host/system changes the agent does not perform): (O1) optionally install an IDD virtual display
    L130: driver and report its version; (O2) provide a VMware Windows guest with VMware Tools, OpenSSH Server and key auth on a
    L131: host-only network. Each lifts the tasks below that name it; none is a blocker for B-web.
    L132: 
- **L135** [Tier work (added 2026-09-30, order = cheapest first; one bounded task open at a time)] · T1b · manifest MISSING — **T1b B-web route for the agent:** decide the model-callable route for the proven tier — reuse the cua driver's own CDP binding (`BROWSER.md`) or a thin isolated-Chromium tool — ground both before cho
- **L139** [Tier work (added 2026-09-30, order = cheapest first; one bounded task open at a time)] · T3b · manifest MISSING — **T3b screen-region targets on the virtual monitor:** the windows whose PrintWindow comes back black and fall back to the screen-region BitBlt (`capture.rs:14-19,445-481`): JView's OpenGL view and a W
- **L142** [Tier work (added 2026-09-30, order = cheapest first; one bounded task open at a time)] · T9 · manifest MISSING — **T9 background modifiers (Alt):** owner, 2026-10-02: «он alt не удерживает … чистое использование апстрима отпадает». Read in code, not yet run: background `post_key` (`platform-windows/src/input/key
- **L145** [Tier work (added 2026-09-30, order = cheapest first; one bounded task open at a time)] · T5 · manifest MISSING — **T5 B-native-input transport (needs O2):** remote mode in `cua.ts` (MCP HTTP URL + token from env, never from Git), failing tool test first; qualify with `tools/list` over the SSH tunnel before any G
- **L146** [Tier work (added 2026-09-30, order = cheapest first; one bounded task open at a time)] · T6 · manifest MISSING — **T6 B-native-input oracle (needs O2):** capture-bound click then drag in the guest; guest-side state readback cross-checked against `vmrun captureScreen` (C6 decides whether that instrument exists). 
- **L147** [Tier work (added 2026-09-30, order = cheapest first; one bounded task open at a time)] · T7 · manifest MISSING — **T7 docs:** `docs/tools-and-sidecars.md` §7.1 gets the mode/tier table and the hypervisor exclusion once T1/T3/T5 each have a run id. <!-- sv: docs, tier-table -->
    L148: 
    L149: **VMware tier POSTPONED** (owner, 2026-10-01: «Вопросы с vmware пока отложим до лучших времен»): O2, T5, T6 are
    L150: parked — do not start guest setup or the remote transport until the owner lifts it. Open at parking: the owner
    L151: said JView's memory mapping «не проканает» in the VMware route; reason not yet stated (facts: named
    L152: `CreateFileMapping` in `CommonFiles/RSCommonPackage/RTRWMapUnit.pas:176,280`, `CommonFiles/RSPack.MapUnit.pas:173,277`).
    L153: The primary JView route stays tier B-native-bg on the virtual monitor (T3, waits on O1).
    L154: 
    L155: ### Resumption signals
    L156: 
    L157: - B-native-bg: the owner reports O1 done (driver name + version). 2026-10-02: bundle delivered to `external/virtual/`
    L158: (gitignored) — VirtualDrivers «Virtual Display Driver» `MttVDD` 11.30.4.434, UMDF 2.25 + IddCx 0102, hw-id
    L159: `Root\MttVDD`, `.cat`/`.dll` Authenticode Valid (SignPath Foundation) ✓ `Get-AuthenticodeSignature`; plus a virtual
    L160: AUDIO driver (kernel `.sys`, not needed — do not install), `devcon.exe`, and `VDD Control.exe` (171 MB GUI). NOT yet
    L161: installed: no IDD adapter among display devices, 2 screens ✓ `Get-PnpDevice`/`Screen.AllScreens`;

## plans/2026-09-29_h2-session-pool-and-connection-badge.md  — open 1 / done 6 · lifecycle ACTIVE
- manifest `T4`: state=waiting-on-user eta=2 oracle=Text oracles green (run ids in plan): bun test test/tui/sidebar-protocol.test.ts 10/0 20261009T043107Z_a8ecc687; bun test test/tui/agent-model-cell.test.ts 24/0

- **L26** [Tasks] · TASK-6 · manifest MISSING — **(a) agent glyph and (b) protocol glyph — text oracle GREEN, visual residual OPEN** (boxes stay unticked until the glyphs are SEEN: a render claim needs a rebuilt candidate — owner's step; `typecheck

## plans/2026-09-30_cua-supply-chain-audit.md  — open 2 / done 8 · lifecycle ACTIVE

- **L66** [Work] · SE · manifest MISSING — **SE reliability classes:** collect from `plans/2026-09-29_cua-windows-debug-input.md` W3 (unobserved drag dispatches; advertised input schema not enforced — `capture_id` silently ignored; result labe
- **L67** [Work] · SF · manifest MISSING — **SF Universal Search:** the same A–E for `D:\zPython\universal-search` (bundled Chromium with CDP on 127.0.0.1:9222 without auth, SearXNG, crw-server; built to pass bot walls — legal/ToS review for r
    L68: **Stage 1 done 2026-09-30 (read-only + observation; repo `master` `f439030`, v0.4.0, 67 uncommitted changes left untouched):**
    L69: - ✗ **CRITICAL — `chromium-debug` runs as `LocalSystem`, `AUTO_START`** (`sc qc chromium-debug`; the install script says `SERVICE_DEMAND_START` and sets no account, so NSSM's default LocalSystem applies — `dist/install_services.bat`). CDP on `127.0.0.1:9222` has no authentication, so any local proce
    L70: - ✓ run — every listener is loopback: `127.0.0.1:9222` (chrome, pid 6720), `:6379` (garnet), `:3008` (websurfx), `:3005` (service); service `default_bind()` = `127.0.0.1` (`src/config.rs:38-40`); SSRF guard refuses `0.0.0.0` / `::1` targets (`src/web/fetch.rs:137`). Chromium flags: `--remote-debuggi
    L71: - ✓ run — standing egress with no request from this session (runs `US_ctl_20260930T185737`, `US_idle_20260930T185744`; sampler requalified on a SYSTEM-owned control — the service's `/web/fetch` of example.com → `104.20.23.154:443` seen): **chrome → `2404:6800:4001:c01::bc:5228`** — port 5228 is Goog
    L72: - ✗ instrument, run `US_idle_20260930T185518` / `US_ctl_20260930T185705` VOID: `pwsh -File` passed the comma list of names as ONE string, the sampler watched nothing and reported 0; the control (fetch 200, 0 seen) exposed it; the sampler now splits commas itself (KAIZEN guard).
    L73: - ✓ code — external APIs in the service: Sourcegraph GraphQL (`src/config.rs:159`), OpenRouter `/api/v1/messages` for the `/agent` route (`src/service.rs:902-903`, key `None` by default → inert without a key); `bootstrap.rs` only prints download hints; `rclone.exe` ships in `tools/` but no tracked s
    L74: - ✓ code — provenance (`build_portable.ps1`): hash-pinned `crw-server` and `garnet` (`:104-147`); version-pinned without hash: Node, NSSM; **download-and-execute unpinned: `get-pip.py`**, Chocolatey's `install.ps1` (`dist/install_choco.bat:25`); git clones of SearXNG and websurfx; **bundled Chromium
    L75: - Remedy prepared, NOT applied (a service-account change is the owner's system change):
    L76: `experiments/2026-09-30_universal-search-hardening/harden_services.ps1` — dry run by default, `-Apply` (backup →
    L77: per-service `NT SERVICE\<name>` virtual accounts, RX on `dist\`, Modify only on each data/log folder → verify),
    L78: `-Rollback`, `-Verify`. Dry run and `-Verify` executed 2026-09-30: all six services `LocalSystem`, listeners
    L79: loopback, `/health` 200, `/web/browser` 200. Residual even after `-Apply`: CDP stays unauthenticated (rights drop
    L80: from SYSTEM to the virtual account); closing it needs `--remote-debugging-pipe` in Universal Search's code.
    L81: - Open for stage 2: SearXNG engine egress per query, Chromium's full idle set (safebrowsing, component updater) over a longer window, websurfx/garnet/crw behaviour, and the redistribution question (bot-wall bypass) — a legal decision, not a measurement.

## plans/2026-09-30_robot-installer.md  — open 18 / done 15 · lifecycle DRAFT

- **L180** [который работает со всем функционалом», «Поиск должен работать и работать правильно — иначе от установщика толку 0»)] · Q2b · manifest MISSING — **Q2b selector fixtures:** run each engine's extract JS against SAVED SERP pages (the `*_serp/*.html` of run
    L181: `20261002T115857Z_serp`) in the browser, so a markup change upstream fails a test, not a user's search. Split out
    L182: of Q2: not done yet. <!-- sv: selector-fixtures, saved-serp, regression -->
- **L212** [который работает со всем функционалом», «Поиск должен работать и работать правильно — иначе от установщика толку 0»)] · Q6 · manifest MISSING — **Q6 services:** chromium, searxng, universal-search, crw — user-level, loopback, never LocalSystem; start/stop
    L213: owned by the installer. <!-- sv: services, least-privilege, lifecycle -->
    L214: **Scope changed by the owner, 2026-10-07:** «давай не будем делать учетную запись пользователя — пусть будет как
    L215: есть». The services KEEP their current account (LocalSystem, NSSM). Accepted residual, recorded once with its
    L216: measurement (audit SF stage 1, `sc qc`, 2026-09-30): CDP on 127.0.0.1:9222 has no auth, so any LOCAL process can
    L217: drive a SYSTEM browser — loopback-only, not reachable from the network. `harden_services.ps1` stays unused unless
    L218: the owner asks. What remains of Q6: deploy the new builds into the existing services (universal-search with
    L219: `/search`, the crw fork with `browser_only`, SearXNG with `config/searxng/settings.yml`), start order with a SearXNG
    L220: warm-up query, and the installer owning start/stop.
    L221: **No external exposure** (owner, 2026-10-07: «Я и не хочу чтобы снаружи это было видно», «0.0.0.0:3000 это в корне
    L222: не верно — 127.0.0.1», «Никаких внешних экспозов»). Measured the same day: of the stack's listeners 3005, 3008,
    L223: 3434, 6379, 9222 were on 127.0.0.1 but **crw-server was on 0.0.0.0:3000** (crw's default host; no `[server]` in the
    L224: generated config) with a Private-profile firewall allow rule — a page-fetching proxy for the LAN. Fixed:
    L225: universal-search `8d61bdb` (`build_portable.ps1` + `patches/crw-server/config.toml` write `host = "127.0.0.1"`),
    L226: live `dist/config.toml` patched (backup `config.toml.bak-20261007`), service restarted ✓ `Get-NetTCPConnection`:
- **L235** [который работает со всем функционалом», «Поиск должен работать и работать правильно — иначе от установщика толку 0»)] · C1 · manifest MISSING — **C1 model choice is explicit in the configurator** (owner, 2026-10-06: «в настройках нашего конфигуратора
    L236: должен быть четкий выбор модели или ее отсутствие»). Every component that calls a model (Smit, universal-search
    L237: `/agent`, …) shows the user ONE explicit setting: a chosen model, or «no model» — never a default silently filled in.
    L238: Gap measured the same day: universal-search `agent.model` is a `String` whose serde default is
    L239: `nvidia/nemotron-3-ultra-550b-a55b:free` (`src/config.rs:295`) and `agent.enabled` defaults to `true` (`:331`), so a
    L240: missing model silently becomes Nemotron and «none» cannot be expressed. Change: `model: Option<String>`, `None` =
    L241: the agent is off and `/agent` answers with a named refusal; the configurator lists the free models (B4) plus «no
    L242: model» and writes exactly the user's pick; `smit doctor` prints the choice, never a blank (absence of an oracle
    L243: reads as false). Test first: a config without a model must NOT produce a model. <!-- sv: model-choice, explicit-none, configurator -->
    L244: **Revised 2026-10-07 (owner: «Предвыбери рекомендованную модель только тестани — ключей для openrouter или nvidia у
    L245: клиента нету, я вот думаю просто бесплатную opencode версию использовать по умолчанию, нужна форма для того чтобы
    L246: добавить ключи. Но чтобы работало и без них»; «Тест сделай обязательно обрубив все известные ключи из энва, opencode
    L247: их цепляет автоматом»).** Still explicit and still with «no model», but the robot's field arrives PRESELECTED with a
    L248: model measured to answer with no key at all. Mechanism read: keyless, the `opencode` provider keeps only cost-0
    L249: models and sends `apiKey: "public"` (`packages/opencode/src/provider/provider.ts:174-195`). Measurement
- **L270** [который работает со всем функционалом», «Поиск должен работать и работать правильно — иначе от установщика толку 0»)] · P1 · manifest MISSING — **P1 install target: path + portable (flash drive)** (owner, 2026-10-07: «выбора пути нету, и надо бы сделать
    L271: portable установку на флешку»). Two modes: *this computer* (chosen folder, services on 127.0.0.1, virtual-monitor
    L272: driver, Start-menu shortcuts, uninstall manifest) and *portable* (everything — robot, tools, data, logs — in one
    L273: folder on the drive; no Windows services, nothing in the registry; search/browser started by a «Запустить Smit»
    L274: launcher on the drive; the virtual-monitor driver is per computer, never on the drive; Advanced options disabled).
    L275: Path chosen by folder dialog or from the detected flash drives; ASCII path; exFAT/NTFS recommended (FAT32 warns).
    L276: **Measured finding:** the pCloud virtual drive (P:) reports `DRIVE_REMOVABLE` — a flash drive is recognised by its
    L277: storage bus (`IOCTL_STORAGE_QUERY_PROPERTY` → USB/SD/MMC); a cloud/virtual «removable» drive is shown as NOT a
    L278: target and refused by the system check (the robot's data would silently sync to the cloud). Prototype implements
    L279: it: `experiments/2026-10-07_installer-fyne/app/main.go`. <!-- sv: portable-install, install-path, flash-detection -->
- **L513** [Smoke Tests] · I1 · manifest MISSING — **I1 pristine baseline:** on a clean VMware Windows snapshot, record what is missing BEFORE any install (WebView2, VC++, Git, VT, paths). <!-- sv: pristine-vm, baseline, preflight -->
    L514: 
    L515: ## Work
    L516: 
- **L517** [Work] · B1 · manifest MISSING — **B1 builder:** one reproducible build script that assembles the bundle from pinned sources into `dist/installer/` (never `bin/`), with a hash manifest. <!-- sv: builder, reproducible, hash-manifest -
    L518: **Owner decision 2026-10-07 — zero credentials, installer-defined models only:** «все ключи убираем, модели только
    L519: заданные инсталлятором. Это универсальный пакет, клиенты сами пусть ставят чего хотят.» The bundle carries NO key,
    L520: token or auth file of ours; the robot's model/provider config is WRITTEN by the installer from the user's pick (C1:
    L521: a listed model or «Без модели»), never copied; a client adds their own providers and keys after install. Measured
    L522: why copying is wrong: Smit2's `smit/smit.jsonc` + `opencode.jsonc` pin `smit1/kat-coder-pro-v2.5` (×10) over two
    L523: private gateway providers (`gateway.jsonc`, 3 provider blocks), `auth.json` holds 2 key fields ✓ grep counts (values
    L524: not read).
    L525: **REUSE correction 2026-10-07 (owner: «пункт кернела про reuse помнишь, граундинг?»).** G1 «search existing code …
    L526: before non-trivial invention» and «an existing procedure is reused, never re-invented» were skipped: B1 was started
    L527: as a new Go builder without asking whether a builder exists. It does: **`universal-search/build_portable.ps1`
    L528: (1 688 lines) is the builder that produced Smit2** — steps ✓ read by their headers: [1] build the main binary, [4]
    L529: download crw-server (upstream, SHA-pinned — must become OUR fork), [5] Garnet, [6] NSSM, [7] portable Python 3.12,
    L530: [8] Node 22, [8b] Chromium (Chrome for Testing), [8c] Playwright driver (where B1d belongs), [9] SearXNG into the
    L531: portable Python, [10] websurfx, then it GENERATES `config.jsonc`, `start_all.bat` (:674), `stop_all.bat` (:884),
- **L564** [Work] · B1c · manifest MISSING — **B1c components**: a pinned list (component, source = its own builder's output, include/exclude, license);
    L565: robot ONE binary (not smit.exe + opencode.exe), ONE node, search = chromium + searxng + universal-search + crw fork
    L566: (no garnet/websurfx), robot config = a template with no model/provider; never `bin/`, never Smit2.
    L567: **Tool layout = `bin/` (owner, 2026-10-07: «гит и стандартные тулы … мы их в bin сложили — сам робот проверяет
    L568: при старте что есть в bin и использует; что в bin — напрямую, экзешники которые нет — через cmd_runner»).** Read
    L569: the same day, not run: the "known" set is a STATIC list in code — `KNOWN_BIN_TOOLS`
    L570: (`packages/opencode/src/tool/shell-constitution.ts:228`, samply already in it) + `SYSTEM_KNOWN_TOOLS` git/python/
    L571: node/pwsh/cmd (`:237`); no start-up scan of `bin/` was found (grep for a bin readdir — Inferred, not proven absent).
    L572: `bin/` here holds the msys tools (awk, cat, find, grep, head, ls, sed, sort, tail, wc + `msys-2.0.dll`), sqlite,
    L573: ffmpeg, `tools/` (adm, cmd_runner, fd, fossil, rg, rclone, samply, …), `cua/`, `codegraph/` — **git is NOT in
    L574: `bin/`**: it is a system tool, taken from PATH. So the bundle must give the robot a git without clobbering a
    L575: user's own Git — decision pending (owner: «с гитом очень аккуратно»).
    L576: **DECIDED 2026-10-07** (owner: «Юзаем портативный»; «Opencode.exe, бери для сборки то что лежит тут в bin»):
    L577: git = ALWAYS the bundle's portable Git, first on the robot's own PATH (set by the shortcut / portable launcher —
    L578: never the system PATH, never a user's Git). Measured: Smit2's `git/` is an INSTALLED Git 2.54.0, not a portable
- **L657** [Work] · B1d · manifest MISSING — **B1d playwright-rs driver 404 countermeasure** in the search build (provision `playwright-core` into the
    L658: build-script OUT_DIR, reset its fingerprint) — second occurrence, KAIZEN.
- **L679** [Work] · B1f · manifest MISSING — **B1f organization component** (scope 2026-10-08): `scripts/org-genesis/**` staged as component `org`; the
    L680: first start runs `init.py` with ORG_HOME = `<install>\org` (needs ORG_HOME promoted from «test fixtures only» to
    L681: a supported setting — legislator's lane, accepted 2026-10-08 as robot task t14-org-portable-home after
    L682: t13: ORG_HOME/ORG_PORT supported via one shared resolver, server 127.0.0.1 at any port, fossil order
    L683: $FOSSIL → beside the scripts → PATH with the chosen binary printed; the installer still sets FOSSIL), fossil resolved from the bundle, an EMPTY
    L684: org.fossil born on the target (the owner's tickets/chat never ship — gate rule: no `*.fossil` in the bundle
    L685: except an explicit allow). Oracle: on a scratch dir, staged tree → init.py → `org.py inbox` answers and the
    L686: server listens on 127.0.0.1 only. <!-- sv: org-layer, portable-org-home, empty-repo -->
- **L770** [Work] · B2 · manifest MISSING — **B2 installer shell:** Go + Fyne 2.8.1 app (decided 2026-10-07, see above; no WebView2 needed, so no pre-stage), grown from `experiments/2026-10-07_installer-fyne/app`; its `model_form_test.go` runs 
    L771: <!-- B1g env: the installer shell sets CMD_RUNNER_LOG_ROOT (run store outside the manifest-verified tree), ORG_WORKER_DATA (org_worker.py data dir) and FOSSIL (fossil binary for the org repo) on the target. -->
- **L772** [Work] · B3 · manifest MISSING — **B3 preflight + fix:** each candidate above as check → fix/remedy, shown to the user before apply. <!-- sv: preflight, fixes, opt-in -->
- **L773** [Work] · V1 · manifest MISSING — **V1 virtual-display selection:** read each candidate's signature, driver model, license and install method; pick one with evidence; its egress goes through the audit plan. <!-- sv: virtual-monitor, d
- **L774** [Work] · V2 · manifest MISSING — **V2 virtual-display install/uninstall:** silent offline install + uninstall by recorded hardware ID; `HypervisorPresent` read before and after; resolution set for the robot's display. <!-- sv: virtua
- **L775** [Work] · V3 · manifest MISSING — **V3 robot on its own display:** the installed robot places its GUI targets on the virtual display (T3/T4 of the cua plan) and the A6 oracle passes. <!-- sv: virtual-monitor, robot-display, t3-oracle 
- **L776** [Work] · U1 · manifest MISSING — **U1 Universal Search fit for colleagues:** not shippable as is — it fails both duties (memory `user-two-ethics-user-and-services`): to the user, services as LocalSystem with an unauthenticated CDP po
- **L828** [Work] · B5 · manifest MISSING — **B5 hello smoke:** final step starts the robot, sends «привет», shows the answer or a classified failure. <!-- sv: hello-smoke, failure-classes, final-check -->
- **L829** [Work] · B7 · manifest MISSING — **B7 subscription agents join the organization** (owner requirement 2026-10-08, relayed by the ADID_Python
    L830: lane: anyone with a Claude or ChatGPT/Codex subscription gets an agent that joins the org out of the box; the
    L831: corporate model is to be cloneable as a standard). Split: the ADID lane ships `org_worker.py` (polls org.fossil
    L832: read-only, claims, runs `codex exec -p org …` / `claude -p` with an allowlist, heartbeats, escalates on a silent
    L833: exit; no `--dangerously-bypass-*`), `CODEX_ORG.md` + an `org` skill, and a separate Codex profile
    L834: `$CODEX_HOME/org.config.toml` (config.toml never edited). This lane: (a) opt-in UI tick per host, shown only when
    L835: `codex login status` / `claude auth status` says logged in, registering a PER-USER Task Scheduler entry
    L836: `org_worker.py --agent codex|claude --every 10m` (per-user, not an nssm LocalSystem service: the CLI login lives
    L837: in the user profile); identity and wake decided by the legislator 2026-10-08: logins `claude-worker` /
    L838: `codex-worker` (plain `claude`/`codex` are the interactive agents — the hourly orchestrator reads `claude`), one
    L839: per subscription per org, and POLLING (`org.py inbox --user <login>` ~10 min) is the wake contract — orgd wakes
    L840: only opencode residents; `init.py` creates both `-worker` logins idempotently (legislator's t14, smoke: init.py
    L841: twice on a scratch ORG_HOME → each login exactly once), the installer only registers the scheduler for ticked +
    L842: logged-in hosts — a login without a worker is inert; worker data contract (ADID lane, 2026-10-08): env
    L843: `ORG_WORKER_DATA`, default `<ORG_HOME>/workers/<agent>/` with `last_tick.json` (atomic; `result` idle | busy |
- **L895** [Work] · B6 · manifest MISSING — **B6 pristine-VM acceptance:** A0–A5 on a reverted snapshot, network disconnected for install. <!-- sv: acceptance, pristine-vm, offline -->
    L896: 

## plans/2026-10-01_tool-description-contracts.md  — open 5 / done 4 · lifecycle UNKNOWN
- manifest `C2`: state=doing eta=1 oracle=The ONLY thing left for C2 is ONE mutation check, and it is owed because a pin that has never been seen to fail is not yet a proof:

`compare.test.ts` must go R

- **L67** [Tasks] · C2 · manifest doing/eta1 · oracle The ONLY thing left for C2 is ONE mutation check, and it is owed because a pin that has never been seen to fai — **C2 — file tools:** `read`, `write`, `edit`, `multiedit`, `ls`/`list`, `restore`, `treediff`, `compare`.
    L68: **Перегрунтован на код 2026-10-01** — и это окупилось дважды:
    L69: - **БАЗА БЫЛА КРАСНОЙ, и красное — наше.** `test/tool/edit-exact.test.ts` падал тремя случаями с
    L70: `Missing key at ["files"]` (`20261001T052355Z_7c3c83cb`): схема уехала на пакет (H6), а этот файл
    L71: остался на старой форме ✓ Первым делом СТАБИЛИЗИРОВАНО, как велит контракт: перенацелено на
    L72: `files: [{ filePath, edits? }]`, те же три стороны, провенанс — в самом файле ✓ → **26 pass / 0 fail
    L73: / 34 expect**, exit 0 (`20261001T052620Z_7a54b258`).
    L74: - **МЁРТВЫЙ СЛОЙ назван боксом, а не починен здесь:** три блока того же файла держат `replace`,
    L75: `replaceRange`, `replaceWithStage` и десять ступеней `Replacer` — замерено: **в `src/` ни одного
    L76: вызова**, единственный потребитель — этот тест ✓ Удаление — бокс **H8** плана
    L77: `plans_completed/2026-10-01_hash-addressed-edits.md`, и оно обязано быть ОДНОЙ правкой (тесты и код вместе ✓): снять
    L78: сначала тесты — оставить мёртвый код вообще без наблюдателя ✗ **H8 DONE 2026-10-01:** код и три блока
    L79: сняты вместе (`edit.ts` −683, `edit-exact.test.ts` −118), 151 / 0.
    L80: - **`compare` — ДВА ложных обещания** (замерено чтением `compare.ts`): (а) `Parameters.ignore`
    L81: («Additional glob patterns to ignore») **не читается `execute` ни разу** — параметр требуют и
- **L178** [Tasks] · C3 · manifest MISSING — **C3 — shell tools:** `bash`, `cmd`, `powershell`, `run`.
- **L179** [Tasks] · C4 · manifest MISSING — **C4 — search / memory tools:** `codegraph`, `dbread`, `fossilgrep`, `logsearch`, `sessionread`,
    L180: `summaryedit`, `universalsearch`, `webfetch`.
- **L181** [Tasks] · C5 · manifest MISSING — **C5 — control / agent tools:** `task`, `skill`, `todowrite`, `question`, `plan-enter`, `planexit`,
    L182: `compact`, `aicall`, `cua`, `imagerender`, `lsp`.
- **L198** [Tasks] · C7 · manifest MISSING — **C7 — recall of an attachment, live.** Unit-proven (`18fe82c426`, 20/4 red → 24/0 green); the robot's
    L199: session held no `file` part, so no live run exists. Owner recipe: paste an image or document, take its
    L200: part id, `tempenable` with a short span; after the span the wire note names the attachment id and
    L201: `recall` returns the payload. Waits on the owner's run — the robot cannot produce a `file` part itself.
    L202: 
    L203: `applypatch.txt` stays out of scope: the tool is unregistered (`b95c2524a5`), the file is kept only for the
    L204: CLI/heredoc path and a one-line re-registration.
    L205: 
    L206: ## Smoke Tests
    L207: 
    L208: Per batch C2–C5, before the box:
    L209: 1. **Baseline:** the named `test/tool/<tool>.test.ts` files run green on the unchanged tree (a red baseline is
    L210: STABILIZE, fixed and committed first).
    L211: 2. **Inventory:** every claim in each `.txt` of the batch listed in the commit body with its disposition
    L212: (pinned by `<test name>` / corrected / deleted).

## plans/2026-10-04_files-api-and-tariff.md  — open 2 / done 3 · lifecycle ACTIVE
- manifest `T3`: state=doing eta=3 oracle=DeepSeek chat with a reused image carries {"type":"file","file_id"} on the wire (raw-wire capture), payload < 0.1 MB, and adjacent-request prefix bytes identica
- manifest `T5`: state=verified eta=0 oracle=test/provider/raw-diff.test.ts 44/44 run 20261009T032748Z_1a95feca; mutation-check 20261009T032722Z_c96bcaed (case-2 red only); bun typecheck 20261009T032749Z_e

- **L142** [План исполнения] · TASK-3 · manifest MISSING — T3 · Вложение адресуется, а не вкладывается
- **L143** [План исполнения] · TASK-4 · manifest MISSING — T4 · Кеш не меняется

## plans/2026-10-07_supersede-between-steps-loses-reply.md  — open 3 / done 0 · lifecycle OPEN

- **L39** [Acceptance] · TASK-1 · manifest MISSING — A deterministic reproducer: prompt B lands while turn A is BETWEEN steps (not inside a held request), and the
    L40: test fails on the missing reply to B.
- **L41** [Acceptance] · TASK-2 · manifest MISSING — The cause is named by instrument (which fiber ends B's run, and how), not by this plan's inference.
- **L42** [Acceptance] · TASK-3 · manifest MISSING — Fixed in the runner or the loop so that B always gets its own reply (or a visible, named error) — and the
    L43: existing replacement test in `prompt.test.ts` stays green.
    L44: 
    L45: ## Smoke Tests
    L46: 
    L47: - Baseline: the new reproducer → red (B unanswered or `llm.calls` < 2).
    L48: - After: the reproducer → green; `bun test test/session/prompt.test.ts` → 0 fail (42 pass / 13 skip today,
    L49: `20261007T165018Z_ec8ed218`), and `test/effect/runner*.test.ts` (if present) unchanged.
    L50: - Negative control: a prompt during an in-flight held request (the existing replacement test) keeps exactly two
    L51: assistant rows.
    L52: 

## plans/2026-10-08_mcps-connector-manager.md  — open 4 / done 3 · lifecycle UNKNOWN

- **L24** [Tasks] · S3 · manifest MISSING — **S3 — OAuth flow in the TUI.** On Authenticate: call auth/authenticate, show `⋯ waiting for browser`; subscribe `mcp.browser.open.failed` (event exists) and render the URL as selectable text when the
- **L29** [Tasks] · S5 · manifest MISSING — **S5 — Remove + persistent toggle.** Remove = config delete + disconnect + logout (confirm dialog, `dialog-confirm.tsx`). SPACE-toggle becomes persistent: write `enabled` into the config (merge-patch)
- **L31** [Tasks] · S7 · manifest MISSING — **S7 — Connector catalog (presets), Canva first.** A small preset table (name, url, auth kind, docs link) + "Add from catalog" entry in the wizard: pick Canva → remote `https://api.canva.com/connect/v
- **L32** [Tasks] · S8 · manifest MISSING — **S8 — Run + record.** Baseline (pre-change) → change → focused greens; live smoke: add a local echo server (`test/server/httpapi-mcp.test.ts` already uses `["echo","demo"]` as a disabled fixture) and
    L33: 
    L34: ## Smoke Tests
    L35: 
    L36: **Baseline (before any edit):** `cmd_runner start --cwd packages/opencode -- bun test test/server/httpapi-mcp.test.ts` — expected PASS (the existing 3-4 cases); any red there is STABILIZE first, per @SURFACE_PREPARATION.
    L37: 
    L38: **Post-change cases (predicted):**
    L39: 1. `add` via TUI transport path → config file contains `mcp.<name>` (read-back) and `status` shows the server — PASS expected.
    L40: 2. Toggle → `enabled` persists in the config file (read-back), a restart keeps the state — PASS expected; today it does NOT persist (expect RED on the baseline run, GREEN after S5).
    L41: 3. Authenticate on a non-OAuth server → loud 4xx (`does not support OAuth`) — PASS expected (server already returns it).
    L42: 4. Authenticate on a real OAuth connector (Canva, once the owner's app credentials are in config) → status flips `needs_auth` → `connected`; tokens land in `bin/mcp-auth.json` — PASS expected (live, gated on credentials).
    L43: 5. `mcp.browser.open.failed` → the dialog renders the URL instead of hanging — simulated event, PASS expected.
    L44: 
    L45: **KV note (not a test):** attaching a connector changes the tool catalog, hence the request prefix, hence the prompt cache — the change takes effect with the NEXT message; the dialog should say so instead of pretending it is live.
    L46: 

## plans/2026-10-08_org-portable-home.md  — open 1 / done 8 · lifecycle UNKNOWN

- **L66** [Tasks] · S9 · manifest MISSING — **S9 — kernel `--install` (production, claude, codex, cursor) + receiver refreshes — GATED** on Claude's review verdict
    L67: on the kernel diff (the declared stop of S6; the task: «STOP before --install»). Lift: the verdict arrives; then re-run
    L68: `pytest prompt_kernel/tests/` — expect fully green — and re-stamp/install the four receivers.
    L69: 
    L70: ## Smoke Tests
    L71: 
    L72: Harness = `experiments/2026-10-08_org-portable-home/smoke.py` (black-box: subprocesses only). Predictions per case
    L73: (trader's rule — an off-prediction outcome is a divergence, logged):
    L74: 
    L75: | # | case | pre-change prediction | post-change prediction |
    L76: |---|------|----------------------|------------------------|
    L77: | C1 | scratch init creates org.fossil under scratch `ORG_HOME`; server answers on 127.0.0.1:scratch port | PASS (env already works) | PASS |
    L78: | C2 | netstat shows 127.0.0.1:port only (no 0.0.0.0/[::]) | PASS | PASS |
    L79: | C3 | init prints the chosen fossil; with decoy first on PATH and one beside -> the beside one | FAIL (nothing printed) | PASS |
    L80: | C4 | control: beside renamed away -> decoy (PATH) is chosen (fixture bites) | FAIL (no print) | PASS |

## plans/2026-10-10_plan-hygiene-in-build-mode.md  — open 2 / done 1 · lifecycle ACTIVE

- **L35** [3. Tasks] · M2 · manifest MISSING — **M2 — the TUI half.** The plan panel must reflect the same pass rather than only AGI activation (`agi-mode.tsx:718`). Oracle: the status surface shows the post-pass state; absence renders FALSE (AGEN
- **L36** [3. Tasks] · SW · manifest MISSING — **SW — the sweep of the accumulated plans.** Owner, 2026-10-10: «большая часть этих планов выполнена… если все оракулы окей, план взяли и поместили в завершенные, обновили доки. Если потом чего вылезл
    L37: 
    L38: ## 4. Smoke Tests
    L39: 
    L40: - Baseline: `bun test test/util/plan-status.test.ts` — PASS before the edit (existing suite; `reconcilePlans` already has a test file).
    L41: - Post: the M1 test RED on the missing call → GREEN; `bun typecheck` from `packages/opencode` exit 0; `_build.ps1` green after the tests.
    L42: - Sweep: for every closed plan, its own declared oracle re-run today, one file per invocation, run id recorded in the plan and in `_progress_log.md`.
    L43: 
    L44: ## 5. Rollback
    L45: 
    L46: Code: reverse scoped hunks in `session/prompt.ts` (+ the test). Plans: `git mv` back with the same basis named in a commit. No whole-file git restore.
    L47: 

## plans/2026-10-11_memory-orphan-parts.md  — open 4 / done 0 · lifecycle ACTIVE

- **L50** [2. Tasks] · S1 · manifest MISSING — **S1 — liveness filter.** `memory.ts`: a part is indexed only if its `session` exists in the
    L51: project DB (join/EXISTS on `session`). Keep the existing `message` join — it is correct.
- **L52** [2. Tasks] · S2 · manifest MISSING — **S2 — the index forgets.** remove from `part_index` (+ `part_fts`) rows whose session is
    L53: gone, so an existing polluted index heals without a manual delete of `memory.db`.
- **L54** [2. Tasks] · S3 · manifest MISSING — **S3 — RED test.** `test/memory/search.test.ts`: extend `indexFixture` so a part can be
    L55: seeded for a session that is then deleted; assert `Memory.search` does NOT return it, while
    L56: live-session parts still do. Must FAIL before S1/S2.
- **L57** [2. Tasks] · S4 · manifest MISSING — **S4 — gates.** `test/memory/*.test.ts` green, one file per run; `bun typecheck` from
    L58: `packages/opencode`; `_build.ps1`.
    L59: 
    L60: ## 3. Smoke Tests
    L61: 
    L62: | oracle | before | after |
    L63: |---|---|---|
    L64: | `bun test test/memory/search.test.ts` (cwd `packages/opencode`, cmd_runner) | **6 pass / 0 fail** — pinned 2026-10-11 `20261011T160558Z_f3cd4bd2` | PASS + new case |
    L65: | new case: part of a deleted session | **FAIL — it is returned today** | PASS — not returned |
    L66: | `search-rank.test.ts`, `fts-query.test.ts` | PASS | PASS (unchanged) |
    L67: 
    L68: ## 4. Owner decision required (destructive, NOT done here)
    L69: 
    L70: The 18 903 parts / 4 310 messages of deleted sessions are still in `opencode.db`. Purging them is
    L71: a deletion in his data and needs his word. The index fix (S1/S2) does not require it — it makes the

## plans/2026-10-12_specs-inventory-truth.md  — open 1 / done 3 · lifecycle ACTIVE

- **L52** [4. Tasks] · S2 · manifest MISSING — **S2 — generate what must be visible.** Where a reader needs the current state at a glance (facade hotspots, instance-context callers, httpapi bridge coverage), add a `<!-- generated below -->` marker

## plans/2026-10-13_recall-read-address-space.md  — open 3 / done 10 · lifecycle UNKNOWN
- manifest `R3`: state=waiting-on-user eta=6 oracle=A `_run.cmd` source run in an experiments stand, model-driven: read a >8 000-char file WHOLE (one call), `edit` it by a hash THAT read printed, then `recall(…, 

- **L51** [Residuals (found by the delegator's own verification, 2026-10-13 — keep OPEN)] · R3 · manifest waiting-on-user/eta6 · oracle A `_run.cmd` source run in an experiments stand, model-driven: read a >8 000-char file WHOLE (one call), `edit — **R3 — S5 live model run through `_run.cmd` not done** (a model calling `read` whole, editing, then `recall … release`). Delegator probes cover the stored-part layer, not the model-to-tool plumbing.
- **L52** [Residuals (found by the delegator's own verification, 2026-10-13 — keep OPEN)] · R4 · manifest MISSING — **R4 — `test/tool/read.test.ts` gives no verdict** (robot: `bytes_written: 0`, killed by hand) — an unqualified instrument; its claim is not covered by anything else.
- **L53** [Residuals (found by the delegator's own verification, 2026-10-13 — keep OPEN)] · R5 · manifest MISSING — **R5 — a `kept` selection carries no ADDRESS SPACE (measured; owner's decision).** `ToolKeptSelection` is `{from, to, pattern?, ignoreCase?, reason?}` — a number pair with nothing saying WHICH space i
    L54: 
    L55: ## Smoke Tests
    L56: 
    L57: | # | Instrument | Prediction BEFORE the run |
    L58: |---|---|---|
    L59: | S1 baseline | `cmd_runner start --cwd packages/opencode -- bun test test/tool/recall.test.ts` | PASS (24/0 per the recorded `18fe82c426` run; re-measure, do not trust) |
    L60: | S2 new red | `bun test test/tool/recall-address.test.ts` against UNCHANGED code | FAIL on all three new cases (address shift, long line, recall-of-recall) |
    L61: | S3 after T1–T3 | same file | PASS; every case also mutation-checked (revert the fix → red) |
    L62: | S4 after T4 | `bun test test/session/message-v2.test.ts` | PASS with the re-pinned release tests; the old `> 8 000 ⇒ placeholder` assertion is superseded WITH provenance, not deleted |
    L63: | S5 live | `_run.cmd` source run in an experiments stand: `read` a >8 000-char file whole, then `recall range` inside it | file line numbers match; no placeholder was sent for the whole read |
    L64: | S6 typecheck | `bun typecheck` from `packages/opencode` | exit 0 |
    L65: 
    L66: A full `bun test` is forbidden (AGENTS) — always a named file.
    L67: 

## plans/2026-10-14_kernel-stop-claim-release.md  — open 5 / done 4 · lifecycle UNKNOWN
- manifest `K1`: state=verified eta=6 oracle=python -m pytest prompt_kernel/tests/ -q → 3 failed / 213 passed (the 3 are the stale-receiver guards whose fix is --install, deferred to K3); measure.py: produ

- **L34** [Tasks] · TASK-2 · manifest MISSING — M1 mechanism committed by t36: planstatus reports a postponed/BLOCKED plan without a «## Stop claim» routes table (route | receipt | failing component, untried routes, reopen_when); end-of-turn stop-c
- **L38** [Tasks] · TASK-6 · manifest MISSING — A1 ADID_Python resident: canonical bundle takes the K3 renders (two-canon parity, docs/two-canon-protocol.md); release gate fixed (LC_ALL=C); new adid_dist_* released; manifest re-verified. <!-- sv: a
- **L39** [Tasks] · TASK-7 · manifest MISSING — A2 install to every consumer with readback: the resident names the consumer list from its installer config; per consumer the installed kernel digest == the release manifest; failures listed by name. <
- **L40** [Tasks] · TASK-8 · manifest MISSING — A4 Codex compact principle: the owner's «Compact Instructions» text (root CLAUDE.md, 2026-10-14) delivered to Codex through the ADID bundle — first VERIFY Codex 0.159.3's documented lever for compacti
- **L41** [Tasks] · TASK-9 · manifest MISSING — A3 Claude verifies A1/A2 independently (hash readback on a sample of consumer roots + this repo's hosts) and closes efbfea7c / 28db8d0ace accordingly. <!-- sv: independent-verify 1.0 -->
    L42: 
    L43: ## Smoke Tests
    L44: 
    L45: - Baseline (measured 2026-10-14, t42): `python -m pytest prompt_kernel/tests/ -q` → 209 passed; product 8 500/8 500 words; codex host 2 lines stale.
    L46: - Predictions (before K1 runs): the new global-invariant tests FAIL on today's text (exits without scope/receipts/falsifier; PLAN_MODE has no closing path; «stop» vs «descend») and PASS after K1; caps PASS with net ≤ 0 words in the product variant; a frameless read of the new BLOCKED line names rout
    L47: - A2 oracle: per-consumer digest readback, never the installer's exit code.
    L48: 
    L49: ## Stop claim
    L50: 
    L51: N/A while active.
    L52: 

## plans/2026-10-14_return-channel-binding.md  — open 5 / done 0 · lifecycle UNKNOWN

- **L36** [Tasks] · T1 · manifest MISSING — **T1 — the retraction leaves the tree.** `org.py`: remove `FLEET_MODEL` + `deliver_into_new_session`, restore the hint-only live-host message. `orgd.py`: remove `import org` + the delivery else-branch
- **L37** [Tasks] · T2 · manifest MISSING — **T2 — `done`/`escalate` refuse without their reports.** `done` requires `--report NAME`: the technote (exact name, else `NAME [<short>]`) must carry four non-empty `##` sections (case-insensitive): C
- **L38** [Tasks] · T3 · manifest MISSING — **T3 — the delegator receives the report, not the fields.** orgd DONE/BLOCKED wake text carries `report=<ref>` (DONE) / `stop-claim=<ref>` (BLOCKED) plus the technote's first lines (bounded: first 5 n
- **L39** [Tasks] · T4 · manifest MISSING — **T4 — the heartbeat follows the work.** orgd tick, WORKING branch, before the stall verdict: if the ticket has `wake_session` + `wake_worktree`, read `MAX(time_updated)` for that session in the targe
- **L40** [Tasks] · T5 · manifest MISSING — **T5 — publish, install, close.** `Protocol.md` DONE/ESCALATE + HEARTBEAT bullets state the gates (note: the Protocol page is published by `init.py`, not `wiki-put` — `wiki-put` refuses it by design; 
    L41: 
    L42: ## Smoke Tests
    L43: 
    L44: All commands run through `cmd_runner` (one file per call); every prediction precedes its run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass. No `_build.ps1` (owner rule: one build at a time, run by the fleet lead — the org scripts are not in the binary).
    L45: 
    L46: | # | command | prediction |
    L47: |---|---|---|
    L48: | B1 | `python -X utf8 test_queue_contract.py` on the PRE-change scripts + the new R1/R2 cases | RED — `done` without `--report` closes DONE; a report without the four sections is accepted; `escalate` without a stop-claim report closes BLOCKED; a busy session leaves the heartbeat frozen |
    L49: | B2 | `python -X utf8 test_cross_handoff.py` on the PRE-change-retraction tree | RED — S9/S10 assert delivery; after T1 they are gone and S1-S8 + S11 pass |
    L50: | R1 | same queue file after T2-T3 | PASS — `done` refused without the report (names it), refused with a thin report (names the missing section), accepted with the four sections (`result_ref` pinned); `escalate` refused without the stop claim (names it), accepted with routes+untried+reopen (`knowled
    L51: | R2 | same queue file after T4 | PASS — a WORKING ticket whose session gained a newer part gets `heartbeat_at`/`lease_until` refreshed by `orgd --once`; a quiet session is untouched; an unreadable DB changes nothing |
    L52: | R3 | `python -X utf8 test_cross_handoff.py` after T1 | PASS — S1-S8 + S11 green, no delivery paths remain |
    L53: | R4 | `python -X utf8 test_wiki_put.py`, `test_forum_post.py` | PASS, unchanged |
    L54: | S5 | copy changed files to `$ORG_HOME/genesis` (byte compare first), then `python $ORG_HOME/genesis/init.py` | install sha == HEAD sha; init exits 0 (idempotent) |

## plans/2026-10-15_dais-peer-trust-reward.md  — open 4 / done 1 · lifecycle ACTIVE

- **L48** [Tasks] · TASK-2 · manifest MISSING — M1 Mint rule in org.py: `verify` requires the verifier's receipt (run id / digest) and records it; a
    L49: self-delegated ticket's verify is refused for trust (still closable). Coordinate with the uncommitted org.py work
    L50: (plan 2026-10-14_return-channel-binding). <!-- sv: mint-rule 0.6, receipt 0.4 -->
- **L51** [Tasks] · TASK-3 · manifest MISSING — M2 Clear the verdict backlog by delegators with receipts (until M1 lands, the receipt lives here, since
    L52: `verify` takes none): ✓ ADID kernel delivery — e01effe5ac VERIFIED by claude 2026-10-15 08:10Z, receipt:
    L53: consumer_readback.py — developer_instructions 67 430 B run_limit=1 abandoned_in_pct=1 status_claim=4 BLOCKED=0,
    L54: ADID .claude/reasoning_kernel.md sha c2bcabab == opencode's, doctor «ADID content current PASS» (fc070ee9…). Open:
    L55: claude (34c0728e5f, 9c985ade9f), codex→smit 9,
    L56: codex→adid 2, Alexander→antigravity 1. <!-- sv: verdict-backlog 0.7, receipts 0.3 -->
- **L57** [Tasks] · TASK-4 · manifest MISSING — D2 Falsify the design on that data (who would game it, how: collusion pairs, self-verify, rubber-stamp
    L58: verifiers) — outside falsifier included.
- **L59** [Tasks] · TASK-5 · manifest MISSING — D3 Owner decision: weight of T in R; then kernel text through the pipeline (STOP before install, review).
    L60: 
    L61: ## Smoke Tests
    L62: 
    L63: D1 prediction: every assignee with ≥1 closed ticket gets a T in (0,1); a rejected-then-verified ticket counts once
    L64: each way; a self-verified ticket is excluded (control: a known self-verify case must drop out).
    L65: 
    L66: ```yaml
    L67: Keywords: peer-trust-ledger 0.40, verification-not-votes 0.30, reward-integration 0.20, delegation-routing 0.10
    L68: Semantic dominant: Peer trust enters the DAIS reward only as a track record of claims that survived independent verification in org.fossil, never as peer approval.
    L69: md5: 3b8f1d6a9c2e07f45d3b8a1c6e9f2d47
    L70: prev-md5: 00000000000000000000000000000000
    L71: parent-goal-md5: 00000000000000000000000000000000
    L72: ```
    L73: 

## plans/2026-10-15_kernel-undefined-contract-audit.md  — open 1 / done 1 · lifecycle ACTIVE

- **L17** [Tasks] · TASK-2 · manifest MISSING — A2 Parent source/readback+native independent reviewer:9/9snapshotSHA verified;8confirmed norm rows=4lexemes,7rejected originalcandidates,1Unknowntitle reference. Report parent-review.md distinguishes 
    L18: 
    L19: ## Smoke Tests
    L20: 
    L21: Prediction: audit artifact generated; numeric totals equal unique row ids, duplicate copies of one norm count once.
    L22: Each reported undefined term has a current source address and a recorded sweep for definition.
    L23: No-match filters require known-positive control. Audit can find zero defects if definitions are found;
    L24: in that case evidence inventories must explain rejected candidates. Parent source readback—not robot verdict.
    L25: No claimed token quantity for `short` without its actual declared metric; model examples are testimony.
    L26: 
    L27: ```yaml
    L28: Keywords: contract-boundaries 0.50, undefined-terms 0.30, independent-audit 0.20
    L29: Semantic dominant: Посчитать недоопределённые нормы на текущем исходнике и проверить каждую находку независимо.
    L30: md5: 21a66067b9824dab91f15b37970ac653
    L31: prev-md5: 00000000000000000000000000000000

## plans/2026-10-15_project-fossil-cell.md  — open 5 / done 12 · lifecycle UNKNOWN

- **L62** [Phase B — the local cell (design first, then first slice)] · TASK-5 · manifest MISSING — B1 grounding: does wiki/ticket/chat data in snapshot.fsl survive the snapshot lifecycle (revertTo,
    L63: rebuild, re-init, silent close+delete)? Answer with evidence from `docs/fossil-snapshot.md` §7 (HISTORY_INVALID
    L64: reinit path) and `src/snapshot/fossil.ts` (ensureInit, checkout, extras cleanup). Wiki/ticket events live in
    L65: the SAME sqlite file the snapshots live in — a reinit DELETES them. Record the verdict in this plan.
    L66: <!-- sv: lifecycle-survival, evidence-first -->
    L67: 
    L68: ## B1 verdict — measured + read from code (2026-10-15)
    L69: 
    L70: **The cell lives IN snapshot.fsl — no sibling repo.** Evidence:
    L71: 
    L72: 1. ✓ The normal lifecycle never touches non-checkout data: `track()` → `fossil commit` (working-copy
    L73: files only), `checkoutTo` → `fossil checkout --force <leaf>` (working-copy files only), `revertTo`
    L74: → same checkout path. No `fossil rebuild`/`prune`/`delete` call exists anywhere in
    L75: `src/snapshot/**` (grep). Wiki/ticket events live in the same SQLite file and are not checkout
    L76: state — `docs/fossil-snapshot.md` §3: "History in .fsl is not erased".
- **L158** [Gate] · TASK-14 · manifest MISSING — Smoke requirements written
- **L159** [Gate] · TASK-15 · manifest MISSING — Baseline recorded [Exact]
- **L160** [Gate] · TASK-16 · manifest MISSING — Implementation only after baseline
- **L161** [Gate] · TASK-17 · manifest MISSING — Post-impl smoke passed before [x]
    L162: 
    L163: ## Rules honored
    L164: - Never full `bun test`; one file per call via cmd_runner; never bin/; no build (fleet lead builds);
    L165: no fossil CLI mutate paths on an unproven repo (Phase B grounding first); commit only my paths.
    L166: 

## plans/2026-10-15_tui-active-sessions-panel.md  — open 1 / done 6 · lifecycle UNKNOWN
- manifest `S1`: state=doing eta=1 oracle=bun typecheck from packages/opencode exits 0 (or shows zero errors referencing the four t52b paths) after the peer's src/session/llm.ts lands.
- manifest `S5`: state=doing eta=1 oracle=bun typecheck from packages/opencode exits 0 (or shows zero errors referencing the four t52b paths) after the peer's src/session/llm.ts lands.

- **L57** [Surfaces (G6 binding)] · TASK-5 · manifest MISSING — S5 `bun typecheck` PASS from packages/opencode — OPEN: package red exit 2, 10/10 errors in `src/session/llm.ts` (peer's in-flight `M`, in tree since t52b start; 0 reference t52b paths). Next: re-run a

## plans/2026-10-15_web-tui-parity.md  — open 1 / done 5 · lifecycle UNKNOWN

- **L92** [Surfaces (G6 binding)] · TASK-6 · manifest MISSING — W5 proof (idle DOM+probe banked; busy frame BLOCKED keyless: 4 models × 5 turns → 401 Invalid credential, isRetryable:false — the 10-07 public-key path regressed upstream; STAND: .temp/t59-stand/openc
    L93: <!-- sv: Keywords: visual-oracle 0.4, build-receipt 0.3, commit-by-path 0.3; dominant: each closed gap carries a receipt; md5: f96cd36315f8e041717193234f1be0496 -->
    L94: 
    L95: ## Smoke Tests
    L96: 
    L97: - Web tests first per component where the web app has a test pattern (measured: `packages/app/src/**/*.test.ts(x)` —
    L98: e.g. `pages/session/session-model-helpers.test.ts`, `context/model-variant.test.ts`, `context/global-sync/*.test.ts`).
    L99: Run ONE file per call: `cmd_runner start --cwd packages/opencode -- bun test <file>` (or the app package runner
    L100: the repo uses for `packages/app` — verify before first run); read `<run>/state.json` + whole output.
    L101: - Typecheck per repo convention before any commit.
    L102: - Visual oracle (per closed gap): build ONCE (`pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root,
    L103: read its `state.json`), start a server from `dist\bin` under cmd_runner in a child env with every
    L104: `*_API_KEY/*_TOKEN/*_SECRET` removed (names only in the record), open the web form in a browser, capture each
    L105: closed gap. Hosts we work with stay in `bin` (owner: «dist/bin только для обкатки, хосты поднимаем из bin»).
    L106: - Expected deltas: RED→GREEN on the new web test; idle web frame shows `none active`, busy frame lists the session

## plans/2026-10-16_haiku-omp-controlled-latency.md  — open 2 / done 3 · lifecycle UNKNOWN

- **L67** [Задачи] · P2 · manifest MISSING — **P2** — Частично: ✓ actual installed CLI pre-send hook qualified `20261016T004545Z_546f6c6f`, capture-only `20261016T004631Z_42dab6b9`; matrix outgoing raw hashes8/8 совпали. Остаток: точный transmit
- **L70** [Задачи] · P5 · manifest MISSING — **P5** — Частично: ✓ public-safe REPORT/metrics/receipts сохранены, map отрендерен `20261016T005145Z_0de9d608`; routing/index/progress подготовлены к scoped commit. План ACTIVE: конкретный компонент l
    L71: 
    L72: ## Smoke Tests
    L73: 
    L74: ### Заранее заданная live matrix (diagnostic, максимум8 inference calls)
    L75: 
    L76: Qualification receipt: `20261016T004545Z_546f6c6f`, actual binary18.11.1: stop exit74+capture+0 independent localhost requests; send control exit0+1 request+known SSE. Первую JSON-instead-of-SSE попытку `20261016T004453Z_ad190fd4` остановили, результат UNKNOWN и retained. Actual API-key-mode CLI pre
    L77: 
    L78: Фиксируются account(API key OpenCode), official endpoint, actual gateway h2, modelHaiku5.5, adaptive/max, output cap8192,90s deadline, одинаковый набор feature beta headers. Owner sessions не используются. Порядок A,B,C,D,D,C,B,A, два наблюдения каждого arm, выводы только exploratory.
    L79: 
    L80: - A: исходный первый OpenCode wire, единственное отклонение max_tokens125000→8192.
    L81: - B: current installed omp CLI payload, cap128000→8192. Весь builder bundle отличается: это natural-bundle diagnostic, НЕ однофакторный причинный oracle.
    L82: - C: A с единственной заменой tools catalog на захваченный каталог B. Исследуется catalog bundle (capabilities/описания/размер), НЕ чистое число инструментов и НЕ качество выполнения задачи.
    L83: - D: A с единственной заменой messages на захваченный первый user message B. Исследуется input-preparation bundle, НЕ только UTC suffix.
    L84: 

## plans/2026-10-16_message-cleaner.md  — open 3 / done 6 · lifecycle UNKNOWN
- manifest `E3`: state=doing eta=2 oracle=fixer_log.jsonl holds 27 lines with first ok=True; validator verdicts + REPORT supplement follow

- **L102** [Tasks and bindings] · E3 · manifest doing/eta2 · oracle fixer_log.jsonl holds 27 lines with first ok=True; validator verdicts + REPORT supplement follow — **E3** — Fixer runs: researcher verifies the `:free` model live ($0, active) first; one zero-tool call per
    L103: flagged reply with the fixed prompt; log `{msg_id, model, latency_ms, output}`. Binding: `fixer_log.jsonl`.
    L104: state=BLOCKED:upstream-429-26b-5/5-and-31b-4/4-owner-authorized-NO-GO-stands-resume-either-id;eta_turns=2;oracle=A3.
    L105: <!-- sv: free-model-fixer 0.50, one-reply-calls 0.30, latency-log 0.20 -->
- **L113** [Tasks and bindings] · E6 · manifest MISSING — **E6** — Close: `_progress_log.md` entry (shared file — own hunks only), `svm render`, plan stays in `plans/`
    L114: until the report is accepted, commit(s) through `scripts/commit_own.py`, `_build.ps1` receipt.
    L115: Binding: `_progress_log.md`, this plan. state=IN-PROGRESS:report-committed-next-E3-residual;eta_turns=1;oracle=closure.
    L116: <!-- sv: hygiene-close 0.50, private-index-commit 0.30, build-receipt 0.20 -->
    L117: 
    L118: ## Smoke Tests (PRE_FLIGHT gate — no fixer call before GREEN)
    L119: 
    L120: 1. Extractor dry run: `corpus.jsonl` line count equals flagged positives + 20 clean controls + legit-CJK cases;
    L121: every line carries `msg_id` + `model`; the DB file mtime/hash unchanged after the run (read-only proof).
    L122: 2. Detector on fixtures: `«жду下一步»` → flagged with span `下一步`; `` `renderSvgToRgba` 和 `` inside a fence →
    L123: NOT flagged; a reply discussing the literal `的` inside inline code → NOT flagged.
    L124: 3. Validator on fixtures: byte-identical output ACCEPTs; output with one touched hex char REJECTs naming the span;
    L125: output with rephrased prose beyond the bound REJECTs naming rule 3.
    L126: 
    L127: ## Risks
- **L223** [Bilingual scope (corpus, detector, tests)] · E8 · manifest MISSING — **E8** — v2 campaign on the allowlisted free id: probe with prompt v2 (31b: 3×429 PROBE REFUSAL), then `--all` over the
    L224: extended fixable set (budget ≤120 total incl. the ≈11 spent); validator over all outputs;
    L225: REPORT supplement S2 (acceptance, rejects with why, latency p50/p95, 10 drift reads quoted,
    L226: renewed go/no-go). Binding: `fixer_log_<slug>-v2`, `verdicts`, `REPORT.md`.
    L227: state=BLOCKED:v2-probe-429-rerun-sampling-109-sends-decided-S2-written;eta_turns=2;oracle=A3+A5. <!-- sv: v2-campaign 0.45, translate-acceptance 0.35, s2-report 0.20 -->
    L228: 

## plans/2026-10-16_model-chain-failover.md  — open 8 / done 1 · lifecycle UNKNOWN
- manifest `C1`: state=doing eta=3 oracle=A1: chain CRUD persists per agent/scope through the TUI's own server path with fill-once semantics; focused store test + readback; behind-back overwrite case gr
- manifest `C3b`: state=doing eta=2 oracle=A3/live-stand: hanging member cut at the measured threshold, retried on the next UP member with a visible synthetic note; partial text kept with reason

- **L50** [Review R1–R4 (owner, 2026-10-16) — decided, implemented in slice 2] · C3b · manifest doing/eta2 · oracle A3/live-stand: hanging member cut at the measured threshold, retried on the next UP member with a visible synt — **C3b** — In-request failover (ЯДРО ПРИЗЕМЛЕНО, лист открыт до live-stand подтверждения): обрыв по first-token порогу, повтор на следующем UP, видимая synthetic-заметка, частичный текст зафиксирован с
    L51: ## Acceptance frame (named BEFORE planning — ISO/IEC 25010)
    L52: 
    L53: | ID | Predicate | Oracle / discriminating control |
    L54: |---|---|---|
    L55: | A1 | Chain CRUD persists per agent/scope through the TUI's own server path; fill (global→worktree→session) preserved, no new JSON file | Focused store test + `model.json`/session readback; TUI-behind-back overwrite case stays green |
    L56: | A2 | Terminal refusal (privacy-gate text, 402, auth, model-not-found) marks member DOWN at once — refusing member never called twice before its health check | Fixture stub test RED-first; call-count assertion on refusing member |
    L57: | A3 | Transient (429/5xx/timeout/no-first-token past derived threshold) retries bounded, then DOWN; session ends on backup with visible note (member + reason) | Hanging-stub cut at threshold; session transcript contains the note; silent-swap mutation → EXPECTED_FAIL |
    L58: | A4 | 10-min check probes each DOWN member once with a cheap direct call; recovered member returns on next check; probes create no sessions and carry no tools | Fake-clock test (no 10-min sleep); probe session-creation count = 0, tools = 0 |
    L59: | A5 | `prompt_async` without model + task/pipeline/reasoning resolve to first UP member; dispatcher no longer pins MODEL by hand | Assignment test with first member DOWN → second member used; `dispatch.py` diff shows chain read |
    L60: | A6 | No invented models: failover set ⊆ user chain; health surface shows value or `unknown`, never blank | Exhausted-chain test errors visibly instead of inventing; status render test |
    L61: | A7 | Live: chain [free zen → Go contributor] with free hanging today ends on Go; scoped regressions + typecheck + `_build.ps1` green | Real free/contributor-only probe via researcher_agent; run/state receipts |
    L62: | A8 | Retry status on a switch names failed→next models, the terminal code and retry-after with zero wait; the session лента carries the same switch note | Policy switch-message unit test + processor chain test; a silent-status mutation (message without models) → EXPECTED_FAIL |
    L63: 
    L64: ## Tasks and bindings
- **L66** [Tasks and bindings] · C1 · manifest doing/eta3 · oracle A1: chain CRUD persists per agent/scope through the TUI's own server path with fill-once semantics; focused st — **C1** — Chain store (LANDED slice 2, box stays open until A1 full): `model_chain(scope, agent, data)` in `storage/db.ts` CORE_SCHEMA_SQL + `chain.sql.ts` drizzle table + `store.ts` (`loadChain` one k
- **L67** [Tasks and bindings] · C2 · manifest MISSING — **C2** — Error classifier: `classifyChainError(parsed, message)` → `terminal | transient`, reusing `parseAPICallError` + `retryable`; terminal list: auth/401/403, privacy/consent-gate regex, 402/insuf
- **L68** [Tasks and bindings] · C3 · manifest MISSING — **C3** — Failover executor: first-UP selection, terminal→DOWN-at-once, transient→bounded retry→DOWN, continue session on next healthy + visible note (member, reason) via SessionRetry surface, never si
- **L69** [Tasks and bindings] · C4 · manifest MISSING — **C4** — 10-min health checker: timer off request path, one cheap direct provider probe per DOWN member, UP on answer, order restored; zero tools, zero sessions; fake-clock tests. Reuses breaker `cool
- **L70** [Tasks and bindings] · C5 · manifest MISSING — **C5** — Assignment uses chain (CORE LANDED slice 2): `resolveChainAgentModel` in `session-settings.ts` reads ONLY the session layer key + first UP; empty layer warns `bug:` and falls through to legac
- **L71** [Tasks and bindings] · C6 · manifest MISSING — **C6** — TUI chain editor + close: DialogModel/DialogManageModels gains primary+backups editing through the C1 route; web lane (t59) parity noted not built twice; live free→Go receipt via researcher_a
- **L73** [Tasks and bindings] · C8 · manifest MISSING — **C8** — favorites→chain (ЧАСТИЧНО 2026-10-16: helper+тест): `favoritesToChain(picked, favorites)` в `chain.ts` — явный выбор = голова, остальные favorites = бэкапы по порядку списка, без алиасинга; 3
    L74: 
    L75: ## Smoke Tests (PRE_FLIGHT gate — no product edit before RED)
    L76: 
    L77: 1. `packages/opencode/test/provider/model-chain-failover.test.ts` (new, ONE file per runner call): stub provider with 4 behaviours — hang (no first token), privacy-refusal text, 402, 429-then-success. RED today: no chain module exists. Asserts: terminal members called exactly once; hanging cut at de
    L78: 2. `packages/opencode/test/session/session-settings-smoke.test.ts` § chain-fill (extend, not fork): chain fill global→worktree→session; TUI-path write wins over behind-back edit.
    L79: 3. Live (researcher_agent only, free/contributor): chain `[opencode/muse-spark-1.3-contributor-free → opencode-go/muse-spark-1.3-contributor]` with free hanging → session answers on Go; receipt = session id + model footer + timings.
    L80: 
    L81: ## Risks
    L82: 
    L83: | ID | Trigger | Severity | Containment / rollback | Owner |
    L84: |---|---|---|---|---|
    L85: | R1 | Second breaker alongside gateway store | critical | REUSE `getHealthWindow`/`recordError`/breaker; review diff for duplicate state | Smit |
    L86: | R2 | Probe creates sessions / carries tools (10-16 incident) | critical | Direct-call-only probe; test asserts sessions=0, tools=0; no `prompt_async` in probe path | Smit |
    L87: | R3 | TUI-behind-back overwrite (10-15) | high | All writes via TUI server path; behind-back test stays green | Smit |

## plans/2026-10-16_reasoning-lossless-replay.md  — open 3 / done 6 · lifecycle UNKNOWN
- manifest `T1`: state=doing eta=1 oracle=A1–A4 source+baseline; SMOKE: RED preservation asserts + SDK capture-fetch control

- **L72** [Задачи и bindings] · T4 · manifest MISSING — **T4** — Квалифицировать downstream SDK/adapters по provider matrix: не оставлять silent drop ниже исправленного transform. Отличать текстовую dialect conversion от opaque replay; сохранять provenance
- **L76** [Задачи и bindings] · T8 · manifest MISSING — **T8** — Independent verifier перечитывает artifacts/pins и сам исполняет decisive oracle; scoped regressions/typecheck/обязательный build, diff direction и чужая dirty work проверены. Обновить граф н
- **L77** [Задачи и bindings] · T9 · manifest MISSING — **T9** — Квалифицировать HTTP/3/QUIC для `api.anthropic.com` с этой машины и проверить текущий OpenCode transport/fallback по отдельному contract ниже. T9 research-only; изменение product transport тр
    L78: 
    L79: ## T9: отдельный HTTP/3 / QUIC contract
    L80: 
    L81: Исходная переписка — testimony, не current receipt этого Windows host. Ни наличие direct network, ни TLS interception, ни ограничения песочницы, ни «Bun предпочитает QUIC» отсюда не наследуются. Первичная проверка источников при подготовке плана: issue27785 действительно содержит пользовательское со
    L82: 
    L83: Порядок и различающие результаты:
    L84: 
    L85: 1. Обнаружить точный клиент/binary и версии; проверить HTTP3 feature/build flags, а не только список URL schemes. Квалифицировать на independently known H3 endpoint/fixture. Curl без HTTP3 — CAPABILITY_GAP инструмента; выбрать/квалифицировать другой portable client без глобальных изменений и не дела
    L86: 2. Установить фактический network path: direct/proxy/VPN, DNS/IP, target host/SNI, сертификат/проверка TLS, UDP443/control reachability. Содержимое proxy URLs/credentials не печатать. Не объявлять proxy TLS-terminating без свидетельства; учитывать возможности конкретного клиента/proxy, не делать уни
    L87: 3. Сохранить raw response headers и Alt-Svc, но считать это только объявлением. Отсутствие Alt-Svc не доказывает отсутствие H3. Проверить forced H3 **без fallback**, зафиксировать negotiated protocol/ALPN или эквивалентный transport receipt, HTTP status, error, target IP, timestamps/RTT/deadline. Дл
    L88: 4. Прямой TLS-verified HTTP/3 response от target, включая401/405/404, доказывает reachability конкретного host/path на этом маршруте; HEAD/root не доказывает работу authenticated POST `/v1/messages` и SSE. При fail/timeout квалифицировать UDP/client/network leaves; иначе server support остаётся UNKN
    L89: 5. Отдельно прочитать current gateway/transport code через CodeGraph, проверить реальную capability Bun/Node/SDK и winning rung по runtime evidence. H3 в curl не означает H3 в OpenCode. Квалифицировать fallback H3→H2→HTTP1.1 на deterministic seam с forced QUIC failure; записать результат и terminal 
    L90: 6. Authenticated H3/H2 Messages/SSE comparison — лишь при available qualified client/authority; общий model/account/body/effort/cap/headers, корректный complete terminal, одинаковые credentials только в памяти. Эти inference calls входят в общий лимит6, не добавляют новый. Transport success, API acc
    L91: 

## plans/2026-10-16_self-edit-directive.md  — open 1 / done 10 · lifecycle UNKNOWN
- manifest `P1b`: state=doing eta=3 oracle=P1a RED-first tests, then P1b green + switch-OFF byte-rollback proof; P1c refusal receipts

- **L90** [Tasks and bindings] · P2 · manifest MISSING — **P2** — Opt-in per model in t68 chain, real robot runs: along/across/adversarial/effect cells incl. ERROR RECURRENCE A/B. Owner decides default last. NOT in this run. <!-- sv: robot-runs 0.45, error-
    L91: 
    L92: Allowed in Phase E: `plans/2026-10-16_self-edit-directive.md`, `experiments/2026-10-16_self-edit-directive/**`, `_progress_log.md` (own entry), read-only DB. Forbidden: `bin/`, kernel, product source edits, paid calls (>0 without owner yes), `git add -A`, bare `git commit`.
    L93: 
    L94: ## Smoke Tests
    L95: 
    L96: Predictions recorded BEFORE runs (E1 freezes them):
    L97: - Addressing accuracy: line-numbers ~55%, quoted-snippets ~85%, per-line-hashes ~70% (models copy text better than they count; hashes are exact but long). Falsifier: any scheme under 40% or line-numbers best — re-examine corpus/task framing.
    L98: - Token saving: median cuttable ~60–75% of heavy-result bytes would save next-replay tokens; codegraph/grep most wasteful, read least (read windows are already bounded). Falsifier: median under 30% — directive not worth the wire.
    L99: - Errata: ≥30% of sampled directives catch a real mistake on hand-read (wrong hypothesis, stale plan, misread tool output). Falsifier: under 10% — erratum path is decoration.
    L100: - Refusal: 100% of blank-all / call-removal / no-reason-release fixtures refused in offline validator. Falsifier: any pass — validator is not a gate.
    L101: - Free calls ≤ 120 total; each run logged with model, prompt hash, output hash.
    L102: 
    L103: ## Risks / rollback / continuation
    L104: 

## plans/2026-10-16_unmanaged-options.md  — open 0 / done 0 · lifecycle UNKNOWN


## plans/2026-10-16_zoekt-scip-fossil-sv.md  — open 3 / done 6 · lifecycle ACTIVE

- **L96** [Smoke Tests: M0–M2 критерии до реализации] · M0b · manifest MISSING — **M0b** — corpus и current CodeGraph baseline, воспроизводимый reader. <!-- sv: baseline, corpus, measurement -->
- **L251** [Задачи] · TASK-8 · manifest MISSING — Z4 — реализовать локальный adapter/service и сравнительный oracle на реальном корпусе.
    L252: Начать отдельным binding после Z2/Z3; production mutation вне первого envelope.
    L253: <!-- sv: local-service, fossil-cursor, reproducible-parity -->
- **L254** [Задачи] · TASK-9 · manifest MISSING — Z5 — заменить CodeGraph consumers после проверенной parity; убрать обязательную зависимость,
    L255: проверить critical flows, отмену, свежесть, отсутствие сервиса и rollback.
    L256: <!-- sv: codegraph-migration, consumer-parity, regression -->
    L257: 
    L258: ## Риски / rollback
    L259: 
    L260: - CONFIRMED ✓ Windows portability через pinned overlay, native compiled oracles
    L261: 20261016T160358Z_3673c425 / 20261016T160746Z_a0d80ed8. Linux runtime Unknown.
    L262: - Inferred: SCIP — формат, не готовый универсальный call graph. Проверить schema
    L263: и indexer ownership до выбора graph модели.
    L264: - CONFIRMED ✓ full/delta equivalence на real Fossil fixtures; большие корпуса,
    L265: delta/full timing ratio и disk retirement остаются Unknown. Старые generations
    L266: сохраняются; synchronous Windows unmap не обещается.
    L267: - Inferred: mlink одного check-in не покрывает произвольный диапазон/ветви/undo.
    L268: До production нужны ancestry и атомарная публикация индекса с revision cursor.

## plans/2026-10-17_portable-binary-hermetic.md  — open 6 / done 0 · lifecycle UNKNOWN

- **L74** [G3 Master plan] · TASK-1 · manifest MISSING — S1 — Clamp TUI + shared discovery to `directory..worktree` (no unbounded `up`).
    L75: Files: `packages/opencode/src/cli/cmd/tui/config/tui.ts`, `packages/opencode/src/config/paths.ts`
    L76: (hermetic helper + stop enforcement), `packages/opencode/src/skill/index.ts` (no behavior change, only bound
    L77: source), `packages/core/src/global.ts` (assert/document exe-dir config, no logic change unless needed).
    L78: Detail: thread `worktree` (or explicit `stop`) from `CurrentWorkingDirectory`/Instance ctx into
    L79: `TuiConfig.loadState` → `ConfigPaths.directories/files`; `pluginScope(file, ctx)` must test
    L80: `Instance.containsPath`-style (directory OR worktree) instead of directory-only; keep
    L81: `OPENCODE_CONFIG_DIR` / `OPENCODE_TUI_CONFIG` / `OPENCODE_CONFIG_CONTENT` overrides working (highest priority,
    L82: explicitly requested = allowed). Keep project-layer loading from the OPENED project untouched.
- **L83** [G3 Master plan] · TASK-2 · manifest MISSING — S2 — Fixture tests first (RED today, GREEN after S1).
    L84: New: `packages/opencode/test/config/portable-hermetic.test.ts` (fixture: parent `.opencode/{tui.json,
    L85: plugins/marker,skills,agent,commands,opencode.json}` + child install dir with exe-adjacent config; assert child
    L86: load sees zero parent sources and still sees exe-adjacent + data-root sources; covers `directories/files`,
    L87: `TuiConfig.loadState` with/without worktree, `pluginScope`, skill/agent/command scans). One file per test run
    L88: via cmd_runner; whole-file timeout rule applies.
- **L89** [G3 Master plan] · TASK-3 · manifest MISSING — S3 — Fill `model.json` layer instead of ENOENT-warn.
    L90: Files: `packages/opencode/src/session/session-settings.ts` (`readModelState`/`ensureModelState`), call sites
    L91: (`provider/provider.ts:1900`, `gateway/config-manager.ts:306` keep their catches as backstop, the fill owns
    L92: creation). Detail: on fresh data root, ensure `Global.Path.state/` exists and write a minimal seeded
    L93: `model.json` (documented shape, empty recent/favorite) once; readers then find a layer, never a hole. No
    L94: silent default-model invention beyond the existing `defaultModel` fallback chain.
- **L95** [G3 Master plan] · TASK-4 · manifest MISSING — S4 — Print error content, never `[object Object]`.
    L96: Files: `packages/opencode/src/config/config.ts:650` (+ siblings found by the same pattern: `storage/db.ts`,
    L97: `project/instance.ts`, TUI `worker.ts` if `String(e)`), routed through `util/error.ts:errorMessage/errorData`.
    L98: Assert: forced seed/load failure logs its message/fields, never the literal `[object Object]`.
- **L99** [G3 Master plan] · TASK-5 · manifest MISSING — S5 — Visibility: one log line per loaded source + `/config` list.
    L100: Files: `packages/opencode/src/config/config.ts` (`loadFile`/`merge` already logs one line — extend to TUI
    L101: `mergeFile` + gateway sync), `packages/opencode/src/cli/cmd/tui/settings/registry.ts` (or the `/config`
    L102: route backing it) to render the loaded-source list (path + scope). A config the user did not put there must
    L103: be impossible (S1), not merely visible — visibility is the proof, not the fix.
- **L104** [G3 Master plan] · TASK-6 · manifest MISSING — S6 — Real check after `_build.ps1`: copy `dist/bin` → `.temp/t78-install/a/b/bin`, decoy `.opencode/`
    L105: in `.temp/t78-install/` with a marker plugin that writes a file, launch through cmd_runner with API-key env
    L106: removed (names only in the record), assert marker never fired + log lists only local sources. Through
    L107: cmd_runner; read `state.json` + whole output.
    L108: 
    L109: ## Claims / risks / smoke
    L110: 
    L111: - Claims: (1) child load sees zero parent sources [falsifier: fixture test lists a parent path]; (2) exe-adjacent
    L112: + data-root sources still load [falsifier: child config missing]; (3) `model.json` exists after first boot on a
    L113: fresh root, no ENOENT `bug:` [falsifier: file absent or warn present]; (4) forced seed failure prints content,
    L114: never `[object Object]` [falsifier: literal in log]; (5) every loaded source has one log line and appears in
    L115: `/config` [falsifier: loaded-but-unlisted source]; (6) copied-`dist` + decoy-parent run fires no marker.
    L116: - Risks: R1 clamping breaks opening a real project from a subdir (project layer must still load from the opened
    L117: worktree — guard: fixture for subdir-of-project still loads project `.opencode`, only exe-ancestors blocked;
    L118: distinguish "project the user opened" from "folders above the exe"). R2 `model.json` seeding invents a default

## plans/2026-10-18_codex-oauth-empty-error.md  — open 4 / done 0 · lifecycle UNKNOWN

- **L11** [Задачи] · TASK-1 · manifest MISSING — S1 Пробросить реальную ошибку через `authorize`/`callback` (лог + тело `BadRequest` с `message`), контракт дыма: повтор `EADDRINUSE` даёт не `{}`, а текст с `EADDRINUSE`/`1455`
- **L12** [Задачи] · TASK-2 · manifest MISSING — S2 Сделать Codex OAuth-сервер как в Anthropic: `listen`-хелпер, fallback на эфемерный порт при `EADDRINUSE`, очистка `oauthServer`/`oauthPort` при ошибке, `exchangeCodeForTokens` по фактическому `redi
- **L13** [Задачи] · TASK-3 · manifest MISSING — S3 Дым и регресс: `test/server/httpapi-provider.test.ts` зелёный, ручной дым `POST /provider/openai/oauth/authorize` при занятом `1455` возвращает понятную ошибку, а не `{}`
- **L14** [Задачи] · TASK-4 · manifest MISSING — S4 Протокол по эталонам (`oh-my-pi`, `external/opencode-1.19.0`): scope `api.connectors.read/invoke`, residency `data_residency`+header, refresh single-flight, device polling MAX_POLLS=120, валидация 
    L15: 
    L16: ## Smoke Tests
    L17: - `smoke: S1` — занять `1455` (node-слушатель), вызвать authorize Codex browser-метода, ожидать ошибку с `EADDRINUSE`/`1455`, а не `{}`
    L18: - `smoke: S2` — повторный `authorize` после неудачи не врёт про порт (второй вызов тоже даёт внятный результат, а не висяк)
    L19: - `smoke: S3` — `bun test packages/opencode/test/server/httpapi-provider.test.ts` PASS
    L20: - `smoke: S4` — `scope` содержит `api.connectors`, device polling ограничен 120 попытками, exchange валидирует поля, `extractResidency` читает `data_residency`
    L21: 
    L22: ## Риски
    L23: - Смена тела `BadRequest` может разойтись с SDK-типом ошибки — держать parity-тест зелёным, fallback только на форму `{message}` если схема позволяет, иначе только лог + отдельный тест
    L24: 
    L25: ## Статус 2026-10-18 (факты, не план)
    L26: - S1/S2/S4 в коде: `provider.ts` логирует реальную причину, `codex.ts` — fallback порта, scope `api.connectors`, residency, single-flight refresh, MAX_POLLS=120, allowlist 1.19.0; TUI вместо `{}` показывает подсказку про логи. LSP по `codex.ts` чист, `dialog-provider.tsx` — только предсущ. type-ошиб
    L27: - `_build.ps1` PASS (exit 0, smoke 10.0.1442, артефакты в `dist/`). Receipt: `cmd_runner 20261018T112823Z_22191370`.
    L28: - Parity-тест НЕ зелёный по среде, не по коду: 3 прогона — таймаут фикстуры + `EBUSY rm Temp` (и в системном, и в изолированном Temp). Контрольный `httpapi-instance.test.ts` (не тронут правками) тоже красный на этой машине (2 pass / 3 fail, 500 на dispose) — harness болен независимо от изменений. S3

## plans/2026-10-18_global-recents-constraint.md  — open 1 / done 5 · lifecycle UNKNOWN

- **L20** [Status] · TASK-6 · manifest MISSING — OWNER BOX (do not close the plan): owner enters `globalRecents` in the TUI (Global recents action, ctrl+alt+r) — proposed seed: free zen → contributor via Go (owner order 2026-10-16). The plan stays A
    L21: 
    L22: ## 1. Incident and mechanism (measured)
    L23: 
    L24: - `D:/zPython/ADID_Python/.opencode/data/state/model.json` held
    L25: `workspaceAgent.default.{build_mode,plan_mode,orchestrator_agent,…} = opencode-go/glm-5.3-flash`
    L26: (written 10-15). A host launched from our bin ran ticket af66e83a21 on it for 14 steps (10-18).
    L27: Owner: not allowed — the current order is free zen → contributor via Go.
    L28: - Mechanism A — `resolveAgentModel` (`packages/opencode/src/session/session-settings.ts:281-303`):
    L29: returns the session pick, else the worktree pick («last explicit pick in this worktree»), else
    L30: nothing. Nothing checks either pick against the global list.
    L31: - Mechanism B — `fillChainForNewLayer` (`packages/opencode/src/provider/model-chain/chain.ts:93-96`):
    L32: copies the parent once; «the parent is never consulted again», so a lower layer never learns
    L33: that the global list changed. `resolveChainAgentModel` (`session-settings.ts:313-328`) takes
    L34: the first UP member of whatever the session layer holds — no membership check.

## plans/2026-10-18_kernel-method-preamble.md  — open 1 / done 14 · lifecycle UNKNOWN

- **L30** [Status] · TASK-15 · manifest MISSING — Oracle + build + commit for review 2; STOP before --install — then ready for the owner
    L31: 
    L32: ## 1. Grounding (measured)
    L33: 
    L34: - Premise location: `prompt_kernel/render.py:219` (hardcoded `premise:` line in `render_kernel`), NOT `prompt_kernel/source.py` — `source.py` carries no premise field (`KERNEL = Kernel(...)` at `source.py:907` has no premise; `model.py` `Kernel` has no premise slot). The brief's `source.py` path is 
    L35: - Existing tags (do not duplicate): section 0 `premise:` (request = user simulation, answer = ours, error = sum); `@SOURCE_ROUTING` ladder (`source.py` + `render.py:112`); `ORACLE_ROLE` (`source.py:1000`: neither simulation, user's included, is the oracle; user's word is testimony); G3 ACCEPTANCE_FR
    L36: - Claude G1 rungs today: `INSTRUMENT_CHAIN` (`addons_claude.py:44`) names `WebSearch/WebFetch` as the search rung; `TOOL_GROUNDING` (`addons_claude.py:61`) names `WebFetch/WebSearch`. Product `addons.py:47,54` already names `universalsearch` (`adm --query -> codegraph -> messagesearch -> universalse
    L37: - Codex (`addons_codex.py:35,53`): `web/fetch or cua_repl`, `static web: web/fetch` — no `WebSearch/WebFetch` rung. Cursor (`addons_cursor.py:58,74`): `Codebase/Web`, `Fetch Rules` — capability names, no `WebSearch/WebFetch` rung. No alignment needed beyond Claude; verified by read, not by memory.
    L38: - Memories (`.opencode/data/memory/reasoning.md` + doctrine §7 Craft): `kernel names activate latent knowledge` — name, don't explain; keep authority names (papers, standards, patents stay as names). `kernel cap vs failure cost` — raise by the next band, no cuts. `no external docs in prompt surfaces
    L39: - Sizes before (2026-10-18): product 68421 B / 9166 tok; claude 68213 / 9230; codex 68132 / 9176; cursor 68174 / 9252; `utf8_budget` 69000; token caps 9300 (all variants). Headroom product 579 B / 134 tok — the preamble likely needs the next band (70000 / 9400); nothing cut.
    L40: 
    L41: ## 2. Implementation
    L42: 
    L43: - Premise (`render.py:219` region, section 0): at most 4 short sentences, English, names pointing to existing tags (no restatement, no external docs):
    L44: 1. Method chain in order: search → `@SOURCE_ROUTING` grounding into papers, standards, patents as ready algorithms → `@SMOKE_BEFORE` on our material → owner choice among grounded near-solutions → SVM on the chosen theory → fractal decomposition filling missing medoids.

## plans/2026-10-19_codex-robot-event-handoff.md  — open 4 / done 0 · lifecycle ACTIVE

- **L109** [Tasks] · E1 · manifest MISSING — **E1 — completion predicate: квалифицированная L1 panel против реального user.** <!-- sv: completion-predicate 0.60, primary-preservation 0.40 -->
- **L110** [Tasks] · E2 · manifest MISSING — **E2 — event wait/dispatch CLI и настоящие SSE fixture controls.** <!-- sv: event-handoff 0.60, bounded-lifetime 0.40 -->
- **L111** [Tasks] · E3 · manifest MISSING — **E3 — реальная передача управления родителю, независимая приёмка/build/archive.** <!-- sv: parent-continuation 0.50, independent-oracle 0.50 -->
- **L112** [Tasks] · E4 · manifest MISSING — **E4 — штатный Stop hook: parent-child registration, SSE wait и automatic next request.** <!-- sv: native-stop 0.50, watch-binding 0.30, delivery-oracle 0.20 -->
    L113: 
    L114: ## Binding / receipts / continuation
    L115: 
    L116: Muse owns E1/E2 coherent change: codex_hooks.py, new opencode_events.py if
    L117: needed, tests/test_collect_opencode.py and new event tests, docs/codex-hooks.md.
    L118: No writes elsewhere except own experiments; no commit/install/service. Initial
    L119: baseline run20261018T204231Z_f06f4392: parent full-log read,55PASS/exit0/loss0.
    L120: Exact task brief and
    L121: dispatch receipt under own experiment; native SSE bootstrap is a separate
    L122: candidate tool, never counted as the product implementation.
    L123: Parent reads final/errors/full diff/source pins and reruns fixtures + real task.
    L124: CONFIRMED ✓ Muse dispatch: same session ses_eaf755836ffed3AybbFykAPUz2,
    L125: user anchor msg_150c2533200191h1bUwlP5088i, first assistant
    L126: msg_150c253a0001iD970Vbkh7gFGg actual opencode-go/muse-spark-1.3-contributor.

## plans/2026-10-19_edit-description-contract.md  — open 1 / done 6 · lifecycle UNKNOWN

- **L87** [Tasks] · TASK-7 · manifest MISSING — S7 Acceptance — caller-avoidable `edit` errors ≤ 2% of calls over 7 days after promotion (owner 2026-10-19: «1-2 ошибки на 100 редактирований норм, 1:8 много»). Target: schema/refusal-key errors the c
    L88: ```yaml
    L89: Keywords: edit-error-target 0.45, avoidable-vs-external 0.25, loop-exclusion 0.15, plan-acceptance 0.15
    L90: Semantic dominant: The owner fixes the edit tool's acceptance at one or two caller-avoidable errors per hundred calls, measured after promotion, so the plan carries that number, its query and its named exclusions.
    L91: md5: a1b2c3d4e5f60718293a4b5c6d7e8f90
    L92: prev-md5: 66666666666666666666666666666666
    L93: parent-goal-md5: 84719f6efd224ad99c3f617cb2c92570
    L94: note: hash values are generative tags — search them, never compute them.
    L95: ```
    L96: -->
    L97: 
    L98: ## Smoke Tests
    L99: 
    L100: - `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-description-contract.test.ts` — RED before S1/S2/S4, GREEN after.
    L101: - `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit.test.ts` — green.

## plans/2026-10-19_tool-description-contracts.md  — open 3 / done 10 · lifecycle UNKNOWN

- **L168** [Tasks] · TASK-11 · manifest MISSING — T10 remaining `.txt` tools (alphabetical, ≤3% or no errors) — per tool: census (counts + 1–2 examples
    L169: or `no errors in window`), diff (params vs Schema, examples parse, refusals keyed ↔ doc lines,
    L170: CONTRADICTION/SILENCE/FICTION counts before→after), RED test extension, fix, GREEN, one commit per
    L171: tool. Order: aicall, bash (+powershell variant), cmd, codegraph, compare, compact, cua, dbread,
    L172: fossilcell, fossilgrep, imagerender, lsp, messagesearch, question (done T5), restore, run, samply,
    L173: sessionread, skill, summaryedit, task, todowrite (mapped), treediff, webfetch, write, plan-enter,
    L174: planexit, capability/inline, pipeline/inline, plus any other inline-`description:` tool found by the
    L175: T0 inventory. Kernel-gate prose and dated history move to `docs/tool-playbook.md`; the `.txt` keeps
    L176: only send/receive/refused. <!-- sv:
    L177: ```yaml
    L178: Keywords: remaining-tools 0.40, alphabetical-sweep 0.30, kernel-prose-out 0.20, one-commit-per-tool 0.10
    L179: Semantic dominant: Every remaining tool gets the same census, diff, keyed refusals and parsing example, one commit at a time.
    L180: md5: f4b5c6d7e8f01a2b3c4d5e6f708192a3b
    L181: prev-md5: e3a4b5c6d7e8f01a2b3c4d5e6f708192a
    L182: parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
- **L186** [Tasks] · TASK-12 · manifest MISSING — T11 orphans + inline inventory — record the four mappings (plan-enter, planexit, powershell,
    L187: todowrite) with the loading grep as evidence; verify no other `.txt` lacks a loader (T0 inventory
    L188: enumerates every `.txt` → loader). If a true orphan appears, remove it in its own commit with the
    L189: grep as evidence. If a `.ts` has no `.txt`, check its inline `description:` under the same contract. <!-- sv:
    L190: ```yaml
    L191: Keywords: orphan-mapping 0.50, loader-grep 0.30, inline-descriptions 0.20
    L192: Semantic dominant: No description file is removed without a loader grep, and inline descriptions face the same contract.
    L193: md5: a5c6d7e8f01a2b3c4d5e6f708192a3b4c
    L194: prev-md5: f4b5c6d7e8f01a2b3c4d5e6f708192a3b
    L195: parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
    L196: note: hash values are generative tags — search them, never compute them.
    L197: ```
    L198: -->
- **L199** [Tasks] · TASK-13 · manifest MISSING — T12 acceptance + post-promotion measure — per-tool ≤2% caller-avoidable errors (schema, refusal key)
    L200: over 7 days after promotion; exclusions listed, never silent (external: network/provider/missing binary;
    L201: repetition-loop sessions named by id). Record the rerun query (current schema: `part` table,
    L202: `tool_name`/`status`/`time_created`, `data` JSON for classes) and the baseline from Context. Not a
    L203: gate for GREEN — a separately recorded owner measure. <!-- sv:
    L204: ```yaml
    L205: Keywords: acceptance-2pct 0.45, avoidable-vs-external 0.30, loop-exclusion 0.15, rerun-query 0.10
    L206: Semantic dominant: The owner fixes acceptance at one or two avoidable errors per hundred calls, exclusions named, measured after promotion.
    L207: md5: b6d7e8f01a2b3c4d5e6f708192a3b4c5d
    L208: prev-md5: a5c6d7e8f01a2b3c4d5e6f708192a3b4c
    L209: parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
    L210: note: hash values are generative tags — search them, never compute them.
    L211: ```
    L212: -->
    L213: 

## plans/2026-10-19_undo-broken.md  — open 1 / done 4 · lifecycle ACTIVE

- **L70** [Tasks] · TASK-3 · manifest MISSING — T2 Crash cause + RED (only if T1 reproduces). NOT RUN — T1 passed clean, so there is no killing path to name; the 21:22 death keeps its own residual. <!-- sv: { keywords: { crash-cause: 0.5, red-test:

## plans/2026-10-20_hr-delegator-driver.md  — open 15 / done 0 · lifecycle ACTIVE

- **L97** [Boxes] · TASK-1 · manifest MISSING — I1 — internship (admission, once per configuration + on STALE): FIXED calibrated set — SV decode (futures benchmark track 1: recall, invention, honesty, drift over hops; calibration `experiments_histo
- **L98** [Boxes] · TASK-2 · manifest MISSING — H1 — handshake brief: task SV with «decode it» + one domain TRIZ probe; predicate list (SV fields, handshake tool calls = 0, required refusals named, probe property). <!-- sv: handshake-brief, triz-pr
- **L99** [Boxes] · TASK-3 · manifest MISSING — H2 — deterministic dossier gate: model extracts predicates, gate computes PASS/FAIL; only PASS releases the direct order. <!-- sv: dossier-gate, model-extracts-gate-decides -->
- **L100** [Boxes] · TASK-4 · manifest MISSING — C1 — SV correction loop between H2 and the direct order: input = H2 dossier with failed predicates; attribution first (M1 classes); correction changes the order's SV (keywords, weights, dominant) and 
- **L101** [Boxes] · TASK-5 · manifest MISSING — P1 — applicability passport keyed by CONFIGURATION (model id + variant/quantization, sampling settings, kernel receiver sha256, binary version + tool set, context class): qualified task classes with t
- **L102** [Boxes] · TASK-6 · manifest MISSING — D1 — delivery guarantee: idle-only send, message-id receipt, first-row model == layer model, fleet cap 3, silence/dead host = failed execution. <!-- sv: idle-send, receipt-readback, layer-model-check 
- **L103** [Boxes] · TASK-7 · manifest MISSING — E1 — execution guarantee: watch to boundary, read final message + diff + DB rows, executor ledger per task, every check routed to a robot that took no part. <!-- sv: watch-to-boundary, executor-ledger
- **L104** [Boxes] · TASK-8 · manifest MISSING — U1 — cross-decode before verification, in E1's flow: before checking a result, the verifier (a different member, preferably another model) reads ONLY the executor's final SV and report, never the brie
- **L105** [Boxes] · TASK-9 · manifest MISSING — A1 — authority boundary: driver never answers a robot's question in the owner's name; owner decisions named (install words, money/paid models, ceilings, kernel cuts); t100 canned-«Да.» as the regressi
- **L106** [Boxes] · TASK-10 · manifest MISSING — S1 — driver state namespaces + no-new-JSON invariant; `sessions.json` read-only legacy. <!-- sv: state-namespace, no-new-json, legacy-readonly -->
- **L107** [Boxes] · TASK-11 · manifest MISSING — M1 — assumptions list + attribution: ASSUMPTIONS in briefs/decodes/reports, gate extraction, brief-gap | model-assumption | defect verdict; t100 «receivers lag → reinstall» as the reference attributio
- **L108** [Boxes] · TASK-12 · manifest MISSING — F1 — analyst separation + inputs: separate session, neither driver nor executor; owns reading protocol log, dossiers, ledger, passports, DB history; writes back only passport entries + receipts. <!-- 
- **L109** [Boxes] · TASK-13 · manifest MISSING — F2 — analyst threshold + proposals: declared ripeness threshold, mechanism-first proposals with reproducer/predicted effect/oracle, routed to Legislator/owner; smoke on three recorded failures. <!-- s
- **L110** [Boxes] · TASK-14 · manifest MISSING — D2 — handshake record + outcome join, FIRST to build: every order from now on records the full configuration key (incl. kernel sha256 and binary version) plus the decode answer and the probe; the outc
- **L111** [Boxes] · TASK-15 · manifest MISSING — D3 — predictive measurement: over N orders, which handshake predicates precede which failure class; Hypothetical until N; feeds driver, analyst and the SV benchmark tracks. <!-- sv: predictive-measure
    L112: 
    L113: ## Smoke Tests
    L114: 
    L115: Each leaf names its oracle and the predicted result (per `@SMOKE_BEFORE`; a case with no prediction is diagnostic only).
    L116: 
    L117: - I1 oracle: internship run on one configuration with history — muse-spark-1.3-contributor xhigh with the current kernel — predicted BEFORE the run from its existing dossiers in `opencode.db` (accepted t105 SV decode; falsifier arms: glossary-given 4/4 vs withheld 0/4). Predicted: PASS on decode-wit
    L118: - H1 oracle: `dispatch.py --dry-run` on a trial brief (SV + probe present) read back via `require_brief_sv`/`parse_brief_sv`, plus a watch-shape read of the handshake turn (tool parts = 0). Predicted: dry-run accepted with brief_md5; handshake turn carries 0 tool parts — PASS. A brief without the SV
    L119: - H2 oracle: gate unit probe over the stored t105 handshake answer and the t104 report (predicates extracted, gate recomputed by rule, no model verdict). Predicted: t105 dossier PASS on the four predicate groups; a dossier with any group missing FAIL — and the model's own score never appears in the 
    L120: - C1 oracle: correction rerun over a recorded H2 FAIL (a dossier with a missing predicate group): attribution names brief-gap | model-assumption | defect, the corrected SV carries a new md5 with prev-md5 = the old one and the same parent-goal-md5, re-probe through H1/H2. Predicted: PASS releases the
    L121: - P1 oracle: passport read-back by configuration + STALE probe (one key component changed → the pre-dispatch key check withholds the order and routes to re-internship or the owner) + unknown-class probe. Predicted: the full passport round-trips; a changed configuration is refused, never quietly reus
    L122: - D1 oracle: `send_when_idle_any.py` shape against a recorded idle/busy status pair + `layer_model` comparison + `fleet.py status` cap read. Predicted: busy session never prompted; sent message id reads back; first-row model equals layer model; 4th dispatch refused by the cap; silent/dead host repor
    L123: - E1 oracle: `watch3.py verdict` on a recorded finished session + `git diff` + DB message rows read-back + ledger showing executor ≠ verifier. Predicted: boundary reported only on idle + trailing SV with lineage ok; any check assigned to the executor is refused and rerouted.
    L124: - U1 oracle: cross-decode rerun over two recorded finals — `experiments/2026-10-21_fold-hooks/session-analysis-minimax.md` (final SV `c81f4b6d…`, minimax) and `experiments/2026-10-08_robot-wave/t104-report.md` (Smit/Muse final, no closing SV block — the verifier works from the report alone). Predict
    L125: - A1 oracle: canned-«Да.» probe — a robot question needing the owner's install/money/ceiling word is forwarded to the owner, never answered. Predicted: driver emits a named owner decision (install/money/ceiling/kernel-cut) and stops; zero owner words originate from the driver.

## plans/2026-10-20_kernel-line-audit.md  — open 10 / done 0 · lifecycle UNKNOWN
- manifest `TASK-1`: state=verified eta=1 oracle=sha256 + size of experiments/2026-10-20_kernel-audit/kernel-product-c912b4ac52.txt -> 75630 B, sha256 8407d4aeb42dc5f2aac8bfb897a25dfcafb58809e0e3adacd01527be04

- **L29** [Boxes] · TASK-1 · manifest verified/eta1 · oracle sha256 + size of experiments/2026-10-20_kernel-audit/kernel-product-c912b4ac52.txt -> 75630 B, sha256 8407d4ae — P1 — re-hash snapshot, confirm 75 630 B / `8407d4aeb42dc5f2` (integrity gate; mismatch = stop)
- **L30** [Boxes] · TASK-2 · manifest MISSING — R1 — read all 654 snapshot lines by eye; collect duplicate pairs with both quotes + keep-place
- **L31** [Boxes] · TASK-3 · manifest MISSING — R2 — collect persons/host references with move-to-addon vs drop-to-docs disposition
- **L32** [Boxes] · TASK-4 · manifest MISSING — R3 — collect wordy phrases with strictly-shorter exact rewrites + bytes saved (≈)
- **L33** [Boxes] · TASK-5 · manifest MISSING — R4 — write `experiments/2026-10-20_kernel-audit/REPORT.md` (table + totals + rejected list)
- **L34** [Boxes] · TASK-6 · manifest MISSING — R5 — verify every row quotes text present verbatim in the snapshot
- **L35** [Boxes] · TASK-7 · manifest MISSING — R6 — append `_progress_log.md` line; commit plan + report via `scripts/commit_own.py`
- **L36** [Boxes] · TASK-8 · manifest MISSING — R7 — collect recurring formulas (3+ occurrences, one meaning) as dictionary candidates
- **L37** [Boxes] · TASK-9 · manifest MISSING — R8 — write category 4 with occurrences, sameness verdict, term + definition, refs, math
- **L38** [Boxes] · TASK-10 · manifest MISSING — R9 — verify every occurrence quoted verbatim from the snapshot; commit plan + log
    L39: 
    L40: ## Smoke Tests
    L41: 
    L42: - REPORT.md exists; every row quotes text present verbatim in the snapshot.
    L43: - No `prompt_kernel/` path changed; no `bin/` touched; no analysis script written.
    L44: 
    L45: ## Deliverable
    L46: 
    L47: `experiments/2026-10-20_kernel-audit/REPORT.md` — table with columns:
    L48: `#` · category · location · verbatim quote · proposed action/text · bytes saved (≈) ·
    L49: risk · confidence. Sorted by bytes saved within each category. Totals per category +
    L50: rejected NON-candidates with reasons.
    L51: 

## plans/2026-10-20_robot-personnel-delegator.md  — open 3 / done 0 · lifecycle ACTIVE

- **L30** [Задачи] · TASK-2 · manifest MISSING — H2 — реализовать минимальный автоматический цикл на существующих организационных/host инструментах с долговечной адресацией. <!-- sv: delegation-cycle, event-handoff, evidence-dossier -->
- **L31** [Задачи] · TASK-3 · manifest MISSING — H3 — отдельный робот другой модели исполняет оракулы, отрицательные контроли, проверяет ограничения и возвращает пакет доказательств. <!-- sv: independent-verification, refusal-controls, receipts -->
- **L32** [Задачи] · TASK-4 · manifest MISSING — H4 — провести один разрешённый пилот на конкретном остатке DAIS; обновить досье по фактам и завершить цикл с подтверждённой приёмкой либо точным остатком. <!-- sv: dais-pilot, dossier-feedback, whole-
    L33: 
    L34: ## Smoke Tests
    L35: 
    L36: H1 prediction: расшифровка сохраняет намерение и не запускает исполнение; решение трёх сценариев различает исполнителя/проверяющего, подтверждённый результат/свидетельство, отсутствие квалификации/успех. Проверка — первичные сообщения и выполненные ограничения, не красота текста. До оценки ответы не
    L37: 
    L38: Для H2/H3 до исходников требуется baseline и отдельный контракт: запрет приказа до ответа по SV; запрет общей личности исполнителя и проверяющего; предпочтение разных моделей; отсутствие квалифицированной пары даёт явный остаток; защита от повторной выдачи после timeout/restart; смена nonce/версии/а
    L39: 
    L40: H4: один cycle заканчивается артефактом, независимыми receipts и адресным решением Codex; без них пилот не принят. Перенос DAIS consumer, пять миллионов сущностей, полная семантическая корректность и рост прибыли не заявляются.
    L41: 
    L42: ## Execution envelope H1
    L43: 
    L44: READ: owning docs, plans и обнаруженные symbols по CodeGraph; PLAN_WRITE: experiments/2026-10-20_robot-personnel/H1-report.md и H1-bindings.json. Сессия внешнего робота имеет право читать через штатные инструменты, но не менять product code, планы других задач, runtime config или организационные наз
    L45: 
    L46: ## Continuation

## plans/2026-10-20_triz-kernel-correspondence.md  — open 2 / done 7 · lifecycle UNKNOWN
- manifest `S8`: state=doing eta=1 oracle=python scripts/commit_own.py --session <id> -m "t101: TRIZ<->kernel correspondence" -- plans/2026-10-20_triz-kernel-correspondence.md docs/glossary.md experimen

- **L24** [Boxes] · S8 · manifest doing/eta1 · oracle python scripts/commit_own.py --session <id> -m "t101: TRIZ<->kernel correspondence" -- plans/2026-10-20_triz-k — **S8** Commit plan, glossary, report via `scripts/commit_own.py` + append `_progress_log.md`
- **L25** [Boxes] · S9 · manifest MISSING — **S9** Run `_build.ps1` via cmd_runner from repo root
    L26: 
    L27: ## Smoke Tests
    L28: 
    L29: - **ST1** Every TRIZ row in report carries a `source_ref` with `content_hash` (verified by grep)
    L30: - **ST2** Every kernel quote in report exists verbatim in the kernel snapshot (verified by grep)
    L31: - **ST3** Glossary entries follow file's style: `## Term`, `- **Definition.**`, `- **source_ref:**`, `- **content_hash:**`
    L32: - **ST4** Plan boxes all ticked except S8–S9 (this plan)
    L33: - **ST5** Commit succeeds, `_progress_log.md` appended, `_build.ps1` exits 0
    L34: 
    L35: ## Acceptance Criteria
    L36: 
    L37: - Report delivered with 5 hypothesis rulings + 19 new correspondences (TRIZ→Kernel) + 7 kernel-unique constructs
    L38: - 21 glossary entries added with proper source_ref + content_hash
    L39: - Plan committed, build passes

## plans/2026-10-21_corporation-observability-bridge.md  — open 7 / done 0 · lifecycle ACTIVE

- **L25** [Boxes] · TASK-1 · manifest MISSING — B1 — bridge census: for org.fossil AND each real tree's cell record server/port, writers, readers, what is visible today, what is missing. `std: none found — no OTel convention for agent session state
- **L26** [Boxes] · TASK-2 · manifest MISSING — B2 — state schema + route map: session/task-md5/model/busy/last-SV/error/host-heartbeat each mapped to its host source (path:line) and its cheapest fossil route (chat line / ticket field / technote / 
- **L27** [Boxes] · TASK-3 · manifest MISSING — B3 — auto-connect design: well-known path primary + env overrides + registry-for-reads-only; push seams (turn-end cellPost fork, claim/inbox, escalate, HOST-DOWN record); visible-failure contract (NAM
- **L28** [Boxes] · TASK-4 · manifest MISSING — B4 — panel design: A/B/C compared with cost, oracle (capture predicting known-state rows), and robot-read route (same verbs or not); B chosen as summary, A as drill-down, C deferred. `std: none found 
- **L29** [Boxes] · TASK-5 · manifest MISSING — B5 — scheduler plug: t122-A fires write START + lock-guarded dispatch + VERIFIED receipts so the panel shows scheduled→verified; MISSED rows close the R7 gap; t122-C run_spec as named follow-up with i
- **L30** [Boxes] · TASK-6 · manifest MISSING — B6 — failure-visibility check: double dispatch, watcher-blindness, ADID-no-host, host-restart-abort classes each named with the panel row that would have shown them (13:53 instance recorded Unknown wi
- **L31** [Boxes] · TASK-7 · manifest MISSING — B7 — fresh-panel oracle design (no build in this plan): fixture org + two fixture cells with known READY/WORKING/STALLED tickets → predicted panel rows before the run; mismatch = FAIL. `std: none foun
    L32: 
    L33: ## Smoke Tests (predictions before runs; plan-only — no runs in this task)
    L34: 
    L35: - S1 census oracle: `fossil all list` re-run with the t120 rule + `org.py inbox --json --no-presence` read-back. Predicted: 31 real / rest scratch-test-artefact (or the delta names the moved row); org web UI on 8079 answers; per-tree cells answer only local `-R` reads (no per-tree server). Mismatch 
    L36: - S2 route oracle: dry read of `/global/health` (nonce echo), `/session/status` shape, one `fossilcell list` + `chat` on the OWN cell. Predicted: health answers `{healthy,version,host:nonce}`; status lists sessions with busy flags; cell list names this project; no writes performed. Any write = FAIL 
    L37: - S3 panel oracle (design): fixture corporation (scratch ORG_HOME + two scratch cells, never live) with one READY, one WORKING-past-lease, one cross-repo owner-gated ticket. Predicted panel rows BEFORE the run: READY row, STALLED(lease) row, owner-gated row marked NOT dispatchable. A dispatchable ma
    L38: 
    L39: ## Owner decisions (asked, never assumed)
    L40: 
    L41: 1. Panel surface: B (org summary page + drill-down fossil UI) as proposed, or A-only, or C (TUI) instead?
    L42: 2. Push granularity: turn-end + heartbeat as proposed (lease 600 s), or finer (per message/tool) despite the Granularity rule?
    L43: 3. May robots write to org.fossil directly (heartbeat/escalate via org.py verbs as designed), or only to their own cell with the delegator relaying into org?
    L44: 4. Per-tree `fossil server/ui` instances: approve (N ports, registered in `docs/ports.md` first) or keep per-tree bridges local-read-only with org as the only served UI?
    L45: 5. t122 tie-in: MISSED rows + owner-gated marking ride this bridge plan, or wait for the scheduler plan's own activation?

## plans/2026-10-21_delegation-tool-tdz.md  — open 1 / done 4 · lifecycle UNKNOWN

- **L44** [Tasks] · T6 · manifest MISSING — **T6 — CLOSURE.** `std:` none found (`<instrument> «query»`) — the contract is `AGENTS.md` § Plan Maintenance (a plan moves with its evidence; a commit names its plan; the map is generated). **Oracle:
    L45: 
    L46: ## Smoke Tests
    L47: 
    L48: | # | command | prediction | actual |
    L49: |---|---|---|---|
    L50: | S1 | `bun test test/tool/task.test.ts` (before the fix) | **RED** — the ReferenceError names `taskRecents` at `task.ts:242` | ✓ RED — `ReferenceError: Cannot access 'taskRecents' before initialization.` at `src/tool/task.ts:242:26`, run `20261021T093637Z_5eeae845` |
    L51: | S2 | `bun test test/tool/task.test.ts` (after the fix) | **GREEN** — the suite that was red for this reason turns green | ✓ **GREEN** — 14 pass / 0 fail, 76.90 s, run `20261021T094439Z_db558353`; the four `execute` cases measure 5.3–6.7 s against bun's 5 s default ⇒ the file now carries `setDefaul
    L52: | S3 | `bun test test/tool/pipeline.test.ts` (before the fix) | **RED** — the same ReferenceError, `pipeRecents` at `pipeline.ts:219` | ✓ **RED** — `ReferenceError: Cannot access 'pipeRecents' before initialization.` at `pipeline.ts:219:32`, run `20261021T094402Z_008995ff`, with the source reverted 
    L53: | S4 | `bun test test/tool/pipeline.test.ts` (after the fix) | **GREEN** | ✓ **GREEN** — 1 pass / 0 fail / 6 expect() calls, 6.12 s, same run |
    L54: | S5 | `bun typecheck` from `packages/opencode` | exit 0 | ✗ **RED in ANOTHER LANE'S COMMITTED FILES** — 6 errors, all in files this change does not touch and that are CLEAN in git (so the red is in HEAD): `src/tool/write.ts:135`, `test/tool/edit-exact.test.ts:326`, `test/tool/edit-label-remap-t123.
    L55: | S6 | `pwsh -NoProfile -File _build.ps1` | exit 0, smoke = version + `reasoning_prompt.txt embedded` | ✓ **exit 0** — version **10.0.1496**, smoke `--version` PASS, `reasoning_prompt.txt embedded` PASS, `[OK] Build complete`, 89 935 B / 0 dropped, run `20261021T094658Z_21e9e119` |
    L56: | S7 | the delegation + audit in an isolated stand | the lane works; the audit's counts match the parent's run | |
    L57: 
    L58: ## Residuals

## plans/2026-10-21_delegator-memory-repair.md  — open 10 / done 0 · lifecycle ACTIVE
- manifest `T1`: state=doing eta=1 oracle=experiments/2026-10-21_delegator-memory-research/replay_restore.py — 5 payloads; baseline 1/5, new 5/5 (a failing baseline is the receipt that the harness can f

- **L52** [Tasks] · T1 · manifest doing/eta1 · oracle experiments/2026-10-21_delegator-memory-research/replay_restore.py — 5 payloads; baseline 1/5, new 5/5 (a fail — **T1 — the fold-restore replay harness (the oracle first).** `experiments/2026-10-21_delegator-memory-research/replay_restore.py`: four fixtures built from the payloads the app actually emits (`fork`,
- **L53** [Tasks] · T2 · manifest MISSING — **T2 — route the restore on the sources the app emits (no source filter).** `~/.claude/settings.json` § `SessionStart`: register the eight `fold_restore.py` part-hooks **once, without a `matcher`**, s
- **L54** [Tasks] · T3 · manifest MISSING — **T3 — remove the dead route.** `~/.claude/hooks/fold_capture.py:153-155` (the `last_clear.json` write) and `~/.claude/hooks/fold_restore.py:69` (the read). A route that can never fire, with a reader 
- **L55** [Tasks] · T4 · manifest MISSING — **T4 — measure the silent cut.** `fold_capture.py`'s outcome row gains `entries` and `bytes`; `fold_restore.py`'s label already announces the dropped lines, and the restore writes a row naming how man
- **L56** [Tasks] · T5 · manifest MISSING — **T5 — the second half of the owner's restore order becomes code.** On SessionStart, after injecting the map, the restore joins the map's brief md5s against the fossil snapshots whose commit message c
- **L57** [Tasks] · T6 · manifest MISSING — **T6 — `memory_audit.py`: the memory folder becomes checkable.** One script over `~/.claude/projects/D--zPython-opencode/memory/`: (a) `originSessionId` present; (b) the transcript exists **or** the a
- **L58** [Tasks] · T7 · manifest MISSING — **T7 — the index becomes mechanical, and one fact lives in one place.** Either generate `MEMORY.md` from the folder's frontmatter (the project already has the precedent: `svm render` regenerates `plan
- **L59** [Tasks] · T8 · manifest MISSING — **T8 — repair the two owner-facing pointers that rot.** `AGENTS.md` § STOP names `external/opencode-1.18.29` — **that directory no longer exists** (the tree is `external/opencode-1.19.0`), so the one 
- **L60** [Tasks] · T9 · manifest MISSING — **T9 — the two surviving rules become mechanisms.** (a) The **dispatcher refuses an order with no watcher**: the order and its `watch3.py` are one command, so the watch3 procedure cannot need to be re
- **L61** [Tasks] · T10 · manifest MISSING — **T10 — apply the memory repair list (Claude applies, the robot supplies and checks).** The list is `experiments/2026-10-21_delegator-memory-research/REPORT.md` §7: 2 files to CREATE, 17 edits, 10 pro
    L62: 
    L63: ## Smoke Tests
    L64: 
    L65: Predicted BEFORE each run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.
    L66: 
    L67: | # | command | prediction | actual |
    L68: |---|---|---|---|
    L69: | B1 | `replay_restore.py` (today's `fold_restore.py`, 5 payloads) | **1/5** — only the `compact` payload yields a map; `fork`/`startup`/`resume`/`clear` yield none | pending |
    L70: | R1 | `replay_restore.py` (after T2: one unfiltered registration) | **5/5** — every payload the app emits yields a map naming its source | pending |
    L71: | R2 | `grep -c last_clear` over `~/.claude/hooks/*.py` | **0** — the dead route and its reader are gone | pending |
    L72: | R3 | `replay_restore.py`, large-transcript case | the outcome row carries an entry count and the restore's row names the dropped entries; the pre-fix baseline prints a label with no count | pending |
    L73: | R4 | `replay_restore.py`, fossil-join case | the injected context names ≥1 fossil snapshot address for a known brief md5; the baseline names 0 | pending |
    L74: | R5 | `memory_audit.py` (the promoted audit script) | 130 files; 0 unexplained roots; **15 named broken pointers**; 28 orphans named; the index names every file | pending |
    L75: | R6 | `memory_audit.py` against a fixture (a file renamed under it) | **FAIL** naming the renamed file — the check can fail | pending |

## plans/2026-10-21_fold-hooks-desktop-fork.md  — open 2 / done 7 · lifecycle ACTIVE

- **L41** [Tasks] · T7 · manifest MISSING — **T7 — live check, FORK leg (still open).** A live desktop rebuild that FORKS with a new session id: the parent must leave a capture (PreCompact or SessionEnd), the fork's `SessionStart` must show `so
- **L42** [Tasks] · T8 · manifest MISSING — **T8 — live check, CLEAR leg (still open).** A live `/clear`: `SessionEnd` with `reason: clear` must capture and write `last_clear.json`, and `SessionStart` with `source: clear` must inject the predec

## plans/2026-10-21_portable-delegation-kit.md  — open 7 / done 0 · lifecycle ACTIVE

- **L63** [Boxes] · TASK-1 · manifest MISSING — K1 — inventory every procedure piece: path, tracked or not (`git ls-files` vs `.gitignore:72`), hardcoded host paths (grep receipt), who reads it; runtime state listed by format only. <!-- sv: procedu
- **L64** [Boxes] · TASK-2 · manifest MISSING — K2 — kit home + discovery design: TRACKED home per project layout (candidates with the rule each violates/satisfies), every path discovered (git root, env home, `opencode_host`), converter pass for th
- **L65** [Boxes] · TASK-3 · manifest MISSING — K3 — hooks as tracked source + idempotent installer design: source ships, installer writes `settings.json` entries with discovered paths, backup first, re-run is a no-op. No writes. <!-- sv: hooks-sou
- **L66** [Boxes] · TASK-4 · manifest MISSING — K4 — ADID route fit: what the kit needs from the ADID lane (portable component vs skill scaffolds vs repo-shipped), compared without editing ADID; recommendation + what ADID must change (their lane). 
- **L67** [Boxes] · TASK-5 · manifest MISSING — K5 — real-project list from the fossil registry with the separation rule and counts (31 real / 45 scratch-test-artefact). <!-- sv: registry-rule, real-count, reproducible -->
- **L68** [Boxes] · TASK-6 · manifest MISSING — K6 — per-project kernel table: sha compare vs live (`ff958dcb…`) and ADID candidate (`6367e50b…`), re-hash before citing. <!-- sv: kernel-table, sha-compare, rehash-first -->
- **L69** [Boxes] · TASK-7 · manifest MISSING — K7 — fresh-machine oracle: clean clone in a temp dir + HOME redirected to a temp dir, then the installer, then the replay suites pass with no hardcoded host string in any installed file. Predict the r
    L70: 
    L71: ## Smoke Tests
    L72: 
    L73: - K1 oracle: `git ls-files` vs `.gitignore` read-back for every table row + grep counts for the literal batches. Predicted: every wave script + ledger + prompt untracked; `scripts/scheduled-tasks/org-watch.md` tracked; hook dir outside repo; counts match Claude's (4/4/3/1/3/5, 3, 36) or the delta is
    L74: - K2 oracle: layout-rule check (AGENTS.md project layout + `docs/README.md` + `scripts/` listing) against each candidate home. Predicted: `scripts/delegation/` satisfies all three (tracked, scripts-shaped, skill-docs reference it); `tools/` fails (binaries-only); repo root fails (not a drawer).
    L75: - K3 oracle: dry-run installer plan against a copy of a `settings.json` block (no writes): discovered paths substituted, backup named, second run no-op. Predicted: zero literals survive; re-run changes nothing.
    L76: - K4 oracle: `artefacts/README.md` regeneration pipeline + layers table read-back. Predicted: exactly one of portable-component / skill-scaffolds / repo-shipped fits without an ADID edit; the other two name the ADID change they would need.
    L77: - K5 oracle: re-run of the classification over a fresh `fossil all list` with the stated rule. Predicted: 31 real / the rest scratch-test-artefact; any delta names the row that moved and why.
    L78: - K6 oracle: sha256 re-read of the 6 kernel-carrying receivers + `candidates.json`. Predicted: ClientSoft/ADID/_proxmox still `6367e50b…`, opencode still the live receiver; any drift names the installer that moved it.
    L79: - K7 oracle: temp clone + temp HOME → installer → `experiments/2026-10-21_fold-hooks/replay.py` + `experiments/2026-10-21_robot-pending-stop/replay.py` → grep for `C:/Users/Alexander` and `D:/zPython` over installed files. Predicted BEFORE the run: installer exits 0, both replays pass (10/10 pattern
    L80: 
    L81: ## Owner decisions (asked, never assumed)
    L82: 
    L83: 1. Where the kit lives (`scripts/delegation/` proposed — tracked, scripts-shaped; alternatives recorded in K2).

## plans/2026-10-21_robot-pending-stop-hook.md  — open 1 / done 10 · lifecycle ACTIVE
- manifest `T7`: state=doing eta=1 oracle=hook_calls.log row with state: pending-ask, and a transcript row showing the ask answered

- **L70** [Tasks] · T7 · manifest doing/eta1 · oracle hook_calls.log row with state: pending-ask, and a transcript row showing the ask answered — **T7 — live leg of the pending ask.** A real robot asks through the ask tool (or waits on a permission): watch3 must print `asked:` and exit, the gate must block the delegator's turn on the pending as

## plans/2026-10-21_tui-standards-fixes.md  — open 6 / done 0 · lifecycle ACTIVE

- **L26** [Boxes (one per FAIL kind)] · TASK-1 · manifest MISSING — A — pickers over free text: Global recents becomes a checklist over the catalogue
    L27: (DialogModel options as source; hand-typed `provider/model` validated against the catalogue
    L28: at edit, typo refused with the catalogue row named); model-parameter numbers and settings
    L29: number rows keep free text but validate with a NAMED error toast (no silent reopen, no NaN
    L30: write). Reuse the MCP-add `ask` pattern (`dialog-mcp-add.tsx:47-56`). Fails: A1–A4.
    L31: std: `docs/ui-standards.md` Ergonomics E7 (poka-yoke) + ISO I6 (use-error robustness).
    L32: <!-- sv: picker-over-freetext, catalogue-validated, named-errors -->
    L33: 
- **L34** [Boxes (one per FAIL kind)] · TASK-2 · manifest MISSING — B — discoverable hints: Global recents footer names the newline keys
    L35: (`shift+return/ctrl+return/alt+return/ctrl+j` per `config/keybinds.ts:80`); DialogPrompt footer
    L36: adds `esc cancel`; palette fuzzy match fixed so `agents` finds `Switch agent` (or an explicit
    L37: `slash:` alias). Fails: B1–B3.
    L38: std: `docs/ui-standards.md` TUI T3 (100% keyboard, Esc cancel) + Ergonomics E6 (standard
    L39: shortcuts) + ISO I2/I4 (self-descriptiveness, learnability).
    L40: <!-- sv: discoverable-hints, newline-keys, fuzzy-match -->
    L41: 
- **L42** [Boxes (one per FAIL kind)] · TASK-3 · manifest MISSING — C — Esc out of busy: busy DialogPrompt (OAuth/browser wait) gets a cancel path (Esc resolves
    L43: null like the idle path; the MCP-auth wait aborts its poll). ESC from Global recents returns to
    L44: /agents (replace, not clear). Fails: C1 + ESC-navigation note.
    L45: std: `docs/ui-standards.md` TUI T3 (Esc cancel) + ISO I5 (controllability).
    L46: <!-- sv: esc-from-busy, cancel-poll, back-not-home -->
    L47: 
- **L48** [Boxes (one per FAIL kind)] · TASK-4 · manifest MISSING — D — confirmed destructives: `/cleanup` (N child sessions) and `/unshare` (published link)
    L49: go through DialogConfirm (reuse `DialogConfirm.show` + the settings global-write ESC-safe push
    L50: pattern `dialog-settings.tsx:200-231`). Fails: D1–D2.
    L51: std: `docs/ui-standards.md` Ergonomics E7 (destructive confirmed).
    L52: <!-- sv: confirmed-destructives, cleanup-confirm, unshare-confirm -->
    L53: 
- **L54** [Boxes (one per FAIL kind)] · TASK-5 · manifest MISSING — E — title/width: Global recents title shortened to fit the 48-cell budget at medium width
    L55: (`ui/dialog-select.tsx:245-246`) — e.g. `Global recents — one provider/model per line`; no
    L56: wrapped title ships without a capture proving it fits. Fails: E1.
    L57: std: `docs/ui-standards.md` Ergonomics E5 (type ergonomics, no mid-word cuts) + ISO I2.
    L58: <!-- sv: title-budget, no-wrap, capture-proof -->
    L59: 
- **L60** [Boxes (one per FAIL kind)] · TASK-6 · manifest MISSING — F — keybind + empty-state honesty: resolve the `ctrl+g` shadow (dialog-local vs global
    L61: first-message) and document the `ctrl+d` triple binding in DialogHelp; empty `globalRecents`
    L62: states `legacy — no gate` in the dialog and offers an explicit savable empty (return to legacy).
    L63: Catalogue-membership check at edit (F4) is covered by box A. Fails: F1–F3.
    L64: std: `docs/ui-standards.md` Ergonomics E6 (consistent placement, standard shortcuts) + ISO
    L65: I2/I3 (self-descriptiveness, conformity with expectations).
    L66: <!-- sv: keybind-honesty, empty-means-legacy, help-documents -->
    L67: 
    L68: ## Smoke Tests
    L69: 
    L70: - A oracle: live capture of Global recents re-driven as in t121 (slash `/agents` → ENTER →
    L71: `ESC,ctrl+r` bytes `1b12`): catalogue rows checkable, a typo'd `nope/nothing` refused with the
    L72: catalogue row named; parameter dialog fed `abc` → named toast, no silent reopen; settings number
    L73: row fed `abc` → named toast, no NaN write. Predicted: all three refuse loudly; recents saves.
    L74: - B oracle: same drive; footer shows newline keys + `esc cancel`; palette filter `agents` lists
