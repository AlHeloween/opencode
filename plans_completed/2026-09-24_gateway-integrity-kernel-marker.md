<!-- intention: the gateway integrity report prints "kernel copies: 0 (EXPECTED 1 — identity accumulation)" on every request although exactly one kernel copy is present -> the counter counts real kernel copies: 1 when the request carries the kernel, 0 only when it does not -->
# Gateway integrity counter: a marker the kernel actually contains

**Status:** COMPLETED 2026-09-24 — as built. RED before, GREEN after; oracle over REAL captures (below). Branch: `Local_Development`.

## G1: ground and criteria

- ✓ `KERNEL_MARKER = "Semantic Vector (SV)"` (`src/provider/gateway/raw-diff.ts:732`) appears in NO kernel render — `grep "Semantic Vector" prompt_kernel` → no matches; the production prompt's first line is `## 0. WORKFLOW — gated execution protocol` (`reasoning_prompt.txt:1`), and the request's system block equals that file byte-for-byte (sha `dc981bc4…`, `experiments/2026-09-24_prefix-probe/`).
- ✓ Live symptom: the capture `.diff` prints `kernel copies: 0 (EXPECTED 1 — identity accumulation)` while the same stem's `.json` carries the kernel as system message #1 — `raw-wire/2026-09-24T15-07-57-555Z-…-attempt1.diff:1` against the same stem's body (system `content:str(46797)`).
- ✓ Why it survived: the unit tests feed a FABRICATED kernel (`test/provider/raw-diff.test.ts:190,253` — `"# Semantic Vector (SV) — kernel body"`), so they prove the counting logic and never the marker — a fixture that does not repeat production.
- ✓ Introduced by `5d433565df` ("readable wire captures … + integrity report"): born dead, not a regression.
- ✓ Class: a counter that can never pass; its constant `0 (EXPECTED 1 …)` would mask a real triplication — the defect class the kernel names as an oracle that cannot fail.

| Acceptance | Surface | Oracle | Falsifier |
|---|---|---|---|
| C1: the counter reports the real number of kernel copies on a REAL request body | `renderIntegrityReport` + a captured body | the real capture `raw-wire/2026-09-24T15-07-57-…json` → `kernel copies: 1` (where the live `.diff` printed 0) | still 0 with the kernel present, or 1 with it absent |
| C2: the same defect cannot return silently | marker ↔ prompt pin | a test that reads the PRODUCTION prompt and asserts `kernel copies: 1`, with a control body asserting 0 | a marker edit that leaves the pin green while the live counter prints 0 |

## G2–G4: plan and authorization

- [x] **T1 — pin first (RED).** A test that runs `renderIntegrityReport` over the production prompt text (the file that ships, not a fixture) and asserts `kernel copies: 1`, plus a control whose body lacks the kernel and asserts 0. Run BEFORE the fix: **RED `20260924T152119Z_62c1a758` — 41 pass / 1 fail**, and the failure is the defect in isolation: the body IS the kernel (`messages=1 (system=1)`) and the report reads `kernel copies: 0`.
- [x] **T2 — fix.** One spelling of the marker: `KERNEL_MARKER` exported, value = the prompt's first line `## 0. WORKFLOW — gated execution protocol` (`raw-diff.ts:732`).
- [x] **T3 — re-seed the fixtures** at `raw-diff.test.ts:3,190,202,253` from the exported constant instead of a second literal.
- [x] **T4 — oracle.** GREEN **`20260924T152152Z_51865148` — 42 pass / 0 fail**. Real captures through `experiments_history/2026-09-24_integrity-marker/check.ts` (archived after the run, report beside it): **`20260924T152203Z_0beb948f`** — the fold-boundary body (`15-07-57-555Z`) whose live `.diff` printed `kernel copies: 0` now reads **`kernel copies: 1`**; **`20260924T152209Z_a81a6c29`** — 64 messages, `kernel copies: 1`, `assistant flow: canonical 19/19`. `bun typecheck` (packages/opencode) exit 0 — `20260924T152226Z_ddac0f38`.

Action: `MODIFY_PROJECT`. Envelope: `src/provider/gateway/raw-diff.ts`, `test/provider/raw-diff.test.ts`, `experiments_history/2026-09-24_integrity-marker/`, this plan, `_progress_log.md`. Prohibitions: no kernel edit (31 B of headroom; the marker belongs to the checker), no `bin/` touch, no unrelated `.artifacts`.
Rollback: `git diff` of the two source files — the marker is one line plus the export.

## Smoke Tests

- **BEFORE:** the pin test RED against the current marker (reads the production prompt; the counter prints `kernel copies: 0`, the assertion wants 1) — recorded with its run id.
- **AFTER:** pin test GREEN; `bun test test/provider/raw-diff.test.ts` green; the real capture prints `kernel copies: 1`.

## Claims

| claim | falsifier | rung at planning |
|---|---|---|
| `Semantic Vector (SV)` is absent from every kernel render | a render containing it | Exact (`grep prompt_kernel`) |
| The `0` is the marker's fault, not the assembly's | a body with no kernel where the counter prints 1 | Exact (a capture with the kernel present reads 0) |
| The prompt's first line is a durable marker | the pin test fails on a kernel edit that renames the heading | Inferred — the pin test is the falsifier |

## Risks

| risk | containment |
|---|---|
| The heading is reworded and the marker dies again | the pin test fails at the same commit as the reword — loud, not silent |
| Exporting the constant widens an API | one caller today (`renderIntegrityReport`); the export is additive, no consumer change |

## Residual (not a box; owner's act)

The live smoke — a NEW request's `.diff` printing `kernel copies: 1` — needs `bin/opencode.exe` rebuilt with this change. Promoting a build is the owner's act; the in-process oracle over a real capture (T4) covers the layer, and the live line is the lifting signal.
