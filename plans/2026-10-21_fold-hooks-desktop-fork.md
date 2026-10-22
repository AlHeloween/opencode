# Fold hooks reach the new window on every desktop rebuild route (fork / compact / clear)

<!-- intention: whatever way the Claude desktop app rebuilds a window — fork with a new session id, compact or clear — opens with no owner messages and no semantic vectors -> the new window opens with the previous window's owner messages and full SV blocks, row-addressed, on all three routes, with every exit path logged -->

<!-- goal_sv: fold-rebuild-routes, predecessor-pointer, live-transcript-build, replay-oracle -->

<!-- workflow: lifecycle ACTIVE -->

- **plan_id:** 2026-10-21_fold-hooks-desktop-fork
- **revision:** 1
- **state:** ACTIVE
- **reported:** owner, 2026-10-21, verbatim: «первое что ты должен сделать после любой пересборки окна это получить мои сообщения и семантические вектора - полностью - не только semantic dominant»; «он тебе должен возвращать сообщения пользователя и семантические вектора со ссылками на сообщения чтобы можно было легко вычитать окружение и все. Этого более чем достаточно»
- **class:** the desktop rebuild path has a seam — the 08:30:51 compact produced NO map and **why is UNKNOWN** (three candidates open, named in the evidence line below): (a) the PreCompact event never fired, (b) the matcher filtered it, (c) it ran and exited early before any log row existed. What IS established: `SessionStart(fork)` matched no restore hook, so the new window opened with nothing — and the live route works today (T6, ticked on its receipts).

```yaml
Keywords: window-rebuild-fold 0.30, predecessor-pointer 0.25, live-build-fallback 0.20, replay-oracle 0.15, hook-wiring 0.10
Semantic dominant: Every desktop window rebuild — fork, compact or clear — reopens on the predecessor's owner rows and full SV blocks through a capture-every-exit plus pointer-or-live restore chain proven by a replay oracle.
md5: 9e4b7c2a51f683d0a9e5f147b3c8d621
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
note: hash values are generative tags — search them, never compute them.
```

## Evidence (each line carries its instrument)

- ✓ read `C:/Users/Alexander/.claude/hooks/fold_capture.py` (154 lines), `fold_restore.py` (112), `hook_probe.py` (36), `recall.py` (21), `settings.json` (306) whole, plus `*.bak-20261021*` present before the first edit and new `*.bak-t115` of all five files.
- ✓ official Claude Code hooks reference, fetched 2026-10-21 (`https://code.claude.com/docs/en/hooks`, content_hash `17cdd5c7fa205b5c2e85ee702dd3644565b051365ffbcfc3de07fc478efe99d1`): SessionStart `source` is `startup|resume|clear|compact|fork`, fork = «a new session forked from an existing one»; SessionEnd `reason` is `clear|resume|logout|prompt_input_exit|other`; PreCompact receives `trigger` (`manual|auto`); `transcript_path` «is written asynchronously and may lag»; SessionEnd hooks share a 1.5 s budget raised by per-hook `timeout` (ours: 30 s); hooks fire identically in terminal, IDE, desktop app and cloud.
- ✗ **UNKNOWN — the 08:30:51 compact wrote no map, and the cause is NOT established.** `~/.claude/fold/hook_calls.log` rows 7-9: `SessionEnd reason=other` (ff5789de), `SessionStart source=fork` then `source=compact` (1e712796) 64 s apart, and no PreCompact row. The reasoning «every capture path logs a row, therefore the capture never executed» was **unfalsified**: the outcome logging in `fold_capture.py` was added at ~08:35, AFTER that event — the log itself shows it (rows 1-9 carry no `capture` field; the first rows that do are the DRYRUN2/DRYRUN3 tests at 08:35:12), so a missing row at 08:30 cannot separate the three candidates (a) the event never fired, (b) the matcher filtered it, (c) it ran and exited early with no log. The deciding observation is a live `/compact` with the PreCompact probe + capture outcome rows — DONE since (rows 18-19, 09:19:01, and transcript rows 1158/1170-1178, T6). The current wiring is proven; the 08:30 case stays UNKNOWN.
- ✓ read both transcripts head (30 rows each): the forked jsonl rewrites every copied row's `sessionId` to the new id (row 24 reuses parent row 3's uuid `c5829e9e-…`); the parent id appears NOWHERE as a field — 73 grep hits for `ff5789de-…` in the forked file are all `scratchpad`/`realParentDir` paths inside file-history-snapshot rows. No `parent_session` field exists.
- ✓ replay oracle `experiments/2026-10-21_fold-hooks/replay.py`: baseline (`--scripts=old`, `*.bak-t115`) 5/10 — P1, P2, P4, P7, P9 FAIL; fixed hooks 10/10. The predicate fails on today's hooks, so green means movement.
- ✓ prior art: `handoff_capture.py`/`handoff_restore.py` (decision-mining pair, per-cwd files, no SV blocks — different purpose, left alone); `docs/proposals/2026-10-08_claude-agent-continuity.md` (self-folding continuity proposal); in-repo `glob plans/*fold*` empty; `grep docs` for fold/compact-handoff finds only the opencode-internal compaction fold (a different mechanism).

