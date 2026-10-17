<!-- intention: briefs without SV can be dispatched and robot lineage is unchecked -> no SV-less dispatch leaves and every robot turn's parent-goal-md5 and md5 reuse are checked by tools -->
# t83 — SV lineage mechanism: dispatch gate + watcher lineage + census

```yaml
Keywords: brief-sv-gate 0.35, lineage-check 0.30, md5-reuse-flag 0.25, watcher 0.10
Semantic dominant: The dispatcher refuses a brief without an SV and the watcher flags a robot whose parent-goal-md5 is not the brief's md5 or whose own md5 repeats one already seen.
md5: acf16fc2aac80af316dbecadf427452d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: d9ffbffebfb5422daad3d05c0a339c9b
```

Owner, 2026-10-17, verbatim: «если задание пришло с SV, то этот SV md5 должен стать parent-goal-md5 вот и все.»
Standing line (owner memory): after the kernel, a new safeguard is a MECHANISM.
Intention: lineage between a brief and the robot's turns is checked by tools, not remembered by models.
Kernel half is robot t82's (`prompt_kernel/**`). Do not touch it. No `bin/`.

Binding (all under `experiments/2026-10-08_robot-wave/`, gitignored — see `experiments/` in `.gitignore:72`):

- `dispatch.py` — `brief_text()` / `dispatch()`.
- `watch3.py` — the SV-aware watcher.
- `fleet.py` — only if a shared SV parser belongs there (reuse, not copy).
- new `sv_census.py` (read-only over `.opencode/data/opencode.db`, `mode=ro`).
- new `tests/` (fixture-based, `python -m pytest experiments/2026-10-08_robot-wave/tests/ -q`).

Before-state copies next to them as `*.bak-t83`. Experiments files are NOT tracked:
receipts below name them with sha256 (computed after the change).

## G0 Digital intention

- from_state: a brief without an SV can be dispatched; the watcher only checks
  SV presence; `parent-goal-md5` / md5 reuse are unchecked; today's census
  (817 SV blocks / 811 distinct md5 / 5 reused / 101 bad length) has no tool.
- to_state: `dispatch()` refuses a brief without an SV and records its md5;
  `watch3.py` checks each SV turn's `parent-goal-md5` and md5 reuse and nudges
  once in Russian naming the rule, never a busy session; `sv_census.py`
  reproduces the baseline read-only; fixture tests + dry-runs prove the gate.

## G1 Ground (measured on this tree, Local_Development)

- `dispatch.py:34-37` `brief_text(name)` = `<name>.md + common.md`; `dispatch():57-81`
  creates `robot-wave:<name>`, `prompt_async` the brief, merges `sessions.json`
  as `{name: sid-string}`. No SV parse, no gate, no `--dry-run` on its own CLI
  (`__main__:84-86` dispatches directly). `fleet.py cmd_dispatch:315-340` has
  `--dry-run` (prints `would send, wrote nothing`) but calls no gate.
- `watch3.py:18` `SV = Semantic dominant:.*?md5:\s*[0-9a-fA-F]{32}`; `verdict():27-36`
  returns `sv/error/nosv` on the last assistant message; the `sv` branch `:47-48`
  reports `finished` and exits — no lineage check. Nudge path `:53-57` posts
  `prompt_async` only to idle sessions, `MAX_NUDGES = 2`.
- `sessions.json` today: 88 entries, all `{name: sid-string}` (e.g. t83 ->
  `ses_eb6752a64ffeQea7KEGQ1sgh8S`, t82 -> `ses_eb6752aadffeoPpQc32gExp65r`).
  No brief-md5 recorded anywhere.
- Old briefs carry no SV: `t1-fold-carrier.md`, `t10..t16` — no `Semantic dominant:`
  (measured 2026-10-17). New briefs do: `t83` md5 `d9ffbffebfb5422daad3d05c0a339c9b`,
  `t82` md5 `ea3d261516374cf2b1b20c422d7b9d55` (first `@SV_FORMAT` block).
- `common.md` carries the shared robot rules, no SV.
- Census probe (read-only, `file:...?mode=ro`, assistant `part.type='text'`):
  own-md5 line `(?m)^\s*md5:\s*(\S+)` cleaned of trailing `,;"'`/backtick/`*`
  gives 817 own values at probe time (== baseline blocks), distinct ~812,
  reused 4, bad-length ~99; raw (no clean) gives 819/814/4. Live DB drifts by
  design (two other robots share this tree); the tool reports its timestamp and
  counts, and the plan records the drift. `parent-goal-md5` nonzero 160, distinct
  56; zero matches against the 2 known brief md5s (expected pre-mechanism).
