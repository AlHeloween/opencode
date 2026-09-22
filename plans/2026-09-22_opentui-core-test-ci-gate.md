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

- [ ] **G1 — re-measure the red set on the current tree.** `bun test` per suite under
  `packages/opentui/packages/core` (targeted paths only — one suite per invocation, never the package
  root: AGENTS.md § Full package test suite). Record pass/fail per file.
- [ ] **G2 — triage the reds.** Each failing test either states a real defect (→ its own plan, named)
  or is stale against 0.5.11 (→ decided and recorded, test moved or rewritten — never skipped).
- [ ] **G3 — arm the gate.** `test:ci` in the package, wired so `bun turbo test:ci` reaches it; a green
  run from a clean checkout is the acceptance.
- [ ] **G4 — pin the wiring.** The same three-surface rule as `planstatus`: if the task is registered
  anywhere (turbo pipeline, root scripts), a test holds the spelling.

## 3. Smoke Tests (PRE_FLIGHT)

Baseline [Exact] before any edit:

1. `bun test src/renderables/__tests__/Markdown.test.ts` (cwd `packages/opentui/packages/core`) —
   expect 185 pass / 0 fail (run `20260922T122717Z_886b5af6`).
2. `bun test src/tests/audio-stream.test.ts` — expect 102 pass / 0 fail (run `20260922T122751Z_6c8ea9e5`).

Post: the same two, plus the full `test:ci` invocation the CI uses, recorded as a run with its exit code.

## 4. Risks

- **Arming a red gate is worse than no gate** — G1/G2 must land before G3, in that order.
- The package's suite is heavy (5 038 tests at 2026-09-17 measurement) — run it as `test:ci` under
  `cmd_runner` (low priority), never bare, and never as one full-suite invocation from the package root
  without a path (the prohibition is about the opencode package's full suite; the same discipline
  applies here by intent).
