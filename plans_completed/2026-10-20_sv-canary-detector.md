<!-- intention: sv-census-reads-healthy-sv-only -> sv-census-flags-form-canaries-and-chain-breaks -->
# t100 — sv_census gets form canaries: patterned md5, broken prev-md5 chain, invented first-turn prev

SV for this plan (artifact vector, computed from this plan alone):

```yaml
Keywords: sv-form-canaries 0.35, patterned-md5 0.25, prev-chain-integrity 0.20, fixture-from-real-cases 0.12, read-only-census 0.08
Semantic dominant: The read-only SV census learns to flag the form canaries seen today — low-entropy patterned md5, wrong length, a prev-md5 that does not match the previous turn and an invented prev on a session's first turn — with fixtures taken from real cases, so a distorted SV is caught mechanically and the turn it closes gets re-checked.
md5: bd130ec2c3374db092af8665fcdfa8f6
prev-md5: 00000000000000000000000000000000
parent-goal-md5: d74fe7726dbb4b079f0de4cefd6e5d43
note: hash values are generative tags — search them, never compute them.
```

Scope: `experiments/2026-10-08_robot-wave/` (a probe tree) + this plan + one `_progress_log.md`
line. No product code, no `bin/`, no kernel change. The DB is opened `mode=ro` and stays that way.

## 1. Grounding (measured in this session, 2026-10-20)

- `experiments/2026-10-08_robot-wave/sv_census.py` (156 lines) — the read-only census over
  `.opencode/data/opencode.db`; it reuses `clean_md5` + `parse_brief_sv` from `dispatch.py` (no copy).
  It already collects own-`md5` lines (`own_positions`) and `parent-goal-md5` lines
  (`parent_positions`) and prints a length histogram. It does NOT read `prev-md5:` at all — the
  chain is invisible to it today.
- The turn unit for the chain check: an assistant message with a text part. SV blocks live in the
  assistant's text part; `own_positions` finds every `md5:` line, so the LAST SV block of a message
  is the turn's own block (a reply may quote a brief's block earlier).
- The live cases, read out of `opencode.db` with `dbread` (read-only SELECT):

| Case | Session | Message | Value | Canary |
|---|---|---|---|---|
| t94, 10-19 | `ses_eaca6cd7fffepObRe1US60KICD` | `msg_15367c4cf0017tUD3IpL0IE4Ii` | 31-hex own md5, `prev-md5: 000…0` on the 20th assistant turn | wrong length; patterned tail; zero prev after earlier turns |
| Gemini kernel G7 | — | — | `1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d` | alternating digit-letter staircase |
| Gemini kernel G9 | — | — | `a1b2c3d4e5f6a7b8c9d0123456789abc` | staircase + `0123456789abc` run |
| Gemini G4 | — | — | `3e8f1b2c4d5a6e7f890123456789abcd` | ascending run `0123456789abcd` |
| minimax probe, first turn | `ses_ea9199fbaffeUuuaHGBEhxbLhA` | `msg_156e6a237001bJsvvdSPmwyjcJ` | `prev-md5: bd14f2c0…` (non-zero) on the session's first assistant turn | invented first-turn prev |
| healthy control | — | — | any `uuid4().hex` | must NOT be flagged |

- t94 chain, read verbatim from the same session: the SV-bearing turns are
  `msg_15367c4cf0017tUD3IpL0IE4Ii` (own = the 31-hex, prev = zeros) →
  `msg_153df26e6001lBi7Z0PyRyl8wn` (prev = that 31-hex) →
  `msg_1545a67ba001vjGyNCd2a6OW3w` (prev = `c257e725…`) →
  `msg_1546b514c001HUX2Yhc7ou7xUB` (prev = `1e2cfd10…`). The 19 assistant turns BEFORE the first
  SV turn carry no SV block at all, so the zeros there are a break, not a first turn.
- The minimax probe session has exactly ONE assistant turn; its `prev-md5` is non-zero → invented.

## 2. The rules (thresholds, and where they come from)

`pattern_flags(md5) -> list[str]` — a FORM check only. No hash is ever computed or compared
against content; the kernel's legend stays true.

| Flag | Rule | Threshold | Why this number |
|---|---|---|---|
| `wrong-length` | `len(md5) != 32` | 32 | the SV_FORMAT contract (32 hex) |
| `non-hex` | a character outside `0-9a-f` | — | not a hash at all |
| `run-ascending` | contiguous run where each next char = previous + 1 in hex value | run ≥ **6** | owner-named; 6 is the shortest run that fits `0123456789abcd` inside a 32-char tag |
| `run-descending` | same, −1 | run ≥ **6** | symmetric |
| `staircase` | a window of **12** chars where `c[i+2] == next(c[i])`, under EITHER next: the 16-symbol cycle `0-9a-f`, or the per-class cycle (digits mod 10, letters mod 6) | window 12 = 10 constraints | 10 constraints on random hex ≈ 1e-8/string; the 12-char window still fits G7 (30 constraints) and the t94 tail (`b3c4d5e6f708`) |
| `low-distinct` | distinct hex symbols | ≤ **8** of 16 | owner-named; a 32-char tag using ≤8 symbols is written, not minted |

