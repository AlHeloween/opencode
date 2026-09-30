# `multiedit` — make the promised atomicity true

<!-- intention: multiedit's documented contract says a failing edit applies nothing, while the implementation wrote every edit as it went and left the earlier ones on disk -> resolve every edit in memory first and write the file once, so the promise is structural and the failure report is truthful -->

- **plan_id:** 2026-09-30_multiedit-atomic-application
- **revision:** 1
- **state:** ACTIVE
- **trigger:** `@KAIZEN` — second recorded occurrence, so another workaround was forbidden and the countermeasure was due.
- **record:** `experiments/2026-09-30_multiedit-partial-apply/`

```yaml
Keywords: multiedit-atomicity 0.30, kaizen-countermeasure 0.22, dry-run-buffer 0.18, single-write 0.14, first-test 0.10, honest-report 0.06
Semantic dominant: multiedit wrote each edit to disk as it went and promised a rollback it never had; it now resolves every edit in memory first and writes once, so a failure writes nothing and says so.
md5: c0a71f3d58e9462b7fb1840dc6a2f9e3
prev-md5: 9f4c2e8b1a7d6305ce8f2b40d9175a86
parent-goal-md5: d99945d67a57440775f414e816c78773
```

## Why

`multiedit`'s own description promised: «All edits are applied in sequence within a single file. If any
edit fails (oldString not found, multiple matches), **none are applied** — the file is rolled back to
its original state.» **No rollback existed anywhere in the implementation.** Measured with three
probes (valid→impossible left the first write on disk; impossible→valid changed nothing; both-valid was
the control), reproduced 2026-09-30, first reported 2026-09-29 in `_progress_log.md` — where the
response recorded was a *habit* («read STATE after any edit, never the report»), not a repair. That
made this the **second occurrence**, and @KAIZEN forbids a second workaround.

Mechanism: `src/tool/multiedit.ts:47-60` ran one `editTool.execute(...)` per entry and `edit` writes
the file immediately, so a later failure left the earlier writes in place while the report named only
the failing entry — an agent that retried re-applied them. No test existed: `glob
test/tool/multiedit*.ts` → no files.

## Decision

Resolve every edit against an **in-memory buffer** first, then write **once**. The promise becomes
structural rather than compensating: on failure there is nothing to roll back because nothing was
written. The matcher (`replace`) and the line-ending pipeline (`normalizeLineEndings`,
`detectLineEnding`, `convertToLineEnding`) are **imported from `edit.ts`** rather than re-implemented —
a second spelling of one rule is the defect. The single write goes through `editTool.execute`, so
everything inherited is preserved: the file lock, the backup, the permission prompt with the real diff,
the formatter, the bus events, diff stats and LSP diagnostics.

## Tasks

- [x] M1 `src/tool/edit.ts` — export the three line-ending helpers (no behaviour change)
- [x] M2 `src/tool/multiedit.ts` — dry run over the buffer, then one write; failure reports the entry index and states that nothing was written
- [x] M3 `src/tool/multiedit.txt` — contract rewritten to match the implementation
- [x] M4 `test/tool/multiedit.test.ts` — first test suite for the tool: the three probes, sequential application, create-seed, and "a failure while creating leaves no file"
- [x] M5 oracles run and green (see below)
- [x] M6 candidate built and the artifact read back

## Release

`pwsh -File _build.ps1 -Task build` → `[OK] Build complete - artifacts in dist/`, run
`run-1`, full log at `.opencode/data/tool-output/tool_0f1e6fb19001UCbeJ0Fh4oaA48`.

**`-Task release` was deliberately NOT used**: `Invoke-Release` calls `Invoke-Check`, which runs
`bun test` **with no path** — the full package suite AGENTS.md forbids (measured 2026-09-22: 18
minutes, `bytes_written: 0`, ~5 GB RSS). Build only; the checks were run scoped instead.

The artifact was read back rather than assumed: `dist/bin/opencode.exe` mtime `2026-09-30 18:40:50`,
and `findstr /M /C:"NOTHING was written" dist\bin\opencode.exe` → `dist\bin\opencode.exe`, i.e. the
new code is **inside the compiled binary**. Control on the same instrument (`findstr /M /C:multiedit`
on the same file) matched first, so the hit is not an artefact of findstr refusing to read binaries;
the `grep` tool, by contrast, reported «No matches» on that directory — a claim about its own
binary-handling, not about the artifact.

**`bin/` was NOT touched.** `_build.ps1` writes only to `dist/`; promoting a candidate into `bin/`
is the owner's own procedure and needs their explicit word (AGENTS.md, 2026-09-24). The owner's live
runtime therefore still runs the pre-fix binary until they promote.

## Smoke Tests

| # | oracle | result |
|---|---|---|
| M-S1 | `bun test test/tool/multiedit.test.ts` (cwd `packages/opencode`) | **6 pass / 0 fail / 17 expect**, exit 0 — run `20260930T103352Z_d5f7b3c1`, and again `20260930T103503Z_7ff0f65f` after the mutation was reverted |
| M-S2 | **mutation check** — defect restored by writing the partial buffer inside the failure path | **RED, exactly as required**: «NOTHING is written» failed showing `line1: PATCHED-A` on disk instead of the seed, and «failure while creating» saw `exists` instead of `absent` — run `20260930T103434Z_30871ad5`. The suite can fail, and fails on this defect |
| M-S3 | `bun test test/tool/edit.test.ts` — regression for the `edit.ts` export change | **UNKNOWN** — the instrument could not run it: two attempts (runs `20260930T103422Z_1a8ffd0e`, `20260930T103539Z_677dc941`) left `state.json` at `status: running` with `bytes_written: 0` while `joboutput` reported `failed`. A silent instrument colours nothing green. Qualifying on a smaller deterministic fixture of the SAME file worked: `bun test test/tool/edit.test.ts -t creates` → **4 pass / 0 fail / 8 expect, 37 filtered out, exit 0** — run `20260930T103646Z_7f51b68f`. The `edit` write path is additionally exercised end-to-end by every green case in M-S1, since the single write goes through `editTool.execute` |
| M-S4 | `bun typecheck` (cwd `packages/opencode`) | **exit 0, zero diagnostics** — `tsgo --noEmit`, run `20260930T103712Z_b38bd6fe` |

M-S2 is the instrument that keeps M-S1 honest: a suite that cannot fail proves nothing.

## Risks

- **R1** Mixed line endings: the dry run normalises through `edit`'s pipeline, so a file whose endings
  are inconsistent could resolve differently than `edit`'s fuzzy stage-2 match. If it did, `edit` would
  throw **before writing** — no partial state, only a refused edit. Bounded, not silent.
- **R2** `metadata.results` shape changed from «one entry per `edit` call» to «one entry per resolved
  step». The TUI reads it as `{ diff?, filediff? }[]` (`cli/cmd/tui/routes/session/index.tsx:3404`), so
  the per-step shape renders the same or better.
- **R3** A `multiedit` that resolves to no change now returns a "no change" report instead of provoking
  `edit`'s «oldString and newString are identical» error.

## Rollback

`git revert` of the single commit.

## Sibling — UNKNOWN, not assumed

`applypatch` advertises the same atomicity in its description. Its implementation was **not read**;
whether it shares the hole is `Unknown`. Named so the next cycle checks rather than re-derives.
