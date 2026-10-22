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
- **revision:** 2
- **state:** ACTIVE
- **owner brief:** t140 (owner, 2026-10-22, `UTC: 2026-10-22T02:29:14.655Z`): «write reads the file back after every write, like edit now does (t139's sibling)». Apply the SAME fix to `write`, reusing t139's pattern rather than inventing one: the result must describe the file that is really on disk, and any divergence that no formatter explains is named instead of «Wrote file successfully.» Close the ticket with the receipt. Acceptance: a red-first test that reads the file back after a write, with a mutation control; the write and edit suites stay green; `bun typecheck` and `_build.ps1` through cmd_runner; one commit that names the task; a plan with its boxes ticked on receipts; a final message with the run ids.
- **owner brief, review 1 (owner, 2026-10-22, `UTC: 2026-10-22T03:07:23.467Z`):** «T8 is authorised… Reuse `edit.ts`'s `DIAGNOSTICS_BUDGET` in `write.ts`. Do not invent a second constant… Do not free RAM by stopping processes… The test must pass on this host as it is.» Acceptance: `test/tool/write.test.ts` 23 pass / 0 fail on this host; a control (with the bound removed, the same three cases time out again); the edit suites, typecheck and the build stay green; T8 ticked on its receipt; the plan moves by its outcome in the commit that names it.

## The evidence (every line carries its instrument)

- ✓ `read packages/opencode/src/tool/write.ts:103-108` — the write is `fs.writeWithDirs(filepath, TextCodec.encode(contentNew, form.encoding))`; the file is read back (`TextCodec.syncFile`) **ONLY** inside `if (yield* format.file(filepath))`. With no formatter for the extension, `contentFinal` stays the tool's MODEL of the write and the file on disk is never read.
- ✓ `read packages/opencode/src/tool/write.ts:115` — the success line is unconditional: `"Wrote file successfully."`.
- ✓ `read packages/opencode/src/tool/write.ts:135-142` — the address report is built from `contentFinal` (the model, not the disk).
- ✓ `read packages/opencode/src/format/index.ts:82,115-123` — `formatFile` returns `false` iff NO formatter matched the extension; it returns `true` whenever one was FOUND, even when the formatter FAILED.
- ✓ `read packages/opencode/src/tool/edit.ts:861-867` (t139's fix, commit `4aeac71a94`) — the shape to reuse: `const formatted = yield* format.file(path)`; the file is read back **unconditionally**; `plan.diverged = !formatted && plan.contentFinal !== plan.contentNew`.
- ✓ `read packages/opencode/src/tool/edit.ts:914-923,930-931` — the divergence's WORDING: «Edit applied, but the file on disk is not what was written — read it back before addressing it.» and per file «the file on disk is not what was written — the edit wrote N lines, the file has M.»
- ✓ `read packages/opencode/src/util/text-codec.ts:285-296` (`syncFile`) — it reads the file back, decodes it, restores the form the write chose, and returns the text it now holds. **It FAILS on a file that is not text** — `write` may write BINARY content today, so `write` cannot use `syncFile` as its unconditional read-back without failing a legal write.
- ✓ `read docs/bug-policy.md:38` — «**Write-path oracles inspect the artifact.** Any change to a PERSISTENT_WRITE path … is verified by reading back what was written.»
- ✓ `fossil sql` on the local cell, ticket `ca760c924e99603c30414820da89bb244ef25099` — the ticket t139 filed, with ITS OWN falsifier and ITS OWN fixture («a Format.Service whose `file()` rewrites the file and returns false»). **The fixture is named by the ticket: this task reuses it verbatim.**
- ✓ `read packages/opencode/test/tool/edit-delete-writeback-t139.test.ts` — the harness to copy: `testEffect(layers)`, `tmpdirScoped()`, `provideInstance(dir)`, and the `rewritingFormat` layer.
- ✓ `read packages/opencode/src/tool/write.txt` — the description promises only what the code keeps; the divergence is a RESULT the tool prints, not a promise the description makes, and `write.txt` rides the KV-stable prefix. **CHECKED, NO CHANGE.**
- ✓ `read packages/core/src/filesystem.ts:46-48` — `existsSafe` is `fs.exists(path)` with a catch: a plain stat, no wait.
- ✓ `read packages/opencode/src/lsp/lsp.ts:238` (`getClients`) — the language server is spawned inside an **UNBOUNDED** `Effect.promise`: that is the 30 s hang's true root, and the reason a bound in the tool is needed.
- ✓ `read packages/opencode/src/lsp/server.ts` (the `extensions:` list) — **no LSP server claims `.txt`**: the configured extensions are `.ts .tsx .js .jsx .vue .py .go .rs .yaml …`. A write to a `.txt` therefore has NO server to wait for — the fact that attributes the one-off interrupt (Residuals).
- ✓ `read node_modules/.bun/effect@4.0.0-beta.57/…/internal/effect.js:1450-1455` — `Effect.timeout` is `raceFirst(self, sleep → fail(new TimeoutError()))`: a FAILURE, so `Effect.catch` handles it (an interrupt is a different cause).

## Tasks

- [x] **T1 — the red-first test.** `packages/opencode/test/tool/write-writeback-t140.test.ts` (3 cases): a NEW file and an OVERWRITE land byte-for-byte as intended, and a file that is NOT what the tool wrote is NAMED instead of swallowed. The divergence fixture is the ticket's own. Receipt: run `20261022T023815Z_1404e8be`, exit 1, **2 pass / 1 fail** — RED for the reason named: the tool answered «Wrote file successfully.» and «created — 4 lines» over a file that holds 5 lines. The file read-back assertion PASSED in the same case — **the defect is the REPORT, not the write.**
- [x] **T2 — read the file back after EVERY write.** `write.ts:103-136` — the read-back is unconditional. It must survive a BINARY write, so the BYTES are read back and decoded with the same codec `read` uses (`TextCodec.decode`), and the comparison is byte-for-byte against the bytes the tool wrote; a formatter that ran keeps `TextCodec.syncFile` (it restores the form the formatter stripped). A file that is ABSENT after the write is a divergence, not a crash.
- [x] **T3 — NAME the divergence.** `write.ts:143-151` — the success line is no longer unconditional: a file on disk that is not what the tool wrote is named («Wrote file, but the file on disk is not what was written — read it back before addressing it.») plus the per-file line with the two line counts. The filediff metadata is recomputed against the disk (`write.ts:179-185`).
- [x] **T4 — the description.** CHECKED, NO CHANGE — with the instrument above (`write.txt` read in full).
- [x] **T5 — the mutation control.** The fix's CAUSE was reverted (the read-back made conditional again): run `20261022T025048Z_d231fb59`, exit 1, 2 pass / 1 fail — the SAME case failing on the SAME assertion. Restored: run `20261022T025134Z_1a3fcac9`, exit 0, 3 pass / 0 fail.
- [x] **T6 — the suites, the typecheck, the build.** All through cmd_runner, one file per call; the receipts are the Smoke Tests table below.
- [x] **T7 — close the ticket.** The local cell ticket `ca760c924e` is closed with the receipt: the run ids and the commit that names t140.
- [x] **T8 — bound the diagnostics wait the way `edit` bounds it (owner, review 1).** DONE — `edit.ts` now EXPORTS its `DIAGNOSTICS_BUDGET` (ONE constant, `write` imports it; no second constant was invented) and `write.ts:154-169` bounds the same wait `edit` bounds — `lsp.touchFile` + `lsp.diagnostics()` together — with `Effect.timeout(DIAGNOSTICS_BUDGET)` and a debug log on the catch, degrading to an empty diagnostics map instead of hanging. **Receipts:** `test/tool/write.test.ts` is **23 pass / 0 fail on this host** — three independent runs, `20261022T030955Z_0c2318aa` (63.99 s), `20261022T032059Z_de722c6a` (110.82 s), `20261022T032725Z_3dd2821b` (75.76 s) — and the t140 suite is 4/0 in three runs (`20261022T031844Z_640f1835`, `20261022T032359Z_edb82360`, `20261022T032725Z_75a0a92f`). **The controls:** with the bound removed the suite goes red again (`20261022T031140Z_1069849f` → 22 pass / 1 fail, the root `.tsx` case timing out at 31.1 s — the same case that timed out at HEAD, `20261022T024725Z_aa9efb5c` → 20/3), and the NEW deterministic control — a language server whose `diagnostics()` never settles — times out without the bound (`20261022T031935Z_c94477db` → 3 pass / 1 fail, 30.2 s) and answers in ~1.5 s with it.

## Smoke Tests

Predicted BEFORE each run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction | actual |
|---|---|---|---|
| S1 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/write-writeback-t140.test.ts` (BEFORE the fix) | **RED** — the divergence case fails: the tool claims success over a file it did not write | **RED as predicted** — run `20261022T023815Z_1404e8be`, exit 1, 2 pass / 1 fail |
| S2 | the same file (AFTER the fix) | **GREEN** — 3 pass / 0 fail | **GREEN as predicted** — run `20261022T023942Z_919fe1fd`, exit 0, 3 pass / 0 fail |
| S3 | the same file with T2 reverted (MUTATION) | **RED** — the divergence case fails again | **RED as predicted** — run `20261022T025048Z_d231fb59`, exit 1, 2 pass / 1 fail. Restored: run `20261022T025134Z_1a3fcac9`, exit 0, 3 pass / 0 fail |
| S4 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/write.test.ts` | **RED before T8** (the unbounded wait), **GREEN after it** | **RED at HEAD and after T1-T7, identically** — run `20261022T024725Z_aa9efb5c` (fix reverted) and `20261022T025419Z_abc18c96` (with the fix): both exit 1, 20 pass / 3 fail, the same three timeouts. **GREEN after T8** — run `20261022T030955Z_0c2318aa` (23/0, 63.99 s), `20261022T032059Z_de722c6a` (23/0, 110.82 s), `20261022T032725Z_3dd2821b` (23/0, 75.76 s) |
| S5 | `… -- bun test test/tool/edit-delete-writeback-t139.test.ts` | **GREEN** — 8 pass | **GREEN as predicted** — run `20261022T033039Z_5b291be5`, exit 0, 8 pass / 0 fail |
| S6 | `… -- bun test test/tool/edit.test.ts` | **GREEN** — 25 pass | **GREEN as predicted** — run `20261022T033101Z_3898bfc4`, exit 0, 25 pass / 0 fail |
| S7 | `… -- bun test test/tool/edit-exact.test.ts` | **GREEN** — 34 pass | **GREEN as predicted** — run `20261022T033101Z_569606fc`, exit 0, 34 pass / 0 fail |
| S8 | `… -- bun test test/tool/edit-overlap-t114.test.ts` | **GREEN** — 7 pass | **GREEN as predicted** — run `20261022T033101Z_e6b2f5a2`, exit 0, 7 pass / 0 fail |
| S9 | `… -- bun test test/tool/edit-description-contract.test.ts` | **GREEN** — 7 pass | **GREEN as predicted** — run `20261022T033118Z_accbbbee`, exit 0, 7 pass / 0 fail |
| S10 | `… -- bun test test/tool/edit-label-remap-t123.test.ts` | **GREEN** — 5 pass | **GREEN as predicted** — run `20261022T033118Z_8644c4ac`, exit 0, 5 pass / 0 fail |
| S11 | `… -- bun test test/tool/edit-window-labels-t137.test.ts` | **GREEN** — 4 pass | **GREEN as predicted** — run `20261022T033118Z_ff4d201c`, exit 0, 4 pass / 0 fail |
| S12 | `cmd_runner start --cwd packages/opencode -- bun typecheck` | **GREEN** — exit 0, no diagnostics | **GREEN as predicted** — run `20261022T033248Z_206bb0f1`, exit 0, `bytes_written: 320` (`$ tsgo --noEmit` and nothing else) |
| S13 | `cmd_runner start --cwd . -- pwsh -NoProfile -File _build.ps1` (repo root) | **GREEN** — exit 0 | **GREEN as predicted** — run `20261022T033414Z_944990ea`, exit 0, «✓ built in 34.81s», «Smoke test passed: 10.0.1524», «[OK] Build complete - artifacts in dist/» |
| S14 | the t140 suite with the bound in place and the deterministic control added | **GREEN** — 4 pass / 0 fail | **GREEN as predicted** — run `20261022T031844Z_640f1835`, exit 0, 4 pass / 0 fail, 9 expect() calls |
| S15 | the t140 suite with the bound REMOVED (the deterministic control) | **RED** — the never-answering server stalls the tool into the 30 s ceiling | **RED as predicted** — run `20261022T031935Z_c94477db`, exit 1, 3 pass / 1 fail («a language server that never answers does not stall the write» timed out after 30000 ms) |
| S16 | `… -- bun test test/tool/write.test.ts` with the bound REMOVED (the suite-level control) | **RED** — the unbounded wait times out again | **RED as predicted** — run `20261022T031140Z_1069849f`, exit 1, 22 pass / 1 fail (the root `.tsx` case, 31.1 s). **A second control run on a WARM server was GREEN** (`20261022T031424Z_1cf1f868` → 23/0): the unbounded wait is a RACE against the server's boot, which is exactly why the deterministic control (S15) exists — a bound must not be proven by a host's mood |

## Risks

- **The read-back costs one file read per write.** It replaces a write and, when a formatter ran, an existing read — the net cost is one read per write with NO formatter.
- **A binary write has no text.** `TextCodec.syncFile` FAILS on a file that is not text, so the unconditional read-back compares BYTES (the artefact) and reports the text only when there is one.
- **A file that is ABSENT after the write** must be NAMED, not reported as a success. The read-back checks for the file's presence first (`fs.existsSafe`, a plain stat).
- **The bound turns a hang into a degraded result** — the tool answers with no diagnostics instead of waiting. A diagnostics timeout is now a debug log line, not a stalled tool.
- **The formatter never runs in this repo** (`Npm.which` resolves to a path that does not exist — ticket `a5b8ee5935`) — a SEPARATE defect, named here, not fixed here.

## Out of scope

- `edit.ts`'s behaviour — only `DIAGNOSTICS_BUDGET` is now EXPORTED (and `terminated`/`Line` from T2), so `write` reuses the sibling's constant instead of a second one.
- The LSP layer's unbounded spawn (`src/lsp/lsp.ts:238`) — the 30 s hang's true root; a bound THERE would fix `edit` too. Named in the Residuals, not fixed here.
- The formatter's broken binary path — ticket `a5b8ee5935`.
- `write.txt` — the description promises nothing this change breaks (T4).
- `bin/`, the kernel, `prompt_kernel/`, the storage plane, and the host's leaked processes (the owner's instruction: reported, not touched).

## Rollback

T2/T3 are one edit in `packages/opencode/src/tool/write.ts` (plus exported names in `edit.ts` and the test file); T8 is one export in `edit.ts` and one bounded block in `write.ts`. Reverting the commits restores the previous behaviour exactly. No data migration, no stored-state change.

## Prior art (owner, 2026-10-20: «An invention that is worse than one found, or was never compared, is not accepted»)

- **The repo — the sibling fix.** `read packages/opencode/src/tool/edit.ts:855-874` (t139, commit `4aeac71a94`): the read-back is unconditional; `diverged = !formatted && contentFinal !== contentNew`; the divergence is named. `TextCodec.syncFile` (`src/util/text-codec.ts:285-296`) is ALREADY the read-back — this task removes a CONDITION and invents no mechanism.
- **The repo — the ticket's own falsifier and fixture.** Local cell ticket `ca760c924e` names both; this task reuses them verbatim instead of inventing a new oracle.
- **The repo — the sibling's budget (T8).** `edit.ts`'s `DIAGNOSTICS_BUDGET` ("1500 millis") is the mechanism the owner authorised for `write`; it is now EXPORTED and shared — ONE constant, the sibling's own, not a second one.
- **The repo — the stub precedent.** `test/tool/lsp.test.ts:34-56` already stubs `LSP.Service` with `Layer.succeed(LSP.Service, LSP.Service.of({…}))`; the deterministic control reuses that shape with a `diagnostics()` that never settles.
- **The project's own rule.** `docs/bug-policy.md:38`: «**Write-path oracles inspect the artifact.**»
- **The web.** Universal Search (hybrid) → `anthropics/claude-code#35230` «Agent with isolation:worktree reports successful writes but files unchanged on disk» (fetched; content_hash `fca6d35662fa7371bbb0c9f31d5570d09e53d39d94fbfc58fec8eb02ab6dd94f`): the same class in a sibling product. Its siblings: #9458, #4462.
- **Why this choice beats the alternatives** — (i) trust the write: forbidden by `docs/bug-policy.md` and by the sibling issue; (ii) hash the file against a digest: the tool already holds BOTH the bytes it wrote and the bytes on disk, so the comparison is free; (iii) roll the write back on a divergence: applying the write is the tool's job, and the backup is the owner's undo; (iv) read back only when a formatter ran: that IS the defect; (v) atomic write (temp+rename): it removes a PARTIAL write, not a divergence. **Why BYTES and not decoded text:** `syncFile` fails on a file that is not text, and a form change (a stripped BOM) is a byte difference the text comparison would hide. **Why a DETERMINISTIC control and not only the suite:** the unbounded wait is a race against the language server's boot, so a suite-level control flips with the host's mood (S16) — the bound's proof must be host-independent (S15).

## Residuals

- **The 30 s hang's true root is in the LSP layer, not in the tool.** `src/lsp/lsp.ts:238` (`getClients`) spawns a language server inside an UNBOUNDED `Effect.promise`; the tool's bound contains it, but the server still boots in the background. A bound in the LSP layer would fix `edit` the same way and is the owner's call — a separate defect, named, not fixed here.
- **One-off, attributed, not reproduced.** Run `20261022T032059Z_9a5be602` (the t140 suite ∥ the write suite under a load spike) ended the divergence case with «All fibers interrupted without error» (3 pass / 1 fail). **It is not this bound:** that case writes a `.txt`, and no LSP server claims `.txt` (`src/lsp/server.ts`), so the diagnostics wait there is ~0 ms and the 1500 ms timeout could not have fired — the interrupt came from the test harness's instance-disposal race between consecutive cases. Not reproduced in three subsequent runs (solo and in parallel).
- The `task`/`pipeline` delegation lane is dead in this session («Cannot access 'ge' before initialization» — the same TDZ defect t139 recorded), so the prior-art search was run from the primary agent instead of `researcher_agent`.
- The formatter's broken binary path (ticket `a5b8ee5935`) is untouched: no `.ts` file is prettier-formatted after a write, and `format.file()` returns `true` for any extension prettier claims — a formatter that never ran. With that defect, `formatted` is `true` for `.ts`/`.tsx`, so their divergence is never reported (a formatter is the explanation t139's rule accepts). Unchanged by this task.
- The host's memory pressure (16 GB RAM with 1 645 MB free; a leaked `tsserver.js` at 3 352 MB, PID 20620; ~18 codegraph MCP servers) is REPORTED to the owner and deliberately NOT touched — the owner's instruction, and the bound makes the tools independent of it.
