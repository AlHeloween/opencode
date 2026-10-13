# Bug policy — the record behind the rules (moved from AGENTS.md, 2026-10-13)

The rules stay in AGENTS.md § Bug Policy; this file keeps the owner's wording and the measured cases verbatim.

- **The direction of change is one-way: tests adapt to the functionality, never the reverse.**
  Owner, 2026-09-30, verbatim: «Ты только смотри не вздумай подстраивать функционал под тесты.
  Тесты подстраиваются под функционал, а не наоборот иначе в них пропадает какой либо смысл.»
  A red test is a question about the TEST only against the REQUIREMENT — never a licence to soften
  the assertion or the behaviour. When the requirement itself moves, the test moves in the SAME
  change WITH its provenance and is re-pinned at least as tightly as before. Measured 2026-09-30
  while fixing `grep`'s output contract: an existing assertion `toContain("Line 2: line2")` was
  replaced by `toContain("Line 2")` + `toContain("line2")` so the suite would go green — the reverse
  direction, and it dropped the contract, since `"Line 2"` is satisfied by `"Line 20"` and stays
  green when the col/offset fields vanish entirely. Corrected to the exact new string
  `"Line 2, col 1, offset 6: line2"`.
- **A test that can silently assert nothing is not a guard.** `test/tool/registry.test.ts` carried
  `if (!planTool) continue // tool only in build (e.g. edit/write vs applypatch)` — a loop whose
  comparison skipped every tool the other catalogue lacked, while the same file asserts three tests
  above that the two catalogues have identical fingerprints. A conditional `continue`/`return` inside
  an assertion loop, an `if (!x) return` before a check, a bare `test.skip` without its reason: each
  turns a red into a green that says nothing, and the comment next to it reads like a justification.
  **Replace the condition with the assertion it was standing in for** (here: compare the key sets), so
  divergence FAILS. Found 2026-09-30 while trimming the tool catalog, where the same `applypatch` the
  comment excused turned out to be measured-dead — `plans/2026-09-30_tool-catalog-trim.md`.
- **A tool's documented contract is a claim, and it is falsifiable — test it, never inherit it.**
  `multiedit` promised «if any edit fails … none are applied — the file is rolled back» while
  implementing no rollback at all: it ran one `edit` per entry and `edit` writes immediately, so a
  later failure left the earlier edits on disk and the report named only the failing entry. Found
  2026-09-29, hit again 2026-09-30 — and the response to the *first* occurrence was a habit («read
  STATE after any edit, never the report»), which @KAIZEN forbids repeating. Repaired the same day:
  every entry is now resolved against an in-memory buffer first and the file is written **once**, so a
  failure writes nothing; the matcher is imported from `edit.ts` rather than re-spelled. Guard:
  `test/tool/multiedit.test.ts` (the tool's FIRST test), proven fallible by a mutation check —
  `plans/2026-09-30_multiedit-atomic-application.md`,
  `experiments/2026-09-30_multiedit-partial-apply/`. The rule, generalised: when a tool's description
  makes a safety promise, an untested promise is a defect waiting for its second occurrence; the
  countermeasure is a test that fails without the guarantee, plus the honest report.
- **Write-path oracles inspect the artifact.** Any change to a PERSISTENT_WRITE path (config/file/DB writers) is verified by reading back what was written (artifact shape / end-to-end), never by typecheck or resolver unit tests alone — a green oracle pointed at the wrong layer is how the duplicate routing writers shipped (2026-09-02). User-reported defects in deterministic, testable classes are process failures, not service events.
