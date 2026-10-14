# _progress_log.md — find who double-encodes it, repair what is exactly repairable, make the next one impossible

<!-- intention: the owner and every agent read `_progress_log.md` as it was written (✓, —, Cyrillic) -> the writers that double-encode UTF-8 entries are named and stopped, the exactly repairable damage is repaired with a reversible, verified edit, and a check fails the moment a new mojibake line appears -->

<!-- goal_sv: progress-log-encoding, mojibake-writer, roundtrip-repair, encoding-guard, reading-procedure -->

- **plan_id:** 2026-10-14_progress-log-mojibake
- **revision:** 1
**Status:** COMPLETE
- **reported:** owner, 2026-10-13: «проблемы с чтением файлов … Эту проблему надо тоже решить, отправь робота» (the log reads as `РїСЂР°РІРѕРє`, `вњ“`, `вЂ”`).
- **why it matters:** `read` decodes valid UTF-8 correctly, so the file is the defect, not the tool: UTF-8 bytes were read as cp1251 and saved as UTF-8 again. Every agent that reads the log (`read`, `recall`, grep) sees garbage in those entries, and `grep` shows `[Omitted long matching line]` over them.

```yaml
Keywords: progress-log-encoding 0.30, mojibake-writer 0.24, roundtrip-repair 0.22, encoding-guard 0.16, reading-procedure 0.08
Semantic dominant: Name the writers that double-encode the progress log, repair the exactly repairable lines reversibly, and add a guard against new damage.
md5: 7e3a9c1d5b2f4086a1c7e9d3b5f20c48
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (instrument named; census run 2026-10-14 on the working copy, bytes 1 289 099)

- ✓ round-trip census (`line.encode("cp1251").decode("utf-8")` succeeds AND changes the line, only lines with a non-ASCII char): **2 521 lines** of 6 796 are exactly repairable mojibake (`## [2026-10-12T12:35Z] kernel delivery вЂ” bounded` → `… — bounded`, `вњ“` → `✓`); first at line 25, last at 6 778; 1 598 runs, spread evenly over the file (per 700 lines: 302, 324, 258, 258, 223, 138, 295, 184, 328, 211).
- ✓ the other 99 non-ASCII lines are NOT repairable by that round trip; 77 of them still carry mojibake lead pairs (a partly damaged line, or a character outside cp1251), ~22 are real text. They need a per-line judgment, never a blind pass.
- ✓ the file is not uniformly damaged: lines 6 792–6 795 (2026-10-13) carry REAL `—`, `«…»` and Cyrillic. So at least one writer is fine today and at least one was not; damage is per ENTRY.
- ✓ file facts: UTF-8 BOM present; CRLF 6 786, LF-only 9 lines. Any repair keeps the BOM and every line ending as found.
- ✗ a first estimate («no clean Cyrillic line exists») was a regex artefact and is REFUTED by lines 6 792–6 795.
- Unverified claims from a forwarded report (testimony, check them): `Set-Content -Encoding utf8` adds a BOM and mangles non-ASCII; `build_portable.ps1` carries old mojibake.

## Tasks

