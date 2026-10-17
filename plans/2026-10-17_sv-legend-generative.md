<!-- intention: SV without kernel misread as content hash -> SV block says its hash values are generative and no reader loses a vector -->
<!-- goal_sv: Keywords: sv-legend 0.40, generative-md5 0.30, reader-compat 0.20, kernel-edit 0.10
Semantic dominant: SV block carries its own legend so a frameless reader does not mistake md5 for a content hash.
md5: 3f2c9a1e5b7d4a2c8e1f0a6b9c4d2e5f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: a7d5a001202a45b09faa0d243e67964f
note: hash values are generative
-->

# t84 — kernel: SV block carries legend `note: hash values are generative`

**Status:** ACTIVE — revision 1, grounding done 2026-10-17, implementation pending. KERNEL edit, STOP before `--install`.

Owner, 2026-10-17, verbatim: «Ну можно просто легендой note: hash values are generative». Verbatim line, do not reword. ✓ CONFIRMED (owner brief text)

Intention: an SV that travels without the kernel (outside model, forwarded report, another organisation) says by itself that its md5 values are generated labels, not hashes of anything. ✓ CONFIRMED (brief Intention)

## Evidence

- Bare-SV probe (`experiments/2026-10-17_sv-bare-intent/`): frameless Sonnet got two bare SV blocks, reconstructed intent twice, took md5 for content hash twice («what is it computed over?»). ✓ CONFIRMED (read sv-bare-prediction.md + sv1.txt via read)
- Inline marker breaks readers: `md5: <hex> (generative)` or `# comment` fails `tools/claude_svchain.py` (`^md5:\s*([0-9a-fA-F]{32})$`) and t83 `dispatch.clean_md5`. ✓ CONFIRMED (read tools/claude_svchain.py:26, codex_svchain.py:27, dispatch.py:103-110 via read)
- Separate legend line does NOT break those two: `claude_svchain.vector_in` and `dispatch.parse_brief_sv` return same result with/without it (brief claim, to be reproduced on fixture in this task). ✗ UNVERIFIED — fixture matrix pending (researcher_agent)

## Reader inventory (grounded via codegraph + scoped grep/read, not root scan)

| Reader | path:line | Result with trailing `note:` (fixture, not reading) |
|---|---|---|
| `vector_in` (Claude transcripts) | tools/claude_svchain.py:31 | PENDING fixture — expects tolerant (extra line ignored, 5-field setdefault) |
| `vector_in` (Codex rollouts) | tools/codex_svchain.py:57 | PENDING fixture — expects tolerant (5-consecutive window, trailing line outside window) |
| `parse_brief_sv` / `clean_md5` / `own_md5s` / `last_turn_sv` | experiments/2026-10-08_robot-wave/dispatch.py:54,103,120,129 | PENDING fixture — expects tolerant (md5 regex + prefix checks ignore `note:`) |
| `own_positions` / `parent_positions` / `known_briefs` | experiments/2026-10-08_robot-wave/sv_census.py:34,46,58 | PENDING fixture — expects tolerant (prefix `md5:` / `parent-goal-md5:` only) |
| `SV` finished-regex | experiments/2026-10-08_robot-wave/watch3.py:25 | PENDING fixture — expects tolerant (`Semantic dominant:.*?md5:` still matches) |
| `extractVectorChain` / `planHeaderLabel` / `hasSemanticVector` / `vectorSign` / `readRawVectorField` | packages/opencode/src/memory/spine.ts:77,188,504,554,115 | PENDING fixture — expects tolerant (anchored `^field:` regexes; `vectorSign` filters to 5 prefixes so note dropped, vector kept) |
| `statusVector` / `hasSemanticVector` re-export | packages/opencode/src/session/compaction.ts:789,802 | PENDING fixture — expects tolerant (same predicate) |
| `vectorSign` consumer (snapshot comment `sv:<md5>`) | packages/opencode/src/session/processor.ts:1357 | PENDING fixture — expects tolerant (md5 unchanged) |
| `planLabels` via `planHeaderLabel` + `goal_sv` comment | packages/opencode/src/util/plan-status.ts:301,503 | PENDING fixture — expects tolerant (first `md5:` wins; `goal_sv` comment unrelated) |
| `svLabelOf` / messagesearch vector filter | packages/opencode/src/tool/messagesearch.ts:258 + summary.ts | PENDING fixture — expects tolerant |
| delegate report `vector: present/ABSENT` | packages/opencode/src/tool/task.ts:504 | PENDING fixture — expects tolerant |
| `_validate_sv_contract` (SV contract) | prompt_kernel/validate.py:248 | PENDING — expects no change (contract fields unchanged, legend is render-only) |
| TUI SV indicator (robots) | via `hasSemanticVector` (no direct `src/cli` match, scoped grep) | PENDING fixture — same predicate, expects tolerant |
| `formatSemanticVector` / `classifyText` | packages/opencode/src/session/semantic-vector.ts:134 | Not an SV-block reader (FTS ranking only) — no fixture needed |