## Tasks

- [x] **T1 — capture on every exit path.** `fold_capture.py`: handle `SessionEnd` with ANY reason and `PreCompact` with ANY trigger (was: clear-only, so `reason=other` and the live compact wrote nothing); every capture writes `last_fold.json` (`session_id,cwd,transcript,event,reason_or_trigger,ts`), keeps `last_clear.json` on `reason=clear` for compat; map format byte-identical to the owner's. `std:` none found — no GOST/ISO/IEC governs hook glue; contract pinned by the official hooks reference (reason/trigger tables, transcript-lag note). Oracle: replay P0, P4, P8.
- [x] **T2 — restore with a fallback chain.** `fold_restore.py`: (1) this session's map; (2) predecessor named by `last_fold.json`/`last_clear.json` (fresh < 5 min, same cwd); (3) a live build from this window's own transcript (a fork copies the parent's rows in). Covers fork-new-id (no map, no pointer needed) and compact-same-id-without-map. `std:` none found — same receipt as T1; the 10 000-char `additionalContext` cap per hook is the official docs (SessionStart decision control). Oracle: replay P1, P2, P3, P9.
- [x] **T3 — guards and stdout discipline.** Foreign cwd or stale pointer injects nothing; nothing prints to stdout except the slices (probe/capture stay on stderr + `hook_calls.log`). `std:` none found — same receipt as T1. Oracle: replay P5, P6.
- [x] **T4 — settings wiring.** `settings.json`: new `SessionStart/matcher=fork` group (8 slices, timeout 15); new matcher-less `PreCompact` probe group (logs every PreCompact payload, deciding fire-vs-filter next time). JSON validated by parse. `std:` ECMA-404 (JSON, validated by `json.load`) + the official hooks matcher tables (SessionStart `fork`, PreCompact `manual|auto`). Oracle: replay P7 + `json.load` round-trip.
- [x] **T5 — replay harness and predicate.** `experiments/2026-10-21_fold-hooks/` (`replay.py`, `fixture_transcript.jsonl`): 10 cases over the recorded event sequences with fixture + REAL transcripts (`1e712796-…jsonl`: 18 sv + 21 owner). Baseline 5/10 (P1,P2,P4,P7,P9 FAIL), fixed 10/10. `std:` none found — project convention is `experiments/` scratch (AGENTS.md); receipt: `glob plans/*fold*` empty, in-repo `grep` finds only the unrelated compaction fold. Oracle: the two runs themselves (run receipts below).
- [x] **T6 — live check, COMPACT leg (owner-side oracle, now paid).** Receipts: the owner's `/compact` (transcript row 1157, app `compact_boundary` row 1154, trigger `manual`, preTokens 219781 -> postTokens 22190); the app's own stdout row 1158 «Compacted PreCompact [fold_capture.py] completed successfully / PreCompact [hook_probe.py] completed successfully»; `hook_calls.log` row 18 (PreCompact probe, `trigger: manual`) and row 19 (capture: «wrote 24 sv + 26 owner rows (PreCompact manual)» -> `~/.claude/fold/1e712796-….md`, 19 662 B) plus `last_fold.json` (event PreCompact, 09:19:01); transcript rows 1170-1177 = eight `hook_success` `SessionStart:compact` (commands `fold_restore.py 1..8 8`, exit 0, parts 3-8 «nothing to carry (2 slices)») and row 1178 = the injected `hook_additional_context` («[fold part 1 of 2 …]» + the map header). The new window therefore opened with the owner rows and the full SV blocks. `std:` none found — the event contract is the official hooks reference; receipts are the app's own transcript rows. Oracle: this box's receipts.
- [ ] **T7 — live check, FORK leg (still open).** A live desktop rebuild that FORKS with a new session id: the parent must leave a capture (PreCompact or SessionEnd), the fork's `SessionStart` must show `source: fork`, and eight `fold_restore.py` handlers must inject the map into the NEW id (the pointer chain or the live build from the fork's own transcript). *Oracle:* `hook_calls.log` shows the capture + the fork row, and the new window's transcript carries the injected map; until then the fork route is unproven live (replay P1 is the only evidence).
- [ ] **T8 — live check, CLEAR leg (still open).** A live `/clear`: `SessionEnd` with `reason: clear` must capture and write `last_clear.json`, and `SessionStart` with `source: clear` must inject the predecessor map. *Oracle:* the capture row + the clear row in `hook_calls.log` + the injected map in the new window; replay P3 is the only evidence today.
- [x] **T9 — the probe's timestamp field (my own defect, F5).** `hook_probe.py` lost `row["ts"] = time.strftime(…)` between the 08:44:26 backup and my 08:45:41 edit (address-replace swallowed the adjacent line); rows 16/18/20/21 of the log therefore carry no `ts`. Restored at line 24. `std:` none found — the field is the instrument's own contract. Oracle: `py_compile` + a probe row carrying `ts` + `replay.py` still 10/10.

