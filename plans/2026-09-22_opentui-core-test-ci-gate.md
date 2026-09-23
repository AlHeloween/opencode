<!-- intention: two opentui plans close their defect but not their gate — packages/opentui/packages/core declares no test:ci, so CI (bun turbo test:ci) never runs it and 88 failures accumulated unseen -> the package carries an armed gate, and the pre-existing reds it would light are triaged first -->

# `test:ci` for `packages/opentui/packages/core` — arm the gate after triage

Both plans that ended here say the same thing in different words:

- `plans_completed/2026-09-17_markdown-renderer-repair.md`: «Only when green: give the package a
  `test:ci` so it stays green — that, and not the fix, is what stops the next regression. Nothing runs
  this package today, which is how 88 failures accumulated unseen.»
- `plans_completed/2026-09-17_opentui-audio-stream-stubs.md`: «Arming the gate belongs *after* triage —
  a gate that is red on day one teaches people to ignore it.»

Their defects are RESOLVED (2026-09-22): `Markdown.test.ts` 185/0, `audio-stream.test.ts` 102/0.

## 1. What is true today (measured 2026-09-22)

- `packages/opentui/packages/core/package.json` has `"test": "bun run test:js"` and **no `test:ci`** ✓
  (`grep`).
- CI runs `bun turbo test:ci`, so this package is skipped ✓ (recorded in the audio plan, 2026-09-17).
- Remaining reds named at the time, to be re-measured before arming: `Code` 7, `Textarea` 4,
  borrowed pointer (FFI) 3, markdown/conceal ~3.

## 2. Tasks

- [x] **G1 — re-measured 2026-09-23.** `Markdown.test.ts` on the current tree: **182 pass / 5 fail**
  (187 tests, run `20260923T051143Z_d0c72565`) — NOT the 185/0 recorded on 2026-09-22. The five reds
  are: `streaming structured list updates keep previous item text visible while highlighting`,
  `streaming nested structured list updates keep previous nested text visible while highlighting`,
  `hyperlink capability changes preserve custom Markdown code callbacks`, `theme switching
  (syntaxStyle change)`, `paragraph updates do not flash raw markdown markers`. The delta is a
  REGRESSION landed between 09-22 and 09-23, commit `1e97343dfb` (T2 of the flicker plan), not stale
  tests.
- [x] **G2 — triaged: ONE cause, real defect, fixed.** All five reds came from `Markdown.ts`
  hardcoding `quietHighlightMs: QUIET_HIGHLIGHT_MS` into BOTH code-renderable constructors — the quiet
  window became engine policy and deferred every markdown parse, which is exactly what the tests
  observe. Fixed as a per-call option (T8c of the flicker plan); `Markdown.test.ts` is back to
  **187 pass / 0 fail** (run `20260923T051405Z_0871d8a9`). Nothing was skipped or rewritten.
- [ ] **G3 — arm the gate.** `test:ci` in the package, wired so `bun turbo test:ci` reaches it; a green
  run from a clean checkout is the acceptance.
- [ ] **G4 — pin the wiring.** The same three-surface rule as `planstatus`: if the task is registered
  anywhere (turbo pipeline, root scripts), a test holds the spelling.

## 3. Smoke Tests (PRE_FLIGHT)

Baseline [Exact] before any edit:

1. `bun test src/renderables/__tests__/Markdown.test.ts` (cwd `packages/opentui/packages/core`) —
   expect **187 pass / 0 fail** (run `20260923T051405Z_0871d8a9`; was 185/0 on 2026-09-22 and 182/5 on
   2026-09-23 before the quiet-window fix).
2. `bun test src/tests/audio-stream.test.ts` — expect 102 pass / 0 fail (run `20260922T122751Z_6c8ea9e5`).

Post: the same two, plus the full `test:ci` invocation the CI uses, recorded as a run with its exit code.

## 4. Risks

- **Arming a red gate is worse than no gate** — G1/G2 must land before G3, in that order.
- The package's suite is heavy (5 038 tests at 2026-09-17 measurement) — run it as `test:ci` under
  `cmd_runner` (low priority), never bare, and never as one full-suite invocation from the package root
  without a path (the prohibition is about the opencode package's full suite; the same discipline
  applies here by intent).