- `fleet.py` imports `dispatch as wave_dispatch:44`, `watch:43`; `watch.py`
  `snapshot():14-36` reads `sessions.json` as `{name: sid}` directly (legacy
  reader — compat note in S1).
- Session for this task IS `ses_eb6752a64ffeQea7KEGQ1sgh8S` (t83 row); every turn
  of this task carries `parent-goal-md5: d9ffbffebfb5422daad3d05c0a339c9b` and a
  fresh own `md5` (never the brief md5).

## G2 Candidates → central tasks

- C1: shared SV parser (`parse_brief_sv`) + dispatch gate + `sessions.json`
  compat (`{name: {sid, brief_md5}}`, old strings grandfathered) + `--dry-run`.
- C2: watcher lineage checks (a) parent == brief md5, (b) own != brief and unseen;
  `lineage:` print + one Russian nudge naming the rule, idle-only.
- C3: `sv_census.py` read-only + baseline reproduction as qualification.
- C4: fixture tests RED-first + two dispatch dry-runs (refused / accepted).
- C5: plan + `_progress_log.md` via `scripts/commit_own.py`; receipts with sha256.

Central: C1, C2, C3, C4. C5 is the close-out, not a mechanism.

## G3 Master plan

- [x] S1 — Dispatch gate in `dispatch.py` (parser lives here; `fleet.py` reuses).
  <!-- sv: brief-sv-gate 0.50, compat-record 0.30, dry-run 0.20 -->
  Files: `experiments/2026-10-08_robot-wave/dispatch.py` (+ `fleet.py` reuse only).
  Detail: `parse_brief_sv(text)` parses the brief's FIRST `@SV_FORMAT` block:
  `Keywords:` + `Semantic dominant:` + `md5:` with exactly 32 hex
  (`[0-9a-fA-F]{32}` bounded, not part of a longer token); returns
  `{keywords, dominant, md5(lower)}` or `None`. `dispatch(name)` parses
  `brief_text(name)` FIRST; on `None` refuses (raises `SystemExit(2)` / error
  naming the brief, e.g. `dispatch refused: brief <name> has no @SV_FORMAT
  block ...`), creates no session, writes nothing. On success records
  `sessions.json[name] = {"sid": sid, "brief_md5": md5}` (helpers
  `get_session_id(entry)` / `get_brief_md5(entry)` accept old plain-string
  values as grandfathered, `brief_md5=None`). Resume (`prompt_async` to an
  existing session id) is not a dispatch and takes no gate. CLI gains
  `--dry-run`: `python dispatch.py --dry-run <name>` parses, prints
  `would send/dry-run refused`, writes nothing, exit 0/2. `fleet.py`
  `cmd_dispatch` dry and real paths call the same parser/gate (no copy).
  Legacy `watch.py snapshot()` gets the same two helpers (one-line compat;
  still gitignored, named in receipts) so new dict values do not break `status`.
- [x] S2 — Watcher lineage in `watch3.py`.
  <!-- sv: lineage-check 0.50, nudge-once 0.30, idle-only 0.20 -->
  Files: `experiments/2026-10-08_robot-wave/watch3.py` (imports parser/helpers
  from `dispatch.py`, no copy).
  Detail: when the last assistant turn ends with an SV, extract its LAST block's
  `parent-goal-md5` + own `md5`, plus the session's seen own-md5 set (all prior
  assistant texts, same cleaning as census). If `get_brief_md5()` is `None`
  (grandfathered robot) skip lineage silently. Else check (a) `parent == brief_md5`
  (case-insensitive); (b1) `own != brief_md5`; (b2) `own not in seen_before`.
  On mismatch print exactly `lineage: <name> — <check>, <values>` where check is
  one of `parent-mismatch` / `md5==brief` / `md5-reuse` and values name
  expected/got (e.g. `expected d9ff..., got 000...` / `md5 <v> seen before`).
  Then nudge ONCE per session for lineage (separate `lineage_nudged` counter,
  max 1) with a short Russian line naming the rule, e.g.
  `Продолжай. Правило lineage SV: parent-goal-md5 должен равняться md5 брифа; ...`
  resp. `... собственный md5 должен быть новым — не повторяй md5 брифа или прошлых
  ходов. ...`. Follow the existing nudge path (`prompt_async` with
  AGENT/MODEL/VARIANT) and never prompt a non-idle session. Missing-SV nudges
  (`MAX_NUDGES=2`) unchanged.
