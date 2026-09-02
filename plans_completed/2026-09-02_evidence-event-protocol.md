# Evidence Event Protocol

## Objective

Mechanize the kernel's falsification contract without introducing scalar rewards: assistant text may propose claims and bind them to runtime-issued evidence references, while only the runtime may create evidence and an accepted divergence invalidates the active claim stamp.

## Baseline

- [x] `prompt_kernel`: 62 tests pass.
- [x] `session/constitution.test.ts`: 40 tests pass.
- [x] Reproduced defect: a stamped `Exact` claim remains `Exact` after assistant ledger requests `Unknown`; the premise remains grounded.
- [x] Reproduced authority gap: assistant text `oracle_stamp: C1 PASS` creates a system stamp without a runtime evidence reference.

## Geometry

Serpinski candidates:

1. Prompt-only prohibition.
2. Allow `Unknown` to overwrite a stamp.
3. Delete stamps on contradiction.
4. Add scalar reward/penalty.
5. Runtime-owned append-only evidence references with reversible active stamps.
6. Dedicated domain-specific oracle tools.

Manhattan medoid: candidate 5. It closes both self-stamping and sticky-`Exact` while preserving provenance and allowing domain-specific oracle tools later.

Lean-style invariants:

- Assistant output cannot manufacture a runtime evidence reference.
- A claim can become `Exact` only by binding to a registered runtime evidence reference.
- A registered divergence invalidates the active stamp and yields `Unknown`.
- An `Unknown` premise blocks mutation.
- Re-ingesting assistant prose cannot resurrect invalidated evidence.
- A changed claim statement cannot reuse a stamp issued for another statement digest.

## Tasks

- [x] Add runtime-owned evidence records and active/inactive stamp lifecycle to `constitution.ts`.
- [x] Register immutable evidence references from completed tool results in `processor.ts` and expose the reference in the mutable tool-result tail.
- [x] Parse only evidence-bound oracle/divergence proposals from assistant text; reject legacy self-issued PASS stamps.
- [x] Update the kernel state schema and fused divergence rule through `prompt_kernel/source.py`.
- [x] Add behavioural tests for issuance, rejection, invalidation, resurrection prevention, statement binding, and mutation blocking.
- [x] Install the generated runtime kernel and inspect the written artifact.
- [x] Synchronize the runtime protocol documentation with the accepted wire syntax and rejection cases.
- [x] Pin the installed system prompt to LF so Git checkout cannot invalidate byte stability or the production digest on Windows.

## Exact Results

- Kernel: 63/63 tests passed.
- Runtime: 64/64 focused constitution, processor, and prompt-alignment tests passed.
- Typecheck: exit code 0.
- Installed artifact: 24,369/25,000 UTF-8 bytes; 2,837/2,850 normalized tokens.
- Renderer/production parity: true; SHA-256 `ded180c44a350cebd52a306cecffb38c47feb28b9bb8178475f183f1f3e89689`.
- Git attributes: production prompt is `text eol=lf`; artifact contains 0 CRLF sequences.

## Smoke Tests

- `python -m pytest tests -q` from `prompt_kernel/`.
- `bun test test/session/constitution.test.ts test/session/processor-effect.test.ts test/session/prompt-alignment.test.ts` through `cmd_runner` from `packages/opencode/`.
- `bun typecheck` through `cmd_runner` from `packages/opencode/`.
- Rendered kernel equals `packages/opencode/src/session/prompt/reasoning_prompt.txt`; baseline SHA-256 matches the installed artifact.
- Two consecutive renders are byte-identical and remain inside byte/token budgets.
- `git diff --check` and a final read-back of every persistent generated artifact.

## One Step Ahead

After evidence provenance is enforced, the next attack surface is a weak but genuine tool result being bound to an unrelated claim. This cycle binds stamps to both evidence and claim statement digests; semantic adequacy remains the explicit G8 oracle responsibility rather than a scalar score.
