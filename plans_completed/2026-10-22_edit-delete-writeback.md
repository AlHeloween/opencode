# t139 — edit's delete: the result must describe the file that is REALLY there

<!-- intention: the edit tool builds its report from what it MEANT to write, and says "Edit applied successfully." over a file it did not write — so a delete that left the file corrupted was reported as done (t137) -> the file is read back after every write, the report is built from what is on disk, and a file that is not what the tool wrote is NAMED instead of claimed as a success -->

<!-- goal_sv:
```yaml
Keywords: edit-delete-writeback 0.35, read-back-after-write 0.25, divergence-named 0.20, byte-exact-delete 0.12, formatter-contract 0.08
Semantic dominant: The edit tool reads the file back after every write, builds its report from what is on disk, and names a file that is not what it wrote instead of claiming a clean success.
md5: 7c4b1e9d3a5f82c40b6d7e9f1a3b5c8d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 5b9d2e7f1a4c38e06d5b9a2f7e1c4d83
note: hash values are generative tags — search them, never compute them.
```
-->

<!-- workflow: lifecycle ACTIVE -->

- **plan_id:** 2026-10-22_edit-delete-writeback
- **revision:** 1
- **state:** ACTIVE
- **owner brief:** t139 (owner, 2026-10-21, `UTC: 2026-10-21T22:02:24.651Z`): «edit's documented delete (empty newString) corrupts the file and reports success». Acceptance: a red-first test that reads the file back after a delete (end, middle, batch) and compares it byte for byte; a mutation control; the six edit suites stay green; `bun typecheck` and `_build.ps1` through cmd_runner; one commit that names the task; a plan with its boxes ticked on receipts; a final message listing the run ids.

## The evidence (every line carries its instrument)