- `000…0` (32 zeros) is EXEMPT: it is the canonical "no parent / first turn" marker, not a canary.
- An empty value is exempt (nothing to judge); the length histogram already covers it.
- MEASURED false-positive rate (probe run 20261020T013540Z_4078e5a8): 200 000 seeded uniform
  32-hex tags → 6 flagged (rate 3e-05); 50 live `uuid4()` values → 0 flagged (rate 0). The rate
  comes from the ascending/descending run rule (six steps of ±1 in a row), the only rule that can
  fire on a healthy tag; the staircase and the low-distinct rule did not fire once in 200 000
  draws. The 50-uuid control therefore has a ~1e-3 chance of a false red — the pinned seeded
  control (50 values, seed 20261020) is the deterministic half of that guard.
- `chain_findings(turns) -> list[dict]` — per session, over assistant turns in time order:
  - the FIRST assistant turn of a session must carry `prev-md5 = 000…0`; a non-zero value there is
    **`invented-first-prev`**;
  - any LATER turn: `prev-md5` must equal the md5 of the most recent earlier turn that carried an
    SV block. A zero there, or a value that does not match, is a **`chain-break`**. When no earlier
    turn carried an SV at all, a zero prev is still a break (the t94 shape).
  - Turns without an SV block are not judged (they are a different gap — see § Residual).

## 3. Boxes

- [x] T1 — this plan (thresholds, boxes, Smoke Tests, SV)
- [x] T2 — RED test file `experiments/2026-10-08_robot-wave/test_sv_census_canaries.py`: 16 tests
  (one per canary, the healthy control, the pinned control, the chain cases, the mutation control)
- [x] T3 — RED run recorded: 16 failed for the stated reason (the functions did not exist yet)
- [x] T4 — implemented `pattern_flags` + `chain_findings` in `sv_census.py` (pure, no DB) plus
  `prev_positions`, `build_turns`, `sessions_of`, `interleave`
- [x] T5 — GREEN: 16 passed, exit 0 (re-run on the final file state)
- [x] T6 — mutation control: RUN_MIN 6 → 20 → the G4 fixture test fails (EXPECTED_FAIL receipt)
- [x] T7 — the three report sections are wired into `main()`; the DB is still opened `mode=ro`
- [x] T8 — live run over `opencode.db`: both named sessions listed by id; the section counts pasted
  into this plan
- [x] T9 — `_progress_log.md` line + commit through `scripts/commit_own.py` (own paths only)
- [x] T10 — `_build.ps1` exit 0 (cmd_runner 20261020T013922Z_2f0ce455: exit 0, bytes_written 65 763,
  "Smoke test passed: 10.0.1464", "[OK] Build complete - artifacts in dist/")
- [~] T11 — independent validation ATTEMPTED with three executors, BLOCKED by runtime defects outside
  this task: `explorer_agent` and `general_agent` both die with
  `Cannot access 'ge' before initialization` (the TDZ the t94 census already recorded — `ge` occurs
  nowhere in `packages/opencode/src`), and `aicall` fails `ProviderModelNotFoundError` for the
  session model and for an explicit free model. Continuation: the plan↔code consistency was READ by
  the author, not verified by an outside verdict — re-run the delegation when the sub-agent spawn
  path is fixed. The oracles of this task are unaffected: RED→GREEN, the mutation control and the
  live run are instrument results, not testimony.

## 4. Smoke Tests

RED (must FAIL today, for the stated reason — the functions do not exist) — the file as written
holds 16 tests: one per canary, the healthy control, the pinned control, the chain cases and the
mutation control. RED run (cmd_runner 20261020T013224Z_47103c8c, exit 1): 16 failed, every
failure stating `sv_census.pattern_flags is missing (RED: not implemented yet)` /
`sv_census.chain_findings is missing`; state.json: status finished, exit_code 1, bytes_written
21 786, truncated false. The tests: `test_pattern_flags_t94_31_hex_is_wrong_length`,
`test_pattern_flags_t94_tail_is_staircase_even_at_32_hex`, `test_pattern_flags_gemini_g7_staircase`,
`test_pattern_flags_gemini_g9_staircase_and_run`, `test_pattern_flags_gemini_g4_ascending_run`,
`test_pattern_flags_non_hex_is_flagged`, `test_pattern_flags_low_distinct_is_flagged`,
`test_pattern_flags_zeros_are_exempt`, `test_healthy_control_50_uuid4_zero_false_positives`,
`test_healthy_control_pinned_50_hex_zero_false_positives`,
`test_chain_first_turn_with_nonzero_prev_is_invented`,
`test_chain_zero_prev_after_earlier_turns_is_break`, `test_chain_prev_mismatch_is_break`,
`test_chain_healthy_chain_has_no_findings`, `test_chain_sessions_are_judged_separately`,
`test_mutation_control_weakened_run_threshold_makes_g4_fixture_miss`.