- [x] S3 — Census tool `sv_census.py` (read-only).
  <!-- sv: census-readonly 0.50, baseline-qualify 0.30, brief-match 0.20 -->
  Files: `experiments/2026-10-08_robot-wave/sv_census.py` (new).
  Detail: opens `.opencode/data/opencode.db` with `file:...?mode=ro` (refuses
  otherwise; never writes). Over assistant `part.type='text'`: counts SV blocks
  (own-md5 lines), distinct md5 (cleaned, lower), reused md5 with their
  dominants (nearest preceding `Semantic dominant:` line, ≤120 chars) and
  sessions/message ids, md5 length histogram (raw token lengths), and turns whose
  `parent-goal-md5` (cleaned, lower) is in the known-brief set (first-SV md5 of
  every `t*.md`/`inst-*.md`/`h2-*.md` brief in the wave dir). Prints sections +
  timestamp + DB size/mtime so drift is visible. Qualification (pre-change,
  2026-10-17): own ~817-819 / distinct ~812-814 / reused 4 / bad ~99-103 vs
  baseline 817/811/5/101 — same magnitude, delta = live concurrent writes;
  parent-known matches 0 (pre-mechanism, expected).
- [x] S4 — Tests + dry-runs.
  <!-- sv: fixture-red-first 0.50, dry-run-proof 0.30, no-session-created 0.20 -->
  Files: `experiments/2026-10-08_robot-wave/tests/test_sv_lineage.py` (new;
  fixtures only, no live host/DB).
  Detail: RED first (run before S1/S2, recorded), then GREEN. Cases: parser
  accepts first block with 32-hex md5 (lower/upper), rejects missing Keywords /
  missing dominant / short(31)/long(33) md5 / md5 as substring of longer token;
  picks FIRST block when two present; check (a) parent equal vs mismatch;
  check (b) own==brief flagged, own reuse flagged, fresh own passes;
  grandfather (`brief_md5=None`) skips. Runnable
  `python -m pytest experiments/2026-10-08_robot-wave/tests/ -q` from repo root.
  Dry-runs (no session created, `sessions.json` mtime/hash unchanged):
  `python dispatch.py --dry-run t1-fold-carrier` → refused, names the brief,
  exit 2; `python dispatch.py --dry-run t83-sv-lineage-mechanism` → accepted,
  prints md5 `d9ffbffebfb5422daad3d05c0a339c9b`, exit 0. Same pair through
  `fleet.py dispatch <name> --dry-run`.
- [x] S5 — Close-out: receipts + commit + build.
  <!-- sv: plan-receipts 0.40, private-index-commit 0.30, build-smoke 0.30 -->
  Files: `plans/2026-10-17_sv-lineage-mechanism.md` (this file),
  `_progress_log.md` (append one entry; on cherry-pick conflict keep BOTH).
  Detail: fill Receipts below with sha256 of every experiments file touched
  (they are gitignored, so the plan is their only record); commit ONLY
  `plans/2026-10-17_sv-lineage-mechanism.md` + `_progress_log.md` via
  `python scripts/commit_own.py --session ses_eb6752a64ffeQea7KEGQ1sgh8S -m ... -- <paths>`
  (never bare `git commit`, never `git add -A`; index.lock → wait 5 s, retry).
  Then `pwsh -NoProfile -File _build.ps1` through cmd_runner from repo root;
  read its `state.json`. Final message: paths + commit hashes, commands + run
  ids + exits, unresolved.

## Claims / risks / smoke

- Claims: (1) SV-less brief never leaves [falsifier: dry-run refused + no session
  + sessions.json unchanged]; (2) SV brief parses to its md5 [falsifier: dry-run
  prints `d9ff...`]; (3) lineage mismatches print `lineage:` + one Russian nudge,
  idle-only [falsifier: fixture + code path]; (4) census reproduces baseline
  magnitude read-only [falsifier: counts + `mode=ro` + unchanged DB mtime].
- Risks: R1 format change breaks legacy readers → containment: dict-or-string
  helpers + `watch.py` compat line; old strings still resolve. R2 watcher nudges
  a busy session → containment: idle check before every post (existing path).
  R3 census touches live DB → containment: `mode=ro` URI + no writes + mtime
  read-back. R4 concurrent robots drift counts → containment: timestamp + counts
  in every report; qualification records the delta, not a byte match.
- Smoke (before/after per task): S1 dry refused→accepted pair; S2 fixture
  parent-mismatch/md5-reuse → `lineage:` + nudge-once; S3 census pre-change
  magnitude == baseline ±live drift, post-change same query + brief-match
  section; S4 pytest RED (no parser) → GREEN; S5 commit hash + `_build.ps1`
  exit 0.