## Smoke Tests

Predicted BEFORE each run (@SMOKE_BEFORE); a delta off prediction is a divergence, not a pass. Harness: `python experiments/2026-10-21_fold-hooks/replay.py [--scripts=old]`.

| # | command | prediction | actual |
|---|---|---|---|
| B1 | `replay.py --scripts=old` (t115 baseline `*.bak-t115`) | 5/10 — FAIL on P1 fork-restore, P2 compact-pointer-fallback, P4 end-other-capture, P7 settings-fork-probe, P9 live-build-no-pointer; P0,P3,P5,P6,P8 PASS | 5/10, exactly that set (run FAILED, as designed) |
| R1 | `replay.py` (fixed hooks) | 10/10 PASS | 10/10 PASS |
| R3 | live desktop `/compact` (owner-side): capture + 8 restore slices + injection | map written, 8 handlers exit 0, the map injected | `hook_calls.log` rows 18-19 + transcript rows 1158, 1170-1178 — DONE (T6) |
| R4 | `hook_probe.py` after the `ts` repair: `py_compile`, one probe payload, `replay.py` | compiles; the new log row carries `ts`; replay stays 10/10 | T9 receipts in the progress-log row |

## Residuals

- R1: the live desktop check is SPLIT by route: the COMPACT leg is closed (T6, receipts in the evidence line); the FORK leg (T7) and the CLEAR leg (T8) stay open — the next observation for each is its own live event, and until then the replay harness is the only evidence.
- R2: the observed fork-then-compact double `SessionStart` (64 s apart, same id) re-injects the same map twice — tolerated duplication, labelled «not verified».
- R3: PreCompact `transcript_path` may lag the in-memory conversation (official docs); the SessionEnd capture of the full transcript covers the tail.

## Assumptions

- A1: the map format is frozen (the owner's format, byte-stable) — only routing changed; the map file is the owner's channel, the recall line the address space.
- A2: **CORRECTED (review-1, 2026-10-21).** «A missing `hook_calls.log` row proves the hook did not run» was FALSE for any event before ~08:35: the outcome logging in `fold_capture.py` was added at ~08:35, so a missing row proves nothing about earlier events. Today the probe and the capture both log every exit path, and a row is evidence — but only from 08:35 on.
- A3: the 5-minute pointer freshness and the same-cwd guard are the owner's constraint (a foreign cwd or a stale predecessor injects nothing) — a pointer from another project must never restore another session's context.
- A4: the live `/compact` of 2026-10-21 09:19 (T6) is a valid receipt for the COMPACT leg only; the FORK and CLEAR legs stay open until their own live events exist (T7, T8).
- A5: `~/.claude/hooks/*.py` are the owner's host files; every change there is backed by a `*.bak-t115` copy, and the repo holds only the harness, the plan and the progress-log row.
- A6: the replay harness (`experiments/2026-10-21_fold-hooks/replay.py`) is the standing oracle: 5/10 on the `*.bak-t115` baseline, 10/10 on the current hooks — a green run means the predicate moved, not that the harness is lenient.

## Out of scope

- Committing (Claude commits) and moving this plan to `plans_completed/` — it moves there only after T7 and T8 close (the owner step T6).
- `resume`/`startup` routes (brief names fork/compact/clear only).
- `PostCompact`/`compact_summary` as a source (summary-only by construction — the owner requires full SV blocks).
- The map format (owner's format, byte-stable) and the `handoff_*` pair (different purpose).

## Rollback

No repo product source touched. Outside the repo: copy each `*.bak-t115` back over its file (`fold_capture.py`, `fold_restore.py`, `hook_probe.py`, `recall.py`, `settings.json`); maps/pointers already written under `~/.claude/fold/` are inert data. In the repo: delete `experiments/2026-10-21_fold-hooks/` and this plan file.
