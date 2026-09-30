# Coupling labels from plan headers — one label, one place

<!-- intention: the coupling watcher resolves every vector's parent-goal-md5 against a plan MAP parsed from .opencode/data/memory/reasoning.md, which holds zero md5 lines, so every non-zero parent is reported off-plan -> labels come from each active plan's OWN @SV_FORMAT header, so a plan declares its label once, in the file that is the plan -->

- **plan_id:** 2026-10-01_coupling-labels-from-plan-headers
- **revision:** 1
- **state:** ACTIVE
- **owner decision (2026-10-01):** «Давай!» — on option (b): source the labels from the plans' own SV headers
  instead of reviving the hand-kept memory map (option (a)). Supersedes the 2026-09-22 placement of the map in
  memory («Раз мы убрали summary — мы обязаны заполнять и сопровождать эту форму в memory», quoted at
  `src/memory/spine.ts:167`): that placement did not hold — see Measurement.
- **executor:** robot (`skill robot`), verified by Claude.

```yaml
Keywords: coupling-watcher 0.30, plan-header-label 0.26, empty-memory-map 0.20, single-source-label 0.14, false-off-plan 0.10
Semantic dominant: Метка плана читается из его собственного SV-заголовка, а не из ручной карты в памяти, которая пуста и потому объявляет каждый вектор «вне плана».
md5: 3b8e61f0c4a927d5e1f06b3c28a49d71
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Measurement (2026-10-01)

- ✓ (Grep) `.opencode/data/memory/reasoning.md`: **0** lines matching `md5:`. `parsePlanMap`
  (`src/memory/spine.ts:172`) therefore returns `[]`, `labels` is empty (`spine.ts:227`), and every non-zero
  `parent-goal-md5` becomes `vector-off-plan` (`spine.ts:235-238`). The test «an empty map makes every linked
  vector a finding» (`test/session/vector-coupling.test.ts:69`) pins exactly this — so the watcher is correct
  and its INPUT is dead.
- ✓ (Grep) the only memory revision kept (`.opencode/data/memory/revisions/reasoning-2026-09-29T23-36-09-400Z.md`)
  carries `md5:` only in prose — no map there either.
- ✓ (Grep `^[ \t]*md5:\s*[0-9a-f]{32}\s*$`) of 18 active plans in `plans/` (via `git ls-files`), **4** carry a
  label in their header: `2026-09-29_cua-windows-debug-input`, `2026-09-30_cua-supply-chain-audit`,
  `2026-09-30_no-foreign-skill-discovery`, `2026-09-30_robot-installer`. Plus the two plans written today.
- ✓ (codegraph_explore) blast radius: `parsePlanMap` and `couplingFindings` have callers only in
  `src/session/prompt.ts` (line 1992-2009) and tests only in `test/session/vector-coupling.test.ts`.

## Design (DISAS)

- A plan's label is the FIRST line in the file matching `^[ \t]*md5:\s*<HEX32_SOURCE>` — the same anchor
  `parsePlanMap` uses, so `prev-md5:` / `parent-goal-md5:` can never be read as it (they do not start with
  `md5:`). Normalised with `.replace(/\s+/g, "")`, as today.
- A plan without such a line contributes NO entry — the reader never invents a label (same rule as
  `spine.ts:169`).
- The watcher's `map` becomes `planFiles(worktree)` → read each → `{ plan, label }`. The set `plans/*.md` is
  already what `planFiles` returns (`src/util/plan-status.ts:436`, flat, `MASTER_PLAN.md`/`README.md` excluded).
- Cost is not a question: ~20 small files, once per user message (the note is one per user message,
  `prompt.ts:1963`). Read synchronously, like `planFiles` itself — the prompt path stays service-free
  (`prompt.ts:2005-2007`).
- `readMemory` stays imported in `prompt.ts` only if something else there still uses it; `compaction.ts` keeps
  its own use (`compaction.ts:2657`).

## Tasks

- [x] ✓ **L1 — the reader, test first. DONE (2026-10-01).** `planHeaderLabel(text: string): string | undefined`
      added to `src/memory/spine.ts`, immediately after `parsePlanMap` and reusing ITS anchor and
      normalisation verbatim (a second spelling of one anchor is the defect this repository already paid
      for). Five cases land in `test/session/vector-coupling.test.ts`, fixture built from the real header
      shape of `plans/2026-10-01_tool-description-contracts.md`: header → label; `16+16` and `8×4` forms →
      canonical 32 hex; no `md5:` → `undefined`; only `prev-md5:`/`parent-goal-md5:` → `undefined`; two
      `md5:` lines → the FIRST.
      **Red, observed:** `bun test test/session/vector-coupling.test.ts` → **0 pass / 1 fail / 1 error**,
      `SyntaxError: Export named 'planHeaderLabel' not found in module '…/src/memory/spine.ts'`
      (`20260930T231441Z_77f1fd29`). **Form note for the next reader:** the file dies as a WHOLE, not as 5
      individual test failures — an ES module links before it evaluates, so a missing export takes every
      test in the file with it. The plan predicted a per-test red; the substance (fails ON THE MISSING
      EXPORT, not on a harness error) holds, the shape does not.
      **Green:** **13 pass / 0 fail / 34 expect**, exit 0 (`20260930T231512Z_f73ab21f`) — the 8 existing
      watcher cases plus the 5 new ones.
      **Mutation check DONE (2026-10-01):** `if (text) return undefined` at the top of `planHeaderLabel` →
      **10 pass / 3 fail**, exit 1 (`20260930T232041Z_e6838502`), failing EXACTLY cases 1, 2 and 4 while
      cases 3 and 5 stayed green — which is the point: the mutation returns what those two already
      demand. Restored. The reader is proven fallible, so L1 is now closed on evidence.
- [x] ✓ **L2 — wired, with ONE deliberate deviation from this plan's letter.** The plan said build the map
      inline in `prompt.ts` from `planFiles` + a raw `readFileSync`. Instead `planLabels(worktree)` lives in
      `src/util/plan-status.ts`, for two measured reasons: (a) `memory/spine.ts` has **no imports at all** —
      it is a leaf by construction, so a FILE READER does not belong there, while `plan-status.ts` is
      already where plan files are read (`collectPlans`, `criticalRisks`); (b) a raw fs read inside the
      3 141-line prompt path duplicates an idiom that exists one module away, and the prompt path is the one
      place a new requirement propagates into every layer providing `SessionPrompt`. `plan-status.ts`
      imports `planHeaderLabel` from `spine.ts`, and spine imports nothing — a cycle is impossible by
      construction, not by care.
      `prompt.ts`: `map: planLabels(worktree)`; `parsePlanMap` and `readMemory` dropped from the imports
      (`readMemory` had no other use — measured by grep, not assumed). `spine.ts:216`'s `map` doc names the
      new source.
      **Green:** 13 pass / 0 fail / 34 expect (`20260930T232202Z_ceec669f`); typecheck exit 0
      (`20260930T232202Z_d9eea723`).
      ✗ **The wiring's oracle is L4 and it is NOT met** — nothing here proves production now resolves
      `d99945d67a57440775f414e816c78773`; that needs a rebuilt binary. A hermetic unit test of `planLabels`
      against a fixture plans dir is the alternative pin and is NOT written.
- [ ] **L3 — cut the dead source, after L2 is proven.** Remove `parsePlanMap` and its test case («the map is
      read as WRITTEN», `vector-coupling.test.ts:124-150`); MOVE its still-valid assertion — the spaced label in
      a vector's `parent-goal-md5` (line 149) — into the L1 test so nothing it pinned is lost. The
      `map-names-missing-plan` branch (`spine.ts:241-245`) becomes unreachable from production (every entry
      now comes from an existing file): remove it together with its test (`vector-coupling.test.ts:91-102`),
      and say so in the commit. Update the header comment of `vector-coupling.test.ts` (lines 1-10) — it
      describes the memory map. Everything else in the test file stays as is.
- [ ] **L4 — live oracle.** On a fresh build candidate (`packages/opencode/dist/**`, never `bin/`), a session
      whose turns carry `parent-goal-md5: d99945d67a57440775f414e816c78773` (the label of
      `plans/2026-10-01_tool-description-contracts.md`) → the status note reads `… · 0 findings` with
      `checked ≥ 1`; one turn with an undeclared 32-hex parent → exactly one `vector-off-plan` finding naming
      that message.

## Smoke Tests

- **Baseline (before any edit):** `bun test test/session/vector-coupling.test.ts` from `packages/opencode` —
  record pass/fail counts. A red baseline is fixed and committed first (STABILIZE).
- **Predicted red:** after L1's test is written and before the function exists, the file fails ON THE MISSING
  EXPORT, not on a harness error.
- **Post-change:** the same file green; `bun test test/session/svm.test.ts` green (it shares the S5 carrier);
  `bun typecheck` from `packages/opencode` exit 0.
- **Fallibility:** revert `planHeaderLabel` to `return undefined` locally → L1 cases (1), (2), (4) go red;
  restore. Recorded in the commit body.
- **Live:** L4.
- Never the whole package suite.

## Residual (not in this plan — named so it is not lost)

- 14 of 18 pre-existing active plans carry no header label, so a vector parented to any of them will be
  reported off-plan. Whether a missing header label should itself be a finding (`plan-without-label`) is an
  owner decision: AGENTS.md § Plan Maintenance already requires an SV per active plan, and this would make that
  requirement visible every turn. Filling the 14 headers is authoring work under
  `plans/2026-09-29_svm-tool-and-master-plan.md` S4.
- `plans/MASTER_PLAN.md` carries no labels either; it is rendered by `svm render` and excluded from
  `planFiles` by name — unaffected here.
