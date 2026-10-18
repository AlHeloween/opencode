# t89 — `write` must return line addresses like `edit` does

<!-- intention: after a write the model gets no line labels and guesses hashes -> write returns the same addressReport edit already returns, computed over the final on-disk text -->

```yaml
Keywords: write-address-report 0.40, edit-after-write 0.25, final-text-labels 0.20, red-test-first 0.15
Semantic dominant: After a write the model receives no line addresses, so its next edit guesses fromHash and is refused, and write must return the same addressReport edit already returns, computed over the final on-disk text.
md5: 7c3e0a92d5f84b16e2a7c09d4b18f53e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

## Status

- [x] T1 — RED tests: write→edit by printed labels only (new file + overwrite) <!-- sv: red-test, write-edit-chain, address-only -->
- [x] T2 — Fix `write.ts`: append `addressReport` over final text, reuse function <!-- sv: address-report, final-text, format-touched -->
- [x] T3 — `write.txt`: result carries current line labels (compress in place) <!-- sv: tool-description, address-contract -->
- [x] T4 — Oracle done: tests GREEN, suites GREEN, build 10.0.1437 <!-- sv: oracle, regression, label-equality -->
- [x] T5 — Commit via scripts/commit_own.py, progress-log line, move plan by outcome <!-- sv: commit, plan-hygiene, progress-log -->

## 1. Defect (measured)

- ClientSoft robot ran `write experiments/2026-10-18_boot-oracle/boot_oracle.cjs`. Its next `edit` was refused: `fromHash is not an 8-hex address: "verdict && verdict.errors.length"`. The model put line TEXT where an address belongs, because it had none.
- `edit` returns `addressReport(...)` (`packages/opencode/src/tool/edit.ts:349-447`, budget `ADDRESS_REPORT_BUDGET`), so the next edit can address its lines directly.
- `write` returns only `"Wrote file successfully."` plus codec notice and LSP blocks (`packages/opencode/src/tool/write.ts:113-152`). No labels.

## 2. Fix

- After the write and the formatter, read the FINAL file text back through the same codec (`TextCodec.syncFile` return when the formatter runs, else the written text), then append `addressReport({ path, oldText: contentOld, finalText, spans: [], created: !exists, formatTouched })`.
- Reuse `addressReport` from `./edit`; do not copy it.
- `formatTouched` = the formatter changed the file (`contentFinal !== contentNew`).
- Keep the same budget and the same cut note (`read` from offset N).
- `write.txt`: say the result carries the current line labels. Compress in place; no docs links.

## 3. Tests

- `packages/opencode/test/tool/write.test.ts` (owns the area):
  - new file: `write` a file, parse ONLY the printed `N  hash: text` labels from the write output, then `edit` line 2 by its printed label. Today there are no labels → RED.
  - overwrite: overwrite an existing file, then `edit` a changed line by its printed label. Today → RED.
- Both must run through `cmd_runner`, one file per call, from `packages/opencode`.

## 4. Smoke Tests

- RED run of the two new tests on today's code: FAIL because the write output carries no `Addresses for` block (harness failure does not count — must fail on the assertion, never on boot/timeout).
- GREEN run of the two new tests after the fix, unmodified.
- Existing `test/tool/write.test.ts` and `test/tool/edit.test.ts` stay GREEN, one file per call through cmd_runner.
- Label-equality read-back: the labels printed by `write` equal those `read` prints for the same file.
- `pwsh -NoProfile -File _build.ps1` through cmd_runner from the repo root; build version recorded.

## 5. Residual / out of scope

- `write` metadata `filediffs` still computed over `contentNew`, not the formatter-final text (pre-existing; not widened here).
- No change to `read`/`edit` address computation.
