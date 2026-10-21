<!-- intention: TUI undo applies on the server but the TUI loses its server -> isolated dist-TUI reproducer decides whether the revert path kills the process, and the proven dialog-anchor and preserve-foreign defects land with regression tests -->
<!-- goal_sv: { keywords: { tui-disconnect: 0.30, revert-applies: 0.25, isolated-dist-repro: 0.20, dialog-anchor: 0.15, preserve-foreign: 0.10 }, dominant: Isolated dist TUI decides whether undo kills the process; proven dialog and scope defects land with tests. } -->
# t98 — undo applies, the TUI loses its server (STABILIZE, re-scoped by owner 2026-10-19)

State: ACTIVE. Owner redirect 2026-10-19: «undo как оказалось происходит но отваливается сама TUI от сервера. Если
перезапустить сессию там уже undo есть.» The revert path is probably fine; the defect is the TUI losing its
server (process exits, event stream breaks, or client crashes) on undo / revert-to-message.
Bounds: steps 60, tools 150, loops 2, depth 2, time 3 600 000 ms. No `bin/`. No undo or revert in
`D:\zPython\opencode` itself — on this defect the process dies and takes the robots with it.

```yaml
Keywords: tui-server-disconnect 0.40, revert-succeeds-server-side 0.25, host-death-correlation 0.20, reproducer-rescope 0.15
Semantic dominant: The owner found that undo does apply on the server while the TUI drops its connection, and a restarted session shows the undo done, so the defect is the TUI's link or process dying on the revert event, probably the same event that killed the robot host at 21:22, and the reproducer is re-scoped to that.
md5: 3a8e61c0f5d24b97e1c0a2d38b7f45e9
prev-md5: 9f244cff8cba4d55ba95e37780443314
parent-goal-md5: 9f244cff8cba4d55ba95e37780443314
note: hash values are generative tags — search them, never compute them.
```

## Grounding (G1, from disk 2026-10-19, post-restart)

- Dead host run `20261019T035158Z_d7c6fc50` (`C:\Windows\logs\cmd_runner\…`): launched
  `D:\zPython\opencode\bin\opencode.exe` (owner TUI, cwd repo root, wt terminal). `state.json` still
  `running`, `exit_code: null` — process died with no final write. `inbox.jsonl` EMPTY (owner drove by
  keyboard/mouse directly, no bridged input). `in.log` 521 lines: keyboard bursts at 03:52:07Z, then
  ONLY `console_mouse` at 11:30:52Z and 13:22:25Z (= 21:22 local, death). Last input = mouse. Bytes are
  opaque counts (`decoded:false`), so no key/click is identifiable. Correlation "undo killed it" is
  UNCONFIRMED by this instrument: a mouse-driven dialog-Revert is plausible, a dozen other clicks are
  not excluded. Direct-terminal captures no pixels by design — that blindness is the instrument gap.
  ✓ CONFIRMED (read).
- Shared DB forensics (dbread, read-only): `session.revert` is NULL on every row — no active undo
  anywhere (an applied undo followed by a new prompt clears it, so this neither confirms nor refutes a
  21:22 undo). Latest messages belong to robot sessions t94/t98; no owner session with fresh activity.
  Server file logs name no revert/unrevert errors today. ✓ CONFIRMED (dbread/logsearch).
- Proven defect D1 (dialog-vs-server contract): the server folds an assistant target back to its parent
  user (`revert.ts:66-75`, pinned by `revert-user-anchor.test.ts`), while the 10-14 confirmed handler
  (`session-revert.ts:15`) demands `revert.messageID === input.messageID`. Every dialog-Revert on an
  assistant row throws on a 200 that did the right thing. Full-stack RED (wire carried the assistant id)
  → GREEN after F1. ✓ CONFIRMED (harness oracle).
- Proven defect D2 (concurrent over-revert): service probe showed session-1 undo deleting session-2's
  disjoint file (`bAfter: (missing)`) and clobbering its same-file edit. Full-leaf checkout by design.
  Service RED → GREEN after F2 (preserve-foreign + scoped drift oracle). ✓ CONFIRMED (bun oracle).
- Last oracle re-ran GREEN after the restart: `revert-user-anchor.test.ts` 2 pass / 0 fail, exit 0
  (run `20261019T133720Z_a5ac49b8`, finished before the death). ✓ CONFIRMED (state.json + log).

## Hypotheses (re-ranked by the redirect; correlation status marked)

- H5 TUI-disconnect-on-revert (tier 2, PRIME per owner observation): the revert applies; the TUI then
  drops its server (process death, stream break, or client crash on the revert event). Falsifier: the
  isolated dist-TUI reproducer below — process alive + frame + server readback after /undo and after
  dialog-Revert. Correlation with the 21:22 host death is UNCONFIRMED (mouse-only dead-run tail).
- D1 dialog anchor (proven, fixed F1): kept, not a hypothesis anymore. Control: all pre-existing
  revert suites stay green (session-revert 1/56, request 6/23, user-anchor 2/5, steps/reverted-run).