- [x] **T1 — name the writers.** Find which writers produced the damaged entries: correlate each damaged run with its timestamp header, its commit author/robot session (`git log -L` / `git blame` on the runs, `.opencode/data/opencode.db` sessions) and the append path it used (PowerShell `Add-Content`/`Out-File`/`Set-Content` without an explicit encoding, `cmd` redirects, a Python writer without `encoding=`). Deliverable: the writer(s) with the evidence per class, in the plan; fix the writer where the code is ours (instrument or script in the repo), otherwise add the rule to the place agents read first. Oracle: a fresh entry appended by each named writer reads back byte-correct (read the file back, not the writer's report).
  ✓ 2026-10-13 — Writers, with evidence. (A) `bash` echo through cmd.exe: session `ses_ecf8c7b1…`, entry `[2026-10-12T14:50Z] agents-row-provider` — the middle dot `·` was written as the cp866 byte `0xFA` (invalid UTF-8; the whole lesion is 2 bytes in 1 059 800) and the em dash was silently replaced by `-`; reproduced in a sandbox. (B) the read+edit pipeline: session `ses_ecf8a8d9…` — `read` classified the not-quite-UTF-8 file as legacy ANSI windows-1251, `edit` saved it whole double-encoded — commit `7d45f72fb3`, 2 521 lines. Fix for B (our code): `text-codec.decode` gains the near-UTF-8 branch (`utf8Health`: invalid>0 and invalid·4 ≤ multibyte → UTF-8, only the stray bytes replaced); text-codec 16/0 `20261013T215355Z_a5db6b8c`, branch disabled → red `20261013T215339Z_671d39f5`, regressions edit 25/0 `20261013T215400Z_29c56b6a`, write 21/0 `20261013T215451Z_f2d5ee82`, read-address 22/0 `20261013T215457Z_b2917fd0`. Stopped A by rule: AGENTS.md § Shell Command Restrictions — never write file content through shell echo/redirect. Oracle: the fresh entry in `_progress_log.md` (2026-10-13T21:56Z) written through `edit` reads back with exact marker bytes (middle dot c2 b7, em dash e2 80 94, ellipsis e2 80 a6, « c2 ab, ≤ e2 89 a4); ADM-written bytes verified byte-exact in the T3 rehearsal.
- [x] **T2 — census of tracked text files.** The same precise detector over `git ls-files` for `*.md *.ps1 *.py *.ts *.cmd *.json` (read-only script; a script may READ and MEASURE). Output: file, damaged-line count, repairable count. Only `_progress_log.md` is repaired by this plan; every other file with damage becomes a named residual row.
  ✓ 2026-10-13 — 4 927 tracked files scanned (`experiments/2026-10-14_progress-log-mojibake/census.py --tracked`): `_progress_log.md` was the ONLY file with round-trip damage (2 521). 30 files carry exploratory «seg» flags; a sample (`packages/ui/src/i18n/uk.ts`, `plans/2026-10-01_tool-description-contracts.md`) shows ordinary multilingual text — false positives of the exploratory segment detector; the exact predicate gives `repairable = 0` for every file (the guard runs it repo-wide, green). Residual row: refine the segment detector only if a real case appears.
- [x] **T3 — repair `_progress_log.md`, reversibly.** Restore the 2 521 exactly repairable lines; leave every other byte alone (the BOM, CRLF/LF per line, the 22 real-text lines, the lines you cannot repair — list them by number). Route: AGENTS.md forbids rewriting source with an unverifiable script — read `docs/tool-playbook.md` § ADM and use an `updates/*.xml` descriptor via `adm` (baseline, backup, rollback block, ledger) or hand `edit`/`write` hunks; do NOT run a bare script over the file. The 77 partly-broken lines: repair only what a segment-wise round trip proves, show the before/after of each, and leave the rest untouched with the numbers named. Oracle (independent of the repair route): (a) the census over the result reports 0 round-trip-repairable lines; (b) for every line the repair did not touch, bytes are identical to the pre-repair file (compare against `git show HEAD:_progress_log.md` and the backup); (c) BOM and the CRLF/LF pattern of untouched lines are unchanged; (d) `read` of lines 25–33 and 6 600–6 610 shows `—`, `✓` and Cyrillic.
  ✓ 2026-10-13 — Repaired via ADM: `updates/2026-10-14_progress-log-repair.xml` (root `updates/..`), 2 598 single-line blocks = 2 521 round-trip + 77 via the U+0098→0x98 extension (U+FFFD count in the file was 0 — every byte of the lesion was recoverable). Route facts, qualified on fixtures first (`experiments/2026-10-14_progress-log-mojibake/`): the descriptor is read in text mode (CRLF→LF), so only CR-free single-line anchors work (multi-line ones all no-op — measured); a Cyrillic file trips `is_probably_binary`, and ADM's binary path is a plain `bytes.replace` with no line-ending or blank-block normalisation. Rehearsal on a copy: result byte-identical to the ideal decode (1 101 373 B, 0 mismatched bytes, BOM/CRLF/LF intact). Live run: UPDATED 2 594 / SKIP 4 (absorbed overlaps) / ABORT 0. Oracle: (a) census `repairable = 0`; (b) exactly the 2 598 targeted lines changed, each equal to its ideal decode, untouched parts byte-identical (pre-repair copy: `experiments/…/pre-repair-backup.md`); (c) BOM intact, CRLF 6 786 / LF-only 9 preserved; (d) lines 25–33 and 6 600–6 610 read `—`, `✓`, `→`, `«»`, Cyrillic. Left alone, numbers named: 1, 3, 5, 6, 8, 9, 11, 12, 14, 16, 17, 19, 21, 22, 24, 6 780, 6 787, 6 790, 6 792–6 795 (real text; 6 780 also carries writer A's silent em-dash loss, not round-trip repairable). `adm --rollback _progress_log.md` restored the pre-mutation state byte-exact — reversibility proven on the live file.