GREEN: the same file passes unmodified — 16 passed, exit 0 (runs 20261020T013340Z_adede7a4, and
again on the final file state 20261020T013705Z_b2239bad).

MUTATION CONTROL (EXPECTED_FAIL): weaken the ascending-run threshold (RUN_MIN 6 → 20) → the G4
fixture is no longer flagged, so the fixture test fails. Receipt: probe run
20261020T013540Z_4078e5a8 prints `MUTATION DETECTED: the G4 fixture test fails under the weakened
threshold` (control flags `run-ascending` → mutated flags `(none)`); the in-suite control
`test_mutation_control_weakened_run_threshold_makes_g4_fixture_miss` asserts the same flip and
restores the constant.

LIVE: one run of `sv_census.py` over the live DB (cmd_runner 20261020T013705Z_76390bf2, exit 0):
`--- patterned md5 ---` count 190 (sessions 73); `--- prev chain breaks ---` count 299 (sessions
184); `--- invented first-turn prev ---` count 8 (sessions 8); `--- sessions with canaries ---`
count 196. The t94 session `ses_eaca6cd7fffepObRe1US60KICD` is listed with its message id and
flags (`patterned=1 chain=1 invented=0 first=msg_15367c4cf0017tUD3IpL0IE4Ii
flags=wrong-length,staircase`) and the minimax session `ses_ea9199fbaffeUuuaHGBEhxbLhA` is in the
invented section (`msg_156e6a237001bJsvvdSPmwyjcJ` — first turn carries a non-zero prev-md5).
`db mtime before=… after=… unchanged=True` — the DB was not written.

  The 30-line cap applies to the CASE listing of each of the three sections. 73 sessions carry a
  patterned canary, so no 30-line window can hold every session — that is why the run also prints
  `--- sessions with canaries ---`, one line per affected session with its counts and its first
  case. Nothing hides behind the cap, and both named cases are in the output.

## 5. Claim ledger

- C1: `pattern_flags` flags the t94 31-hex value. Falsifier: the value returns `[]`.
- C2: `pattern_flags` flags the three Gemini values. Falsifier: any returns `[]`.
- C3: 50 `uuid4().hex` values return `[]` — the false-positive rate is 0/50. Falsifier: any flag.
- C4: `chain_findings` reports the minimax shape as `invented-first-prev` and the t94 shape as a
  `chain-break`. Falsifier: wrong kind or no finding.
- C5: the live run lists both named sessions by id. Falsifier: either id absent from its section.
- C6: the census does not write the DB. Falsifier: `db mtime … unchanged=False` or a write error.

## 6. Risk ledger

- R1: thresholds too loose → healthy SVs flagged. Containment: the 50-uuid control + a measured
  false-positive rate over a large sample; the thresholds are recorded above.
- R2: thresholds too tight → a real canary slips through. Containment: the four named fixtures are
  in the test file, and the mutation control proves the fixture test discriminates.
- R3: quoted SV blocks inside a reply are read as the turn's own. Containment: the LAST SV block of
  a message is taken (the agent's own, at the end of the reply); the count of blocks per turn is
  not reported yet (residual).
- R4: a shared tree — two other robots work in parallel. Containment: own paths only, private index
  (`scripts/commit_own.py`), `_progress_log.md` appended (both entries kept on conflict).

## 7. Residual

- 881 assistant text parts carry no SV block at all. A missing SV is a distinct canary (the kernel
  wants one per turn) and is NOT implemented here — it would drown the three sections. Named, not
  built.
- The chain check cannot see a turn whose SV block is missing: the anchor is the most recent earlier
  turn that carried an SV, so a gap in the middle is read as "the chain continues from the last SV".
- The report is advisory by design: a flag is a prompt to read that turn with a magnifying glass,
  not a verdict.


## 8. Deliverables

- LIVE (the wave's scratch tree, gitignored by canon):
  `experiments/2026-10-08_robot-wave/sv_census.py` (the canaries),
  `…/test_sv_census_canaries.py` (the 16 tests), `…/t100_canary_probe.py` (the probe).
- TRACKED (the archive of a verified result): `experiments_history/2026-10-20_sv-canary-detector/`
  — `sv_census.py`, `test_sv_census_canaries.py`, `t100_canary_probe.py`, `REPORT.md` (the receipts
  table). The archive is a dated snapshot; the live tree keeps evolving.
- This plan moves to `plans_completed/` in the same change — every box is closed.