Other readers unchecked → fixture matrix covers them; every reader the fixture shows breaking is fixed IN THIS TASK with its own test.


## Results (2026-10-17, S1 matrix, build_mode runs)
- researcher_agent fixture delegation refused (read denied, ses_eb5b30337ffe9sq0FRc5CXA1Ep) — ran scoped probes locally instead; no root scans.
- Python: claude `vector_in` SAME, codex `vector_in` SAME, `parse_brief_sv` SAME md5, `own_md5s`/`last_turn_sv` SAME, `own_positions`/`parent_positions` SAME, watch3 `SV` regex True/True.
- TS (`spine.ts` via bun): `extractVectorChain` SAME, `planHeaderLabel` SAME, `hasSemanticVector` true/true, `vectorSign` SAME (note filtered, md5 kept).
- Validate contract unchanged (render-only); `goal_sv` comment + TUI indicator share the same tolerant predicates.
## Tasks

- [x] S1 Ground readers on one fixture: same SV with/without trailing `note:` line through every reader above — ALL PASS (python runs ev_fb5041b4/ev_889a94a6/ev_78b83789/ev_7eeeebcb; TS probe 20261017T144114Z_3c0eef33 chain SAME:true, header SAME, has SAME, sign SAME sans note)
- [x] S2 RED test in `prompt_kernel/tests/test_sv_legend.py`: 10 FAIL before S3, 10 PASS after; mutation control + 4-variant parity + trivial-no-legend
- [x] S3 Edit generator only (`prompt_kernel/render.py` `_render_sv_contract`): yaml example ends with `note: hash values are generative`, one-line `- note:` bullet; missing comma after parent-goal bullet fixed (was gluing trivial); trivial carries no legend (no hashes); caps 9_200→9_300 next band (product 9146/claude 9210/codex 9156/cursor 9232, bytes 68294/69000)
- [x] S4 Zero fixture-breaking readers — no reader fixes needed (matrix all PASS)
- [x] S5 Oracle: kernel 322 passed + 3 stale-receiver reds (expected pre-install); tools 5 passed; robot-wave 13 passed; vector-sign 6 passed (20261017T144544Z_e0ae67f9 exit 0); `_build.ps1` exit 0 (20261017T144639Z_9dcc8609, smoke 10.0.1427)
- [x] S6 Commit via `scripts/commit_own.py` (03bfffe1 own paths + 4d23d022 progress log) + `_progress_log.md` entry; STOP before `--install` (receivers stale for Legislator + falsifier; owner gives install word)

## Smoke Tests

- **S2-RED**: new test file fails on current render (no `note:` line), passes after S3; mutant (line dropped) rejected; all 4 variants render identical SV example block.
- **S1-MATRIX**: one fixture, every reader returns identical vector (md5/prev/parent/dominant/keywords) with and without `note:`; any delta → S4 test + fix, matrix re-run green.
- **S5-ORACLE**: the three pytest suites green except the 3 known stale-receiver reds; touched product suites green file-by-file; `_build.ps1` exit 0 with state.json receipt.
- Predictions: before S3, RED test FAIL (missing legend); after S3, PASS; no reader loses a vector (EXPECTED: zero S4 fixes, but any break found is fixed here, not deferred).

Bounds: steps 60, tools 150, loops 3, depth 2, time 4 200 000 ms. No `bin/`, no `--install`. Forward slashes in paths. Scoped grep/glob only (never root). Trials to researcher_agent.