- D2 concurrent scope (proven, fixed F2): kept. Residual: same-file write-write conflict follows undo
  semantics (pre-turn state wins); deleted-by-other resurrection noted, not handled.
- H1 leaves / H3 bin-regression / H4 checkout-close: folded into H5's falsifier (the dist reproducer
  runs on 2-leaf-capable fossil and the current dist build). H3-on-four-files stays REFUTED (git log).

## Tasks

- [x] T0 Proven defects D1 + D2: RED→GREEN with receipts (scope 1 fail→2 pass; anchor 4/0; assistant
  harness 1 fail→1 pass/13 expects). ← done pre-restart, receipts in `logs/cmd_runner/20261019T13*`.
  <!-- sv: { keywords: { red-green: 0.5, receipt: 0.5 }, dominant: Two proven defects redden then green through real stacks. } -->
- [x] T1 Isolated dist-TUI crash reproducer (no shared-tree undo, no LLM needed). Seed a session in
  `.temp/t98-dist/` via a source-service seed script (session + user/assistant + patch part + fossil
  leaves; verifiable by read-back), launch `dist\bin\opencode.exe` TUI there through cmd_runner, run
  `/undo` (inbox keys) and dialog-Revert, observe: process alive (`state.json`), fresh frame, event
  stream, server readback (DB `revert`, file content). Prediction per H5: the process dies or the
  stream breaks; a clean pass FALSIFIES the crash on this path. <!-- sv: { keywords: { dist-repro: 0.6, crash-or-clean: 0.4 }, dominant: Isolated dist TUI shows whether undo kills the process. } -->
- [x] T2 Crash cause + RED — **CLOSED 2026-10-22 (t135), class (d): the condition never held, so nothing was owed.** T1 passed clean (this plan's own S-T1 result, 2026-10-19: «clean pass — undo applied (DB revert set, file BEFORE), redo applied (revert null, file AFTER), process alive throughout; H5 falsified on this path/build»), so there was no killing path to name and no RED to write. Receipt: commit `b38d45e5ce` («t98 undo: dialog anchor + preserve-foreign fixes, RED-GREEN suites, dist crash falsified») + the S-T1 line in this plan's Smoke Tests. The 21:22 death keeps its own residual, exactly as this box said. <!-- sv: { keywords: { crash-cause: 0.5, red-test: 0.5 }, dominant: The killing path is named and reddens a test. } -->
- [x] T3 Fix + GREEN (T1-crash if reproduced; F1/F2 already green). Undo applies, TUI stays connected,
  process stays alive. <!-- sv: { keywords: { fix: 0.5, green: 0.5 }, dominant: Undo applies and the TUI stays connected. } -->
- [x] T4 Oracles + close. `bun typecheck`, `_build.ps1`, dist smoke (T1 doubled as smoke when green),
  commit own paths via `commit_own.py`, progress-log line, report «Измерено/Не измерено». Promotion to
  bin is the owner's word. This plan stays unmapped in MASTER_PLAN (render would touch the shared map
  two robots own work in) — explicit residual, not a verdict. <!-- sv: { keywords: { oracles: 0.5, closure: 0.5 }, dominant: Typecheck, build and dist smoke close the work. } -->

## Smoke Tests

- S-T1 (prediction): seeded dist TUI stays alive through /undo and dialog-Revert; if H5 holds, the process dies or the stream breaks exactly on the revert event (receipts: state.json, frame, DB/file readback). A clean pass falsifies the crash on this path — recorded as falsification, not failure. RESULT 2026-10-19: clean pass — undo applied (DB revert set, file BEFORE), redo applied (revert null, file AFTER), process alive throughout; H5 falsified on this path/build.
- S-T3: RED→GREEN on the killing path (if any); F1/F2 suites stay green (listed above).
- S-T4: `bun typecheck` exit 0; `_build.ps1` exit 0; dist smoke = T1 green.

## Claims, risks, rollback

- C1 (proven): dialog-Revert on any assistant row failed before F1; concurrent undo destroyed foreign
  files before F2. Falsifiers ran as RED suites.
- C2 (FALSIFIED on the dist path 2026-10-19): the undo+redo cycle in the isolated dist TUI applied cleanly and the process stayed alive (run 20261019T135122Z_5a0207bf). The 21:22 death is NOT explained by this path and keeps its own residual.
- R1: NEVER undo/revert in `D:\zPython\opencode` (process death takes the robots); verify the copy
  (`Global.Path.home` = the copy) before any undo. R2: own paths only, never bare commit; index.lock →
  wait 5 s. R3: one file per test call. R4: `bin/` never touched/launched; dist only. R5: no provider
  keys into the isolated copy (no LLM there by design). Rollback: scoped revert of own paths only.

## PORTFOLIO_AUDIT

Not run — bounded STABILIZE repair. Residuals: 151 open boxes / 43 plans; this plan unmapped (render
would touch the shared map); same-file write-write conflict; deleted-by-other resurrection;
direct-terminal blindness (no pixels); dead-run mouse bytes undecodable.
@PLAN_STRATEGY: supports master-goal mechanical-state/proof-not-claim/turn-loop-first — an undo that
applies must leave the TUI connected, or say why loudly.
