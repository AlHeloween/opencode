# t100 — SV form canaries in the read-only census (2026-10-20)

Tracked record of a VERIFIED result. The live copies stay in the wave's scratch tree
(`experiments/2026-10-08_robot-wave/`, gitignored by canon); the three files here are their
2026-10-20 snapshot — the live tree keeps evolving, this archive is the dated record.

| File | What it is |
|---|---|
| `sv_census.py` | the census with the canaries (`pattern_flags`, `chain_findings`, the three report sections) |
| `test_sv_census_canaries.py` | the 16 pure-function tests (no DB, no live host) |
| `t100_canary_probe.py` | the probe that measured the false-positive rate and the mutation control |

Plan: `plans_completed/2026-10-20_sv-canary-detector.md`.

## What it does

A FORM check on the SV tag. No hash is ever computed and none is compared against content — the
kernel's legend stays true (hashes are generative tags). The census reads the live `opencode.db`
with `mode=ro` and now prints three new sections:

```
--- patterned md5 ---
--- prev chain breaks ---
--- invented first-turn prev ---
--- sessions with canaries ---
```

## The thresholds (measured, recorded)

| Flag | Rule | Threshold |
|---|---|---|
| `wrong-length` | length ≠ 32 | 32 |
| `non-hex` | a character outside `0-9a-f` | — |
| `run-ascending` / `run-descending` | a contiguous run where each next char is ±1 in hex value | run ≥ 6 |
| `staircase` | a 12-char window where `c[i+2]` is the next symbol of `c[i]` (16-symbol cycle 0-9a-f, or the per-class cycle digits mod 10 / letters mod 6) | window 12 |
| `low-distinct` | distinct hex symbols | ≤ 8 of 16 |

Exempt: 32 zeros (the canonical "no parent / first turn" marker) and an empty value.

The chain rules: the FIRST assistant turn of a session must carry `prev-md5 = 000…0` (a non-zero
value there is `invented-first-prev`); any later turn's `prev-md5` must equal the md5 of the most
recent earlier turn that carried an SV block — a zero, a missing value, or a mismatch is a
`chain-break`.

## Receipts (cmd_runner runs, `state.json` read)

| Run | What | Result |
|---|---|---|
| `20261020T013224Z_47103c8c` | RED — `python -m pytest experiments/2026-10-08_robot-wave/test_sv_census_canaries.py -q` | exit 1, 16 failed, every failure stating `sv_census.pattern_flags is missing (RED: not implemented yet)` |
| `20261020T013340Z_adede7a4` | GREEN | exit 0, 16 passed |
| `20261020T013540Z_4078e5a8` | probe — fixtures, mutation control, false-positive rate | exit 0, `MUTATION DETECTED`; 200 000 seeded tags → 6 flagged (3e-05); 50 uuid4 → 0 flagged |
| `20261020T013540Z_2a6bdd4b` | GREEN after the report wiring | exit 0, 16 passed |
| `20261020T013705Z_b2239bad` | GREEN on the final file state | exit 0, 16 passed |
| `20261020T013705Z_76390bf2` | LIVE — `python experiments/2026-10-08_robot-wave/sv_census.py` | exit 0; patterned 190 (73 sessions), chain breaks 299 (184 sessions), invented first-turn prev 8 (8 sessions), sessions with canaries 196; `db mtime … unchanged=True` |
| `20261020T013922Z_2f0ce455` | `_build.ps1` | exit 0, bytes_written 65 763 |

Named live cases (both in the live run, by session id):

- t94, the 31-hex own md5 on a mid-session turn — `ses_eaca6cd7fffepObRe1US60KICD`,
  `msg_15367c4cf0017tUD3IpL0IE4Ii`, flags `wrong-length,staircase`; the same turn is a chain break
  (a zero `prev-md5` after earlier turns).
- the minimax probe, a non-zero `prev-md5` on a session's FIRST turn —
  `ses_ea9199fbaffeUuuaHGBEhxbLhA`, `msg_156e6a237001bJsvvdSPmwyjcJ`, `invented-first-prev`.

## What is NOT measured

- 881 assistant text parts carry no SV block at all. A missing SV is a separate canary and is not
  implemented (it would drown the three sections).
- The chain anchor is the most recent earlier turn that carried an SV; a gap of turns without an
  SV in the middle is read as "the chain continues from the last SV".
- The report is advisory: a flag is a prompt to read that turn with a magnifying glass.