## Smoke Tests

1. `python -m pytest experiments/2026-10-08_robot-wave/tests/ -q` — RED before
   S1/S2 (no `parse_brief_sv`), GREEN after. Prediction: RED exit 1 naming the
   missing import; GREEN exit 0, all fixture cases pass.
2. `python experiments/2026-10-08_robot-wave/dispatch.py --dry-run t1-fold-carrier`
   — Prediction: exit 2, names the brief, creates no session, `sessions.json`
   unchanged. Diagnostic only until S1 (no flag → dispatches; must NOT be run
   without `--dry-run`).
3. `python experiments/2026-10-08_robot-wave/dispatch.py --dry-run t83-sv-lineage-mechanism`
   — Prediction: exit 0, prints md5 `d9ffbffebfb5422daad3d05c0a339c9b`, writes nothing.
4. `python experiments/2026-10-08_robot-wave/fleet.py dispatch t1-fold-carrier --dry-run`
   and `... t83-sv-lineage-mechanism --dry-run` — Prediction: same refused/accepted
   pair through the fleet verb, nothing written.
5. `python experiments/2026-10-08_robot-wave/sv_census.py` — Prediction: prints
   SV blocks ~817-819, distinct ~811-814, reused list with dominants/sessions,
   length histogram with ~99-103 bad, parent-known matches 0; DB mtime unchanged;
   exit 0. Pre-change run is the qualification.

## Bounds

Steps 50, tools 120, loops 3, depth 2, time 3 600 000 ms. No `bin/`, no kernel
(`prompt_kernel/**` is t82's). Forward slashes in paths. Work in
`D:/zPython/opencode` on `Local_Development`; no checkout, no worktree.
Commit ONLY own paths (`git add <path>…` via `scripts/commit_own.py --session
ses_eb6752a64ffeQea7KEGQ1sgh8S`, never `git add -A`, never bare `git commit`,
never `--no-verify`). Python tests via `python -m pytest` (product `bun test`
rule does not apply); product tests if touched: from `packages/opencode`, ONE
file per call through cmd_runner. Trials go to `researcher_agent`.

## Acceptance

Dispatch refuses SV-less briefs naming the brief and records brief md5s;
watcher prints `lineage:` and nudges once in Russian, idle-only; census runs
read-only and matches the baseline magnitude; fixture tests + both dry-run pairs
are green with no session created; plan + log committed via `commit_own.py`;
`_build.ps1` exit 0.

## Receipts (fill at S5; experiments files are gitignored)

- `experiments/2026-10-08_robot-wave/dispatch.py` sha256: 8e08058350510216ac7e8ab1b19a786b4f1315f9e329ecb476373c5ded8b6e74
- `experiments/2026-10-08_robot-wave/watch3.py` sha256: b1cfe3353eb44ff509304415f7f872114bda413355eb7c0e15dcc60ec9c51741
- `experiments/2026-10-08_robot-wave/fleet.py` sha256: cd4d1b91565c8604bd645c70b49156268c480f063d43f2db14ed43d5535a1423
- `experiments/2026-10-08_robot-wave/watch.py` sha256: 25b8578575fa68097e045abdbfd103935d1200d1d222bf6bf246dcd8c179b393
- `experiments/2026-10-08_robot-wave/sv_census.py` sha256: a4d9a339315f84726b5a90a10199a3f0a318536d015fc87444fe22ccceda2aca
- `experiments/2026-10-08_robot-wave/tests/test_sv_lineage.py` sha256: 0efe6f84bc48814eddd14cb510632b336b8acd772e46a959e988980f6255c900
- before-state: dispatch/watch3/fleet/watch .bak-t83 kept (hashes 3d4665ae/169f7874/9ee47af1/8ffbf3a7); patch script .temp/t83_patch.py 51feb954.
- census run 2026-10-17T112529Z: 819 blocks / 814 distinct / 4 reused / 99 bad; briefs 2; parent-hits 2 (t82 live); db mtime unchanged.
- pytest RED: ImportError parse_brief_sv (1 collection error). GREEN: 13 passed.
- dry-runs (4): dispatch refused t1 exit 2, accepted t83 md5 d9ff...; fleet same pair; sessions.json sha unchanged 1a7392b2.
- commit: PENDING (S5). `_build.ps1` run 20261017T112824Z_ced7c2d2 exit 0, smoke 10.0.1423, embedded prompt PASS, lock released.