- ✓ `read packages/opencode/src/tool/edit.ts:850-866` (PHASE 3) — the write is `afs.writeWithDirs(filePath, TextCodec.encode(plan.contentNew, plan.encoding))`; the file is read back **only** inside `if (yield* format.file(plan.filePath))` → `plan.contentFinal = TextCodec.syncFile(...)`. **When no formatter runs, `contentFinal` stays the tool's MODEL of the file and the file on disk is never read.**
- ✓ `read packages/opencode/src/format/index.ts:82` — `formatFile` returns `false` iff NO formatter matched the extension; it returns `true` whenever one was FOUND, even when the formatter failed (`:115-120` logs the failure and continues).
- ✓ `read packages/opencode/src/tool/edit.ts:906-911` — the success line is unconditional: `"Edit applied successfully."`.
- ✓ `read packages/opencode/src/tool/edit.ts:396-455` (`addressReport`) — the report (`the file is now N lines`, the echo, the old→new map) is built from `input.finalText` = `plan.contentFinal`.
- ✓ `read packages/opencode/src/tool/edit.ts:219-377` (`resolveAddresses`) — the reconstruction itself is CORRECT: a delete removes the span (`result = [...head, ...fitted, ...result.slice(span.end + 1)]`, `:375`) and keeps the neighbours' endings.
- ✓ **RED-FIRST** — `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-delete-writeback-t139.test.ts`, run `20261022T005159Z_aa0c8611`, exit 1, **7 pass / 1 fail**: the failing case is «a file that is not what the tool wrote is NAMED, not swallowed» — `expect(result.output).not.toContain("Edit applied successfully.")` received «Edit applied successfully.» (the file on disk was `one\nthree\nfour\n)\n`, the tool's model `one\nthree\nfour\n`).
- ✓ `read packages/opencode/src/tool/edit.ts:340-377` — the seven passing cases are the delete shapes (last line, line before the end, middle, batch of two files, a 986-line CRLF file at line 934 and at its last line, a 986-line `.ts` file): **the delete writes the intended bytes today** — the defect is the REPORT, not the reconstruction.
- ✓ `read plans_completed/2026-10-22_edit-window-label-caller.md:90` — the t137 account: «left `edit.ts` with its last two lines DUPLICATED after a stray `)` — four junk lines, a syntax error, and the tool reported the write as done». **This is the t137 agent's own account, not a measurement.**
- ✓ `read logs/cmd_runner/20261021T213913Z_16eba787/stdout_text.log` — the ONLY hard evidence of the incident: the file had `)` at line 986 and bun refused it («Unexpected )» at `edit.ts:986:1`). The line counts («989 on disk vs 985 in the model») are NOT in any surviving record — they are not used here.
- ✓ `read packages/core/src/npm.ts:186-230` + `list node_modules/.bin` — `Npm.which("prettier")` resolves to `node_modules\.bin\prettier` (from prettier's `package.json` `bin`), and that path does NOT exist (the directory holds `prettier.exe` and `prettier.bunx`): **the formatter never runs in this repo.** `format.file()` still returns `true` for `.ts` (a formatter was FOUND), so `.ts` files ARE read back — the files that are NOT read back are the ones with no formatter at all (`.txt`, `.log`, …).

## Tasks

- [x] **T1 — the red-first test.** DONE — `packages/opencode/test/tool/edit-delete-writeback-t139.test.ts` (8 cases): the delete shapes read the file back byte for byte, and the write-back case demands that a file which is not what the tool wrote is NAMED. Receipt: run `20261022T005159Z_aa0c8611`, exit 1, 7 pass / 1 fail — **red for the reason named** (the tool answered «Edit applied successfully.» over a file whose content on disk was not what it wrote).
- [x] **T2 — read the file back after EVERY write.** `edit.ts:860-867` — PHASE 3 reads the file back unconditionally (`TextCodec.syncFile`), so `contentFinal` — the text the whole report is built from — is the file that is really there. A formatter that ran is one reason the file differs; anything else is a divergence. Receipt: the t139 suite goes GREEN (run `20261022T020514Z_c36fe38f`, exit 0, 8 pass / 0 fail) and the six edit suites stay green (S4-S9 below).
- [x] **T3 — NAME the divergence.** `edit.ts:914-923` (the success line) and `:930-931` (the per-file line): when the file on disk is not what the tool wrote and no formatter explains it, the result says «the file on disk is not what was written» and does NOT claim a clean success; the addresses in the report are then the file's real labels. Receipt: the write-back case — GREEN after the fix (S2), RED with the cause reverted (S3).
- [x] **T4 — the description.** CHECKED, NO CHANGE — and here is why, with the instrument: `edit.txt` promises only what the code keeps (the documented delete form IS honoured — T1's seven cases read the file back byte for byte), so the owner's condition («if the description promises a delete form that the code cannot honour») is NOT met; and the tool description rides the KV-stable system prefix, where a change costs every session a cache break. The divergence is a RESULT the tool prints, not a promise the description makes — and it says what to do («read it back before addressing it»). The contract test is therefore unchanged (S7 green, 7 pass).
- [x] **T5 — the mutation control.** DONE — the fix's CAUSE was reverted (the read-back made conditional again): run `20261022T021453Z_d6aeba47`, exit 1, 7 pass / 1 fail — the SAME case failing on the SAME assertion, the report again saying «the file is now 3 lines» while the file had 4. Restored: run `20261022T021658Z_62405c76`, exit 0, 8 pass / 0 fail. The oracle detects this exact defect.
- [x] **T6 — the suites, the typecheck, the build.** DONE — all through cmd_runner, one file per call; the receipts are the Smoke Tests table below.

## Smoke Tests

Predicted BEFORE each run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction | actual |
|---|---|---|---|
| S1 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-delete-writeback-t139.test.ts` (BEFORE the fix) | **RED** — the write-back case fails: the tool claims success over a file it did not write | **RED as predicted** — run `20261022T005159Z_aa0c8611`, exit 1, 7 pass / 1 fail |
| S2 | the same file (AFTER the fix) | **GREEN** — 8 pass / 0 fail | **GREEN as predicted** — run `20261022T020514Z_c36fe38f`, exit 0, 8 pass / 0 fail, 12 expect() calls |
| S3 | the same file with T2 reverted (MUTATION) | **RED** — the write-back case fails again | **RED as predicted** — run `20261022T021453Z_d6aeba47`, exit 1, 7 pass / 1 fail (the write-back case; the report said «the file is now 3 lines» while the file had 4). Restored: run `20261022T021658Z_62405c76`, exit 0, 8 pass / 0 fail |
| S4 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit.test.ts` | **GREEN** — 25 pass | **GREEN as predicted** — run `20261022T020645Z_303041d6`, exit 0, 25 pass / 0 fail |
| S5 | `… -- bun test test/tool/edit-exact.test.ts` | **GREEN** — 34 pass | **GREEN as predicted** — run `20261022T020645Z_97e42292`, exit 0, 34 pass / 0 fail |
| S6 | `… -- bun test test/tool/edit-overlap-t114.test.ts` | **GREEN** — 7 pass | **GREEN as predicted** — run `20261022T020650Z_b8883a29`, exit 0, 7 pass / 0 fail |
| S7 | `… -- bun test test/tool/edit-description-contract.test.ts` | **GREEN** — 7 pass | **GREEN as predicted** — run `20261022T020843Z_3c23a05f`, exit 0, 7 pass / 0 fail |
| S8 | `… -- bun test test/tool/edit-label-remap-t123.test.ts` | **GREEN** — 5 pass | **GREEN as predicted** — run `20261022T020843Z_4ce0bddf`, exit 0, 5 pass / 0 fail |
| S9 | `… -- bun test test/tool/edit-window-labels-t137.test.ts` | **GREEN** — 4 pass | **GREEN as predicted** — run `20261022T020849Z_01a2d4b8`, exit 0, 4 pass / 0 fail |
| S10 | `cmd_runner start --cwd packages/opencode -- bun typecheck` | **GREEN** — exit 0 | **GREEN as predicted** — run `20261022T020514Z_5cda33f7`, exit 0, no diagnostics |
| S11 | `cmd_runner start --cwd . -- pwsh -NoProfile -File _build.ps1` (repo root) | **GREEN** — exit 0 | **GREEN as predicted** — run `20261022T021658Z_bb49c21a`, exit 0, «✓ built in 34.42s», «Smoke test passed: 10.0.1521», «[OK] Build complete - artifacts in dist/» |

## Risks

- **The read-back costs one file read per edited file.** It replaces a write and, when a formatter ran, an existing read — the net cost is one read per file with NO formatter. Bounded by the batch size.
- **`syncFile` fails when the file is not text** (a formatter that left binary) — the edit fails AFTER the write. That is loud, which is the point; the file is left as it is and the backup exists.
- **The report changes for every edit** (`finalText` is now the disk, not the model). When the two are equal — the normal case — the bytes are identical. The suites S4-S9 are the guard.
- **The formatter never runs in this repo** (`Npm.which` resolves to a path that does not exist) — a SEPARATE defect, named here, not fixed here: it means `.ts` files are not prettier-formatted after an edit.

## Out of scope

- The formatter's broken binary path (`Npm.which` → `node_modules\.bin\prettier` does not exist) — a separate defect, named as a residual.
- The t137 incident's «duplicated tail» mechanism: the corrupted file was repaired and the only surviving evidence is the `)` at line 986. **Unknown, not invented** — see the residual.
- `bin/`, the kernel, `prompt_kernel/`, the storage plane.

## Rollback

T2/T3 are one edit in `packages/opencode/src/tool/edit.ts` (plus the test file and, if the description changes, `edit.txt`): reverting the commit restores the previous behaviour exactly. No data migration, no stored-state change.

## Prior art (owner, 2026-10-20: «An invention that is worse than one found, or was never compared, is not accepted»)

- **Repo** — `grep`/`read`: the defect is `edit.ts:855-858` (the read-back under a condition) and its sibling `write.ts:103-108`; `TextCodec.syncFile` (`src/util/text-codec.ts:285-296`) is ALREADY the read-back — the fix removes a CONDITION and invents no mechanism.
- **The project's own rule** — `docs/bug-policy.md:38`: «**Write-path oracles inspect the artifact.** Any change to a PERSISTENT_WRITE path … is verified by reading back what was written … never by typecheck or resolver unit tests alone». The status quo (trust the write) is what this rule forbids; the fix is that rule applied inside the tool.
- **The web** — Universal Search (hybrid, query «agent edit file read back after write verify content on disk differs …») → `anthropics/claude-code#81518` «Edit tool silently no-ops (reports success, zero on-disk change)» (fetched; content_hash `ecff176f9d138947ca102026031c5b1cb2b4986968f58bd9ffbb774c7f303ff`): the same class, in a sibling product, with the same expectation — «success with zero change should not be possible». Also `#61471`: the Edit tool returns success while the change is never written to disk, and «The discrepancy is silent — no error, no warning».
- **Why this choice beats the alternatives** — (i) trust the write: forbidden by `docs/bug-policy.md` and by the sibling issue; (ii) hash the file against a digest: the tool already holds BOTH texts (`contentNew` and the disk), so the comparison is free — a digest is new machinery for a comparison already in hand; (iii) roll the edit back on a divergence: applying the edit is the tool's job, and the backup is the owner's undo; (iv) read back only when a formatter ran: that IS the defect.

## Residuals

- The t137 corruption's MECHANISM is Unknown: the corrupted file no longer exists, the incident's line counts are the reporting agent's account, and today's delete writes the intended bytes in every shape measured (T1's seven cases). What is FIXED here is the class that made it silent — a report built from the tool's intent over a file it did not write.
- The `task`/`pipeline` delegation lane is dead in this session (TDZ defect «Cannot access 'ge' before initialization», fixed in source by `f295165ac` but not in the running binary), so the trials were run from the primary agent instead of `researcher_agent`.
- `write.ts:103-108` carries the SAME shape (the read-back only when a formatter ran) — the same class, NAMED here and NOT fixed in this task: the owner's brief scopes t139 to `edit`, and widening it would be my plan, not his.
