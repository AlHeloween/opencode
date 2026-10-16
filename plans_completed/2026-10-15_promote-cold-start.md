# t60 — promote_bin.py: the cold case (no host running) must promote, not refuse

<!-- intention: from_state = with no host running and nothing holding bin\opencode.exe, python scripts/promote_bin.py exits 2 «no live host executes … — nothing to promote», forcing a hand swap -> to_state = no live host and no holder runs swap + verify + version smoke + rollback-on-failure exactly as the warm path, relaunches nothing, prints that explicitly -->

<!-- goal_sv: keywords: { cold-promotion 0.35, bin-swap-verify 0.25, no-relaunch 0.20, fixture-oracle 0.20 }
     dominant: The simplest and safest promotion — nothing to drain, nothing to resume — stops refusing and just swaps with proof. -->

Measured 2026-10-15 21:14 (Claude, owner-approved promotion of 10.0.1359): with no host running and nothing
holding `bin\opencode.exe`, `python scripts/promote_bin.py` exited 2: «PROMOTION FAILED (2): no live host
executes D:\zPython\opencode\bin\opencode.exe — nothing to promote». The cold case is the simplest and
safest one (nothing to drain, nothing to resume); Claude had to do the swap by hand (holder check →
`bin\opencode.exe.prev-10.0.1352` copy verified → copy dist → sha equal → `--version` 10.0.1359).

## Grounding

- `scripts/promote_bin.py:512-513` — the refusal: `if not inventory["hosts"]: return fail(2, …no live host…)`.
  `inventory["unattributed"]` (exit 9, line 509) already blocks a holder that is not a host — unchanged.
- `swap()` (`:304-332`) — copy old → `.prev`, candidate → bin atomic, sha verify, `--version` smoke,
  rollback inside on any failure. Cold reuses it verbatim; `prev_path` stays `bin\opencode.exe.prev`
  (the tool's own convention, line 570). The hand-made `bin\opencode.exe.prev-10.0.1352` is left as is
  (the tool only ever unlinks/writes `*.prev`, never `*.prev-*`) — said explicitly in the report line.
- `bring_back([])` / `resume_sessions([])` are natural no-ops (loops over empty); drain over empty hosts
  returns idle immediately — the cold path skips drain + marker entirely (no sessions to wait for, no
  marker this run wrote, so nothing to unlink: unlinking a marker it did not write could clear another
  promotion's flag).
- Fixture oracle pattern: `packages/opencode/test/promote-bin.test.ts` (t55) — real tool vs fixture
  layout (`bin/opencode.exe` = copy of python.exe, `--fixture-dir`, `--launch-mode hidden`). New file
  `packages/opencode/test/promote-bin-cold.test.ts` reuses the pattern so the warm file is untouched
  (two other robots share this tree).
- Bounds: steps 30, tools 70, loops 3, depth 2, time 1 800 000 ms. No build, no real `bin/` run.

## Tasks

- [x] T1 Cold path in `scripts/promote_bin.py` — after the unattributed-holder block (exit 9, unchanged),
  `no hosts` enters the cold branch instead of `fail(2)`: log `cold promotion: no live host … — swapping
  without drain; nothing will be relaunched`, persist the same state-file shape (`hosts: []`, `resume: []`,
  `drain: {cold: true}`), re-check holders (`norm(exe) == norm(bin)`; non-empty → `fail(5)`, unchanged
  semantics), run `swap()` verbatim (`.prev` rollback copy, sha verify, version smoke, rollback inside on
  failure → `fail(6)`), set `relaunched: []` / `resumed: []` with an explicit `nothing was recorded, nothing
  relaunched` line, report `version (cold, no prior health) -> <smoke>`, return 0. Touch no marker.
  <!-- sv: keywords: { cold-branch 0.40, swap-reuse 0.30, holder-block 0.30 } dominant: No host and no holder swaps with the same proof as the warm path and relaunches nothing. -->
- [x] T2 Fixture oracle `packages/opencode/test/promote-bin-cold.test.ts` — cold fixture (bin + candidate,
  no servers): RED today (exit 2), GREEN after (exit 0, `sha(bin) == sha(candidate)`, stdout names the
  cold path + `nothing … relaunched`, `.prev` holds the old bytes, no `maintenance` marker created).
  Warm file `promote-bin.test.ts` untouched and staying green.
  <!-- sv: keywords: { fixture-oracle 0.45, red-then-green 0.30, warm-untouched 0.25 } dominant: The cold case is proven on a fixture the real bin never feels. -->
- [x] T3 Verify + commit — `promote-bin-cold.test.ts` GREEN, `promote-bin.test.ts` GREEN (warm untouched),
  commit naming this plan, stage by path (`git add <path>…`, never `-A`); `_progress_log.md` appended.
  <!-- sv: keywords: { verify 0.40, commit-by-path 0.35, progress-log 0.25 } dominant: Green proof lands as a named commit that touches only its own paths. -->

## Smoke Tests (PRE_FLIGHT)

- S-cold (new file): cold fixture → exit 0, sha equal, `.prev` == old bytes, stdout matches
  `/cold promotion/` + `/nothing.*relaunched/i`, no `maintenance` file. Expected before fix: RED (exit 2,
  `no live host`); after fix: PASS.
- S-warm (existing file, untouched): `bun test test/promote-bin.test.ts` → 6 pass, 0 fail. Expected: PASS
  before and after.

## Risks

- Cold unlinking a marker it did not write → containment: cold touches no marker at all.
- A stale `*.prev` from an earlier run → containment: same as warm (`swap()` unlinks `.prev` first).
- `bin\opencode.exe.prev-10.0.1352` (hand-made) vs `.prev` convention → containment: tool never
  writes/deletes `*.prev-*`; left as is, said so in the log line and the final message.