- [x] **T4 — a guard.** A check that FAILS when a new mojibake line (the same round-trip predicate) enters a tracked text file, wired into an existing gate (a named test under `packages/opencode/test/` or the repo's check script — find what already guards file hygiene, reuse before inventing; one named file per run, never a bare `bun test`). Red first: a fixture with one damaged line fails; mutation-check it. Do not widen it to files the census named as residual unless they are clean.
  ✓ 2026-10-13 — No existing file-hygiene check found (plan-hygiene is about `plans/`), so the guard is a new named test: `packages/opencode/test/util/mojibake.test.ts` — the same round-trip predicate over every tracked text file (`git ls-files`, the census's extensions). Predicate built in Bun from `TextDecoder("windows-1251")` (verified: byte 0x98 → U+0098; fixture lines are GENERATED as utf8→cp1251-decode, never hand-typed). Green 4/0 `20261013T215140Z_42620d41` and `20261013T215619Z_e255377b`; «red first» proven live: one damaged line inserted via ADM → red naming `_progress_log.md: lines 2` (`20261013T214915Z_327e74f6`) → `adm --rollback` → green. Run as one named file: `bun test test/util/mojibake.test.ts`.
- [x] **T5 — close.** `svm render` from the repo root, boxes only for what an artifact (a run id) confirms, docs where the rule lives (`docs/` index only if a new doc is added), `_build.ps1` through `cmd_runner` per AGENTS.
  ✓ 2026-10-13 — Records and build: `svm render` from the repo root closed the «not in MASTER_PLAN» gap (it listed exactly this plan as `gapsBefore`). `pwsh -NoProfile -File _build.ps1` through cmd_runner: run `20261013T215858Z_fd0d6078`, exit 0, version 10.0.1321, smoke `dist/opencode-windows-x64/bin/opencode.exe --version`, `[OK] Build complete - artifacts in dist/`. The writer rule lives in AGENTS.md § Shell Command Restrictions; the ADM facts were added to `docs/tool-playbook.md` § ADM (no new doc, so no docs/ index change). S1–S5, measured: S1 = 2 521 repairable + 98 other (seg 77, real 21 — the plan's «99» counted the file one line earlier); S2 = guard red on the generated fixture line and on a live one-line mutation; S3 = the guard is new, so its pre-repair red was demonstrated post-repair via the live mutation naming `_progress_log.md: lines 2` (`20261013T214915Z_327e74f6`); S4 = 0 repairable, all 2 598 changed lines = ideal decode, untouched byte-identical (also across the CRLF→LF normalization against `git show HEAD`, 4 198 lines, 0 diffs), BOM/CRLF/LF intact; S5 = 4/0 green. Post-closure: the automatic plan hygiene (`reconcilePlans`, 0 open boxes) moved this file to `plans_completed/`; the commit remains the delegator's per their instruction.

## Smoke Tests

| # | Instrument | Prediction BEFORE the run (delegator's forecast — withheld from the robot) |
|---|---|---|
| S1 baseline | the census script over `_progress_log.md` | 2 521 repairable, 99 other non-ASCII (matches the evidence above) |
| S2 guard red | new guard test over a one-line mojibake fixture | FAIL |
| S3 guard on today's file | the guard over the current `_progress_log.md` BEFORE the repair | FAIL (damage present) |
| S4 after T3 | census + byte-compare against `HEAD` | 0 repairable; untouched lines byte-identical |
| S5 after T3 | guard over the repaired file | PASS |

A full `bun test` is forbidden — one named file per call, from `packages/opencode`.

## Out of scope

Anything in `recall`/`read` (plan `2026-10-13_recall-read-address-space`, another robot works there — do not touch its files); the `cmd_runner` capture defect; repairing files other than `_progress_log.md`.

## Rollback

The ADM rollback block / the backup written before T3 restores the file byte-identically; `git revert` for the guard.
