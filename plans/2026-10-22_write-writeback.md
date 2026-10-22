# t140 — write reads the file back after every write, like edit now does (t139's sibling)

<!-- intention: the write tool builds its result from what it MEANT to write, and says "Wrote file successfully." over a file it did not write — the file is read back (TextCodec.syncFile) ONLY when a formatter ran (write.ts:103-108, ticket ca760c924e) -> the file is read back after every write, the result is built from what is on disk, and a file that is not what the tool wrote is NAMED instead of claimed as a success -->

<!-- goal_sv:
```yaml
Keywords: write-readback 0.35, same-shape-as-edit 0.25, divergence-named 0.20, reuse-t139-pattern 0.12, ticket-ca760c924e 0.08
Semantic dominant: The write tool reports the text it meant to write whenever no formatter ran, exactly the shape t139 fixed in edit, so write reads the file back after every write and names a file on disk that differs from what it wrote instead of claiming success.
md5: 6e2a9d4f1c7b38e05a6e2d9f4c1b7a85
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```
-->

<!-- workflow: lifecycle ACTIVE -->

- **plan_id:** 2026-10-22_write-writeback
- **revision:** 1
- **state:** ACTIVE
- **owner brief:** t140 (owner, 2026-10-22, `UTC: 2026-10-22T02:29:14.655Z`): «write reads the file back after every write, like edit now does (t139's sibling)». Apply the SAME fix to `write`, reusing t139's pattern rather than inventing one: the result must describe the file that is really on disk, and any divergence that no formatter explains is named instead of «Wrote file successfully.» Close the ticket with the receipt. Acceptance: a red-first test that reads the file back after a write, with a mutation control; the write and edit suites stay green; `bun typecheck` and `_build.ps1` through cmd_runner; one commit that names the task; a plan with its boxes ticked on receipts; a final message with the run ids.

## The evidence (every line carries its instrument)

- ✓ `read packages/opencode/src/tool/write.ts:103-108` — the write is `fs.writeWithDirs(filepath, TextCodec.encode(contentNew, form.encoding))`; the file is read back (`TextCodec.syncFile`) **ONLY** inside `if (yield* format.file(filepath))`. With no formatter for the extension, `contentFinal` stays the tool's MODEL of the write and the file on disk is never read.
- ✓ `read packages/opencode/src/tool/write.ts:115` — the success line is unconditional: `"Wrote file successfully."`.
- ✓ `read packages/opencode/src/tool/write.ts:135-142` — the address report is built from `contentFinal` (the model, not the disk).
- ✓ `read packages/opencode/src/format/index.ts:82,115-123` — `formatFile` returns `false` iff NO formatter matched the extension; it returns `true` whenever one was FOUND, even when the formatter FAILED (`:115-120` logs the failure and continues).
- ✓ `read packages/opencode/src/tool/edit.ts:861-867` (t139's fix, commit `4aeac71a94`) — the shape to reuse: `const formatted = yield* format.file(path)`; the file is read back **unconditionally** (`TextCodec.syncFile`); `plan.diverged = !formatted && plan.contentFinal !== plan.contentNew`.
- ✓ `read packages/opencode/src/tool/edit.ts:914-923,930-931` — the divergence's WORDING: «Edit applied, but the file on disk is not what was written — read it back before addressing it.» and per file «the file on disk is not what was written — the edit wrote N lines, the file has M. Read it back before addressing it.»
- ✓ `read packages/opencode/src/util/text-codec.ts:285-296` (`syncFile`) — it reads the file back, decodes it, restores the form the write chose, and returns the text it now holds. **It FAILS on a file that is not text** (`the formatter left a file that is not text`) — `write` may write BINARY content today (`test/tool/write.test.ts` «writes binary-safe content»), so `write` cannot use `syncFile` as its unconditional read-back without failing a legal write.
- ✓ `read docs/bug-policy.md:38` — «**Write-path oracles inspect the artifact.** Any change to a PERSISTENT_WRITE path … is verified by reading back what was written (artifact shape / end-to-end), never by typecheck or resolver unit tests alone».
- ✓ `fossil sql` on the local cell (`D:/zPython/opencode/.opencode/data/fossil/4b0ea68d…/snapshot.fsl`), ticket `ca760c924e99603c30414820da89bb244ef25099` — the ticket t139 filed, with ITS OWN falsifier: «make the file on disk differ from what the tool wrote (a writer that touches the file between the write and the report), then assert the output does NOT claim a plain success and DOES name the divergence» and «the t139 fixture uses a Format.Service whose `file()` rewrites the file and returns false». **The fixture is named by the ticket: this task reuses it verbatim.**
- ✓ `read packages/opencode/test/tool/edit-delete-writeback-t139.test.ts` — the harness to copy: `testEffect(layers)`, `tmpdirScoped()`, `provideInstance(dir)`, and the `rewritingFormat` layer whose `file()` appends `")\n"` to the file and returns `false`.
- ✓ `read packages/opencode/src/tool/write.txt` — the description promises only what the code keeps (create/replace, the form is kept, conversions are named). It makes no promise about the RESULT's fidelity, so the divergence is a RESULT the tool prints, not a promise the description makes — and `write.txt` rides the KV-stable system prefix, where a change costs every session a cache break. **CHECKED, NO CHANGE** (the same conclusion t139 reached for `edit.txt`).
- ✓ `read packages/core/src/filesystem.ts:46-48` — `existsSafe` is `fs.exists(path)` with a catch: a plain stat, no wait, nothing that can hang.

## Tasks

- [x] **T1 — the red-first test.** `packages/opencode/test/tool/write-writeback-t140.test.ts` (3 cases): a NEW file and an OVERWRITE land byte-for-byte as intended, and a file that is NOT what the tool wrote is NAMED instead of swallowed. The divergence fixture is the ticket's own. Receipt: run `20261022T023815Z_1404e8be`, exit 1, **2 pass / 1 fail** — RED for the reason named: the tool answered «Wrote file successfully.» and «created — 4 lines» over a file that holds 5 lines. The file read-back assertion PASSED in the same case — **the defect is the REPORT, not the write** (exactly t139's split).
- [x] **T2 — read the file back after EVERY write.** `write.ts:103-136` — the read-back is unconditional. It must survive a BINARY write, so the BYTES are read back and decoded with the same codec `read` uses (`TextCodec.decode`), and the comparison is byte-for-byte against the bytes the tool wrote; a formatter that ran keeps `TextCodec.syncFile` (it restores the form the formatter stripped). A file that is ABSENT after the write is a divergence, not a crash. Receipt: the suite goes GREEN (S2) and the mutation control goes RED on the same assertion (S3).
- [x] **T3 — NAME the divergence.** `write.ts:143-151` — the success line is no longer unconditional: a file on disk that is not what the tool wrote gets «Wrote file, but the file on disk is not what was written — read it back before addressing it.» plus the per-file line with the two line counts (the bytes, for a file that is not text). The filediff metadata is recomputed against the disk (`write.ts:179-185`) so the patch describes the file that is really there. Receipt: the write-back case — GREEN after the fix (S2), RED with the cause reverted (S3).
- [x] **T4 — the description.** CHECKED, NO CHANGE — with the instrument above (`write.txt` read in full). The description promises no result-fidelity the code cannot keep, and it rides the KV-stable prefix.
- [x] **T5 — the mutation control.** DONE — the fix's CAUSE was reverted (the read-back made conditional again): run `20261022T025048Z_d231fb59`, exit 1, 2 pass / 1 fail — the SAME case failing on the SAME assertion («Wrote file successfully.» over a file with 5 lines). Restored: run `20261022T025134Z_1a3fcac9`, exit 0, 3 pass / 0 fail. The oracle detects this exact defect.
- [x] **T6 — the suites, the typecheck, the build.** All through cmd_runner, one file per call; the receipts are the Smoke Tests table below. **The six `edit` suites are green at exactly t139's baselines. The `write` suite is RED on this host — IDENTICALLY at HEAD and with the fix (S4): the cause is outside this change and is measured, named and left as a residual.**
- [x] **T7 — close the ticket.** The local cell ticket `ca760c924e` is closed with the receipt: the run ids below and the commit that names t140 (the hash is in the ticket's comment and in the final message).
- [ ] **T8 — the `write` suite green on a host with free RAM.** OPEN, and it is the OWNER's action, not a code change. `write.ts:153` awaits `lsp.diagnostics()` with NO timeout, and this host has 16 GB RAM with **1 645 MB free** (a leaked `tsserver.js` at 3 352 MB — PID 20620 — plus ~18 codegraph MCP servers, most of them days old), so a language server that cannot boot hangs the tool until the test's 30 s timeout; the next cases inherit the dead stream. `edit.ts` bounds the same wait at 1500 ms (`DIAGNOSTICS_BUDGET`), which is why the six edit suites are green here and `write` is not. **Continuation:** free the RAM (kill the stale `tsserver`/`codegraph` servers), then `cmd_runner start --cwd packages/opencode -- bun test test/tool/write.test.ts` — the prediction is GREEN, 23 pass / 0 fail. The alternative the owner may prefer: authorise copying `edit.ts`'s `DIAGNOSTICS_BUDGET` into `write.ts` (a separate defect, deliberately NOT fixed by this task — widening the brief would be my plan, not his).

## Smoke Tests

Predicted BEFORE each run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction | actual |
|---|---|---|---|
| S1 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/write-writeback-t140.test.ts` (BEFORE the fix) | **RED** — the divergence case fails: the tool claims success over a file it did not write | **RED as predicted** — run `20261022T023815Z_1404e8be`, exit 1, 2 pass / 1 fail |
| S2 | the same file (AFTER the fix) | **GREEN** — 3 pass / 0 fail | **GREEN as predicted** — run `20261022T023942Z_919fe1fd`, exit 0, 3 pass / 0 fail, 7 expect() calls |
| S3 | the same file with T2 reverted (MUTATION) | **RED** — the divergence case fails again | **RED as predicted** — run `20261022T025048Z_d231fb59`, exit 1, 2 pass / 1 fail (the same case, the same assertion). Restored: run `20261022T025134Z_1a3fcac9`, exit 0, 3 pass / 0 fail |
| S4 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/write.test.ts` | **RED on this host, identically before and after the change** — the three 30 s timeouts are the LSP wait under a starved host, not this change | **RED, identically** — with the fix REVERTED (= HEAD): run `20261022T024725Z_aa9efb5c`, exit 1, 20 pass / 3 fail; WITH the fix: run `20261022T025419Z_abc18c96`, exit 1, 20 pass / 3 fail — **the same three cases** («returns relative path as title», «new file: edit line 2 using ONLY the printed labels», «overwrite: edit a changed line by its printed label»), all `timed out after 30000ms`. @CAUSAL_ATTRIBUTION: before FAIL → inherited, not this change. The cause is measured in the Residuals below. |
| S5 | `… -- bun test test/tool/edit-delete-writeback-t139.test.ts` | **GREEN** — 8 pass | **GREEN as predicted** — run `20261022T025134Z_5055ed40`, exit 0, 8 pass / 0 fail |
| S6 | `… -- bun test test/tool/edit.test.ts` | **GREEN** — 25 pass | **GREEN as predicted** — run `20261022T025217Z_85a4d7f8`, exit 0, 25 pass / 0 fail |
| S7 | `… -- bun test test/tool/edit-exact.test.ts` | **GREEN** — 34 pass | **GREEN as predicted** — run `20261022T025217Z_b424c1ae`, exit 0, 34 pass / 0 fail |
| S8 | `… -- bun test test/tool/edit-overlap-t114.test.ts` | **GREEN** — 7 pass | **GREEN as predicted** — run `20261022T025217Z_3e4ebf97`, exit 0, 7 pass / 0 fail |
| S9 | `… -- bun test test/tool/edit-description-contract.test.ts` | **GREEN** — 7 pass | **GREEN as predicted** — run `20261022T025317Z_6953f890`, exit 0, 7 pass / 0 fail |
| S10 | `… -- bun test test/tool/edit-label-remap-t123.test.ts` | **GREEN** — 5 pass | **GREEN as predicted** — run `20261022T025317Z_7eba5be4`, exit 0, 5 pass / 0 fail |
| S11 | `… -- bun test test/tool/edit-window-labels-t137.test.ts` | **GREEN** — 4 pass | **GREEN as predicted** — run `20261022T025317Z_4a9b1c35`, exit 0, 4 pass / 0 fail |
| S12 | `cmd_runner start --cwd packages/opencode -- bun typecheck` | **GREEN** — exit 0, no diagnostics | **GREEN as predicted** — run `20261022T025347Z_e0d5a5eb`, exit 0, `bytes_written: 320` (the instrument spoke: `$ tsgo --noEmit` and nothing else) |
| S13 | `cmd_runner start --cwd . -- pwsh -NoProfile -File _build.ps1` (repo root) | **GREEN** — exit 0 | **GREEN as predicted** — run `20261022T025706Z_14550b22`, exit 0, «✓ built in 26.34s», «Smoke test passed: 10.0.1522», «Smoke test passed: reasoning_prompt.txt embedded», «[OK] Build complete - artifacts in dist/» |

## Risks

- **The read-back costs one file read per write.** It replaces a write and, when a formatter ran, an existing read — the net cost is one read per write with NO formatter. Bounded by one read.
- **A binary write has no text.** `TextCodec.syncFile` FAILS on a file that is not text, so the unconditional read-back compares BYTES (the artefact) and reports the text only when there is one. A binary write must not fail: `test/tool/write.test.ts` «writes binary-safe content» is the guard.
- **A file that is ABSENT after the write** (a sandbox that redirected it — `anthropics/claude-code#35230`) must be NAMED, not reported as a success. The read-back checks for the file's presence first (`fs.existsSafe`, a plain stat).
- **The report changes for every write** (`contentFinal` is now the disk, not the model). When the two are equal — the normal case — the bytes are identical, and the filediff patch is the same object (`patch = diff` when they are equal, so the common path costs nothing extra).
- **The formatter never runs in this repo** (`Npm.which` resolves to a path that does not exist — ticket `a5b8ee5935`) — a SEPARATE defect, named here, not fixed here.

## Out of scope

- `edit.ts` — already fixed by t139 (commit `4aeac71a94`); only `terminated`/`Line` are now EXPORTED from it, so `write` counts lines with the SAME function instead of re-spelling it.
- The formatter's broken binary path (`Npm.which` → `node_modules\.bin\prettier` does not exist) — ticket `a5b8ee5935`, a separate defect.
- `write.ts`'s unbounded `lsp.diagnostics()` wait — a separate defect, named in the Residuals, NOT fixed here (the owner's brief scopes t140 to the read-back; widening it would be my plan, not his — the same line t139's plan wrote about `edit`).
- `write.txt` — the description promises nothing this change breaks (T4).
- `bin/`, the kernel, `prompt_kernel/`, the storage plane.

## Rollback

T2/T3 are one edit in `packages/opencode/src/tool/write.ts` (plus two exported names in `edit.ts` and the test file): reverting the commit restores the previous behaviour exactly. No data migration, no stored-state change.

## Prior art (owner, 2026-10-20: «An invention that is worse than one found, or was never compared, is not accepted»)

- **The repo — the sibling fix.** `read packages/opencode/src/tool/edit.ts:855-874` (t139, commit `4aeac71a94`): the read-back is unconditional; `diverged = !formatted && contentFinal !== contentNew`; the divergence is named. `TextCodec.syncFile` (`src/util/text-codec.ts:285-296`) is ALREADY the read-back — this task removes a CONDITION and invents no mechanism.
- **The repo — the ticket's own falsifier.** Local cell ticket `ca760c924e`: the fixture (a `Format.Service` whose `file()` rewrites the file and returns `false`) and the assertion (no plain success, the divergence named) are named THERE — this task reuses them verbatim instead of inventing a new oracle.
- **The project's own rule.** `docs/bug-policy.md:38`: «**Write-path oracles inspect the artifact.**»
- **The web.** Universal Search (hybrid) → `anthropics/claude-code#35230` «Agent with isolation:worktree reports successful writes but files unchanged on disk» (fetched; content_hash `fca6d35662fa7371bbb0c9f31d5570d09e53d39d94fbfc58fec8eb02ab6dd94f`): the same class in a sibling product — the Write tool reported success while the file on disk never changed, and the reporter's workaround was a temp file + atomic rename. Its sibling issues: #9458 «Sub-agent Write tool operations don't persist to filesystem», #4462 «Sub-agents claim successful file creation but files don't persist».
- **Why this choice beats the alternatives** — (i) trust the write: forbidden by `docs/bug-policy.md` and by the sibling issue; (ii) hash the file against a digest: the tool already holds BOTH the bytes it wrote and the bytes on disk, so the comparison is free — a digest is new machinery for a comparison already in hand; (iii) roll the write back on a divergence: applying the write is the tool's job, and the backup is the owner's undo; (iv) read back only when a formatter ran: that IS the defect; (v) atomic write (temp file + rename, the reporter's workaround): it removes a PARTIAL write, not a DIVERGENCE — it does not tell the model that the file it is about to address is not the file it wrote.
- **Why BYTES and not the decoded text** — `TextCodec.syncFile` (the text route) FAILS on a file that is not text, and a binary write is legal for `write` today. The bytes are the artefact in every case; the text is decoded from them for the report. A form change (a stripped BOM, a changed ending) is a byte difference and is therefore named — the text comparison would have hidden it.

## Residuals

- **The `write` suite is RED on this host, before and after this change, for a cause outside it.** Measured: the host has 16 GB RAM with **1 645 MB free** (`pwsh` → `Win32_OperatingSystem`), and the process inventory shows a leaked `tsserver.js` at **3 352 MB** (PID 20620), a codegraph server at 637 MB (PID 20340) and ~18 codegraph MCP servers, most of them days old. `write.ts:153` awaits `lsp.diagnostics()` with **no timeout**, so a language server that cannot boot in that memory hangs the tool until the test's 30 s timeout; the following cases inherit the dead stream (the `ERR_STREAM_WRITE_AFTER_END` cascade that `test/tool/write.test.ts`'s own header documents). `edit.ts` bounds the same wait at 1500 ms (`DIAGNOSTICS_BUDGET`), which is why the six edit suites stay green here. The remediation is the owner's: free the RAM (kill the stale `tsserver`/`codegraph` servers), and/or authorise copying `edit.ts`'s diagnostics budget into `write.ts` — a separate defect, deliberately NOT fixed by this task.
- The `task`/`pipeline` delegation lane is dead in this session («Cannot access 'ge' before initialization» — the same TDZ defect t139 recorded, and the running binary was not rebuilt), so the prior-art search was run from the primary agent instead of `researcher_agent`.
- The formatter's broken binary path (ticket `a5b8ee5935`) is untouched: it means no `.ts` file is prettier-formatted after a write, and `format.file()` returns `true` for any extension prettier claims — a formatter that never ran. With that defect, `formatted` is `true` for `.ts`/`.tsx`, so their divergence is never reported (a formatter is the explanation t139's rule accepts). Unchanged by this task.
