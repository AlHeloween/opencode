# t136 — read-as-is verification of everything t135 closed, moved or quoted

Scope (the brief): t135 commits `e4b2313eb0` + `d5c52c7e2d` only. Later t135
commits (`b1ed6e73`, `881f77c1`, `4d550c58`, …) are out of scope and were not
verified. Every item below was read as-is with the read tool at the cited
path:line (working copy = committed state at `e4b2313eb0` for every cited plan
file — proven: `git diff --name-only e4b2313eb0 HEAD -- plans plans_completed
plans/futures` lists none of them), or measured with the named instrument.
A shell/search line never stands in for a reading; a test run is a separate leg.

Claims enumerated from the report: §2 table = 12 box rows; §3 table = 3 move
rows; class (c) = 17 boxes (table TOTAL row); MASTER_PLAN = 1 change.
**Rows below: 33. Claims enumerated: 33.**

## A. Closed boxes (12 rows from REPORT §2)

- A1 `2026-10-19_undo-broken.md` T2 (d) — **PASS**. Ticked at
  `plans_completed/2026-10-19_undo-broken.md:70`: "the condition never held, so
  nothing was owed. T1 passed clean (this plan's own S-T1 result, 2026-10-19:
  «clean pass — undo applied (DB revert set, file BEFORE), redo applied
  (revert null, file AFTER), process alive throughout; H5 falsified on this
  path/build»)". S-T1 at :80 repeats the clean-pass RESULT with falsification
  recorded as falsification, not failure. Receipt commit `b38d45e5ce` exists
  (`git cat-file -t` → commit). The vacuity is inside the box's own words, and
  the superseding record (S-T1 + commit) exists and covers it.
- A2 `2026-09-21_mstar-order-and-summary-restore.md` memory map (d) —
  **PASS**. Ticked at `plans/2026-09-21_mstar-order-and-summary-restore.md:17`.
  Receipt text verified verbatim in code: `packages/opencode/src/memory/
  spine.ts:166-168` ("`parsePlanMap` stood here until 2026-10-01 (plan L3). It
  read the map hand-kept in `memory/reasoning.md`, and that file held ZERO
  `md5:` lines") and `packages/opencode/src/util/plan-status.ts:501-503`
  ("Why not `parsePlanMap`: that read the map hand-kept in `memory/
  reasoning.md`, MEASURED 2026-10-01 to hold ZERO `md5:` lines"). `grep
  parsePlanMap` over `packages/opencode/src` → exactly 2 hits, both these
  comment lines, 0 live readers. The supersession record is accurate.
- A3 `2026-09-22_reasoning-stream-render-stability.md` T4 (d) — **FAIL**.
  Ticked at `plans/2026-09-22_reasoning-stream-render-stability.md:165`.
  The receipt names two things that are not as stated: (1) "this plan's own
  STATUS line (2026-09-24)" — the file holds STATUS lines dated 2026-09-23
  only (:422, :461); no STATUS line dated 2026-09-24 exists. (2) "the
  replacing boxes T11a/T13a" — T13a exists as an open box (:839-844, the seam
  + live trace) and the replay test file exists
  (`packages/opentui/packages/core/src/renderables/__tests__/
  stream-replay-sources.test.ts`), but **T11a is not a box**: no `- [ ]
  **T11a**` checkbox exists anywhere in the plan (only a mention inside T11's
  body, :628). The cause is real — the owner's finding exists verbatim at :302
  («Бро - ты не сможешь поймать этот дефект так, возьми данные из логгера
  и…») — but the receipt as written contradicts the file. FAIL names exactly
  that.
- A4 same plan T7 (d) — **PASS** (as a supersession record, which is what it
  claims to be). Ticked at :402; the supersession line and the replacing box
  T13b (:887-888, open, "the cure above … confirmed by the same seam reading
  zero flickers live") exist, and the stability half rests on closed runs
  (T11b [x], :670). Nothing here claims a run happened.
- A5 `2026-10-01_tool-description-contracts.md` C2 (a) — **FAIL**. Ticked at
  `plans/2026-10-01_tool-description-contracts.md:67` ("the one thing this box
  still owed — a mutation check — was run on 2026-10-09", receipt
  `adedb84375`, which exists). But the same box's own body, :175-177, still
  reads: "(г) `grep` на НЕВАЛИДНОМ регексе отвечает «No matches found» вместо
  ошибки ✗ — **воспроизведено заново 2026-10-09** … (класс инструмента, вне
  C2) — бокс `[ ]` держит теперь ровно он". A box that says `[ ]` holds it
  cannot be `[x]`. Re-measured live in this session: `grep` for
  `MUTATION|const notice|+ notice` over `packages/opencode/src/tool/grep.ts`
  returns "No matches found" — residual (г) is still live. The tick
  contradicts the box's own text and the live behavior.
- A6 same plan C3 (d) — **PASS**. Ticked at :178. Every named tool (bash,
  cmd, powershell, run) appears in the superseding plan's T10 order list
  (`plans/2026-10-19_tool-description-contracts.md:171-174`: "bash
  (+powershell variant), cmd … run …"); the landing commits `805732ed`,
  `8334d3f9` exist. Superseding item exists and covers the tools.
- A7 same plan C4 (d) — **PASS**. Ticked at :179. All seven landed commits
  exist with per-tool subjects (`0edc8fc3fa` logsearch, `ffe50230`
  universalsearch, `671edc13` list, `aa706817` recall, `fa5c195e` glob,
  `f064047e` read, `67dc9000` grep), and the superseding plan's State line
  (`plans/2026-10-19_tool-description-contracts.md:56`) names the NEXT
  remainder ("T10-webfetch … then run/aicall/codegraph/jobwait/shell").
  Superseding coverage is explicit, including the uncovered remainder.
- A8 same plan C5 (d) — **PASS**. Ticked at :180. All twelve tools appear in
  the superseding T10 list (:171-174) and T11 (:186-188) records the four
  orphan mappings; the loading evidence verified in code:
  `packages/opencode/src/tool/plan.ts:12-13,85,143` (ENTER/EXIT_DESCRIPTION),
  `bash.ts:7,680` (POWERSHELL_DESCRIPTION), `todo.ts:3,31`
  (DESCRIPTION_WRITE). Superseding item exists and covers.
- A9 `2026-10-14_kernel-stop-claim-release.md` M1 (a+d) — **PASS**. Ticked at
  `plans/2026-10-14_kernel-stop-claim-release.md:34`. First half verified in
  code: `packages/opencode/src/util/plan-status.ts:790-833`
  (`STOP_CLAIM_STATES`, `auditStopClaim`, the `plans/postponed/**` loop and
  the active-plans loop). Second half superseded as stated:
  `packages/opencode/src/session/stop-check.ts:150-153` ("A stop claim no
  longer ends a turn: blocked is not an exit, the next action is"). Both
  halves check out.
- A10 `2026-10-20_kernel-line-audit.md` P1 (a) — **PASS**. Ticked at
  `plans/2026-10-20_kernel-line-audit.md:29`. Re-measured: file
  `experiments/2026-10-20_kernel-audit/kernel-product-c912b4ac52.txt` exists,
  75 630 B, sha256
  `8407d4aeb42dc5f2aac8bfb897a25dfcafb58809e0e3adacd01527be043b6114`
  (python hashlib, matches the pin exactly). The SVM manifest for TASK-1 reads
  `state=verified` with the same 75 630 B / `8407d4ae…` oracle. Pin, manifest
  and bytes agree.
- A11 `2026-10-20_triz-kernel-correspondence.md` S8 (a) — **FAIL**. Ticked at
  `plans_completed/2026-10-20_triz-kernel-correspondence.md:24`; receipt
  claims commit `7cb11a686e` "carries this plan, `docs/glossary.md` (the 21
  entries) and the report". The commit carries exactly one file — the plan
  (`git show --name-only --format="" 7cb11a686e` → 1 path, 40 insertions).
  It carries no glossary and no report. The TRIZ glossary block (23 `##`
  headings, :110-242 of `docs/glossary.md` — the claim says 21, the file
  holds 23) was introduced by `168c982477` (t96), proven by `git log -S "##
  Nine Windows"` and `-S "## Ideal Final Result"` (both → `168c982477`).
  The report `experiments/2026-10-20_triz-kernel/REPORT.md` exists on disk
  (144 lines, read) but was never committed (`git log --all --oneline --`
  that path → empty) and is gitignored (`.gitignore:72:experiments/`).
  The receipt as written is false on all three carried items except the plan.
- A12 same plan S9 (a) — **UNKNOWN**. Ticked at :25 with run
  `20261021T203353Z_ce9f9b26` and precise state.json numbers. The run
  directory does not exist (`dir` named query → File Not Found) and no
  `*ce9f9b26*` artifact exists under `.opencode/data`. But absence is not
  contradiction here: the store demonstrably prunes — the control run
  `20261014T120445Z_71b83365` (cited 8 days earlier in a settled plan,
  `plans/2026-10-14_kernel-stop-claim-release.md:37`) is likewise absent,
  while 2026-10-20 runs are retained. No leg confirms the run happened; no
  leg refutes it. UNKNOWN, with the store-pruning evidence stated.

## B. Moved plans (3 rows from REPORT §3 — the brief says "2", the report
names 3; the count "2" is itself a finding, see §E)

- B1 `plans/2026-10-19_undo-broken.md` → `plans_completed/` — **PASS**.
  Earned: all five boxes T0–T4 are `[x]` (:61-76), the only t135 tick (T2) is
  row A1 (PASS). Git rename landed in the same commit:
  `git show --find-renames --stat e4b2313eb0` shows
  `{plans => plans_completed}/2026-10-19_undo-broken.md` (R092 — similarity
  under 100% because the T2 tick rode along, which is the earned tick).
- B2 `plans/2026-10-20_triz-kernel-correspondence.md` → `plans_completed/` —
  **FAIL**. Landed as a rename (R070) but not earned: S8 and S9 receipts fail
  (rows A11, A12), so two boxes lack confirmed artefacts and the plan still
  has unconfirmed work at the moment of the move. The rename is real; the
  earned-ness is not.
- B3 `plans/2026-10-16_unmanaged-options.md` → `plans/futures/` — **PASS**.
  Zero boxes (nothing executable to earn). The deliverable is the file itself
  (284 lines: the inventory + the `/settings` proposal), the leaf scope is
  stated ("Leaf scope: INVENTORY + PLAN ONLY. No product code", :7), and a
  CONDITION is written into the file (:4: resumes as a NEW executable plan
  when the owner names the first USER rows; the one open item, "A3 owner
  decision outstanding", is a DECISION, not a task). Rename R095 landed in
  the commit. The owner's rule quoted in the CONDITION is sourced at
  session `ses_e9ffe1e38ffeom6UvwKP1ZNMgo` #2 (owner verbatim 2026-10-22:
  «План делается чтобы его сделать, для глобальной разработки есть
  мастерплан.»).

## C. Owner quotes, class (c) (17 boxes; 16 carry quote + resumption, 1 does not)

- C1 installer I1 (`plans/2026-09-30_robot-installer.md:514`) — **PASS**.
  Quote «Вопросы с vmware пока отложим до лучших времен» (owner, 2026-10-01)
  present verbatim; resume: the owner provides the snapshot (or names a
  substitute host). Source row for the Russian original: the cua plan's own
  line (`plans/2026-09-29_cua-windows-debug-input.md:151`, identical wording).
- C2 installer U1 (:778) — **PASS**. Quote «Open for stage 2: … and the
  redistribution question (bot-wall bypass) — a legal decision, not a
  measurement» present verbatim; resume: the named implementable half (official
  APIs first, paced polite fetching, stop at any CAPTCHA) runs as (b) without
  waiting. Source row: the audit plan's line
  (`plans/2026-09-30_cua-supply-chain-audit.md:81`, same wording).
- C3 installer B6 (:898) — **PASS**. Same VMware reason as I1, stated;
  resume: runs on the pristine snapshot when it exists, never faked on the
  build host.
- C4 cua T5 (`plans/2026-09-29_cua-windows-debug-input.md:148`) — **PASS**,
  and C5 cua T6 (same note) — **PASS**. Quote «VMware tier POSTPONED (owner,
  2026-10-01: «Вопросы с vmware пока отложим до лучших времен»): O2, T5, T6
  are parked…» present verbatim; source row :151 (the plan's own POSTPONED
  line, identical Russian sentence); resume: the owner lifts the pause (or
  names O1).
- C6 corp-bridge B3 and C7 corp-bridge B4
  (`plans/2026-10-21_corporation-observability-bridge.md:29`) — **PASS**,
  **PASS**. Quotes «1. Panel surface: B … or A-only, or C (TUI) instead?» and
  «2. Push granularity: turn-end + heartbeat … or finer …?» present verbatim;
  source rows :42-43 (the plan's own "Owner decisions (asked, never
  assumed)"); resume: the two answers; the decided half (B1/B2/B5/B6/B7) runs
  first.
- C8 mstar recursive-scan half
  (`plans/2026-09-21_mstar-order-and-summary-restore.md:34`) — **PASS**. Quote
  «рекурсивный скан — СПОРЕН и владельцу записан открытым» present verbatim
  (source: the same box's body, :32); resume: the owner names descend-vs-canon.
- C9 tool-contracts-01 C7
  (`plans/2026-10-01_tool-description-contracts.md:200`) — **PASS**. Quote
  «Waits on the owner's run — the robot cannot produce a `file` part itself»
  present verbatim (source: the same box's recipe, :199); resume: the owner's
  paste; no robot may produce the part.
- C10 kernel-candidate `--install` half
  (`plans/2026-09-28_kernel-candidate-incorporation.md:295`) — **PASS**. Quote
  «Not closable here: `--install` is the owner's act and the manifest red
  needs the F8 fix (kernel row)» present verbatim (source: the same box,
  :294); resume: F8 lands → owner runs `--install` + repin.
- C11 recall R5 (`plans/2026-10-13_recall-read-address-space.md:54`) —
  **PASS**. Quote «the owner's call, not a robot's» present verbatim
  (source: the same box, :53); resume: the owner names `space` or accepts the
  two re-pointed legacy selections.
- C12 org-portable-home S9 (`plans/2026-10-08_org-portable-home.md:69`) —
  **PASS**. Quote «GATED on Claude's review verdict on the kernel diff (the
  declared stop of S6; the task: «STOP before --install»)» present verbatim
  (source: the same box, :66-67); resume: verdict → pytest → re-stamp/install.
- C13 web-tui-parity W5 (`plans/2026-10-15_web-tui-parity.md:93`) — **PASS**.
  Quote «busy frame BLOCKED keyless: 4 models × 5 turns → 401 Invalid
  credential, isRetryable:false — the 10-07 public-key path regressed
  upstream» present verbatim (source: the same box, :92); resume: the owner
  supplies a key for ONE model → one busy turn → frame capture on the stand.
- C14 self-edit P2b (`plans/2026-10-16_self-edit-directive.md:91`) —
  **PASS**. Quote «Owner decides default last» (source: the plan's own words,
  P2 line); resume: the owner names the default; no robot picks one.
- C15 global-recents (`plans/2026-10-18_global-recents-constraint.md:21`) —
  **PASS**. Quote «The plan stays ACTIVE until this box is ticked by the
  owner's own edit» present verbatim (source: the OWNER BOX, :20); resume:
  the owner enters `globalRecents` in the TUI.
- C16 mcps S7/S8 OAuth half
  (`plans/2026-10-08_mcps-connector-manager.md:33`) — **PASS**. Quotes
  «Authenticate on a real OAuth connector (Canva, once the owner's app
  credentials are in config) → status flips `needs_auth` → `connected`» and
  «one real OAuth connector when credentials exist» present verbatim
  (source: the plan's own smoke table, :43 and :32); resume: the owner
  supplies one Developer-Portal app; the local echo-server half runs first.
- C17 dais-peer-trust D3 — **FAIL**. `plans/2026-10-15_dais-peer-trust-
  reward.md:59` reads "- [ ] D3 Owner decision: weight of T in R; then kernel
  text through the pipeline (STOP before install, review)." The file holds
  NO t135 note at all (`grep t135` → no matches; file unchanged since
  `e4b2313eb0`, so the committed state is the same). The c=1 count in the
  report's table has no inserted quote and no resumption condition. 16 of 17
  carry both; this one carries neither.

## D. MASTER_PLAN change (1 row)

- D1 "changed by 82 lines" — **PASS** on both asked questions.
  `git show --numstat e4b2313eb0 -- plans/MASTER_PLAN.md` → 40 insertions,
  42 deletions = 82 changed lines. It is a render, not a hand edit: the
  render marker is present (`<!-- generated below — \`svm render\` (S4)…`,
  `plans/MASTER_PLAN.md:147`, and per `docs/plan-maintenance.md:15-16` the
  renderer rewrites everything below it from the plan files + SVM store while
  preserving the head). The hand-owned head is byte-identical across the
  commit (HEAD-vs-parent split at the marker: 11 705 bytes each, True —
  `check_master_plan.py e4b2313eb0`). Observation (not a verdict on the asked
  questions): the committed body was stale against the committed tree (51
  entries vs 52 files: 5 tracked plans missing from the body, 4 on-disk-but-
  untracked plans included) — consistent with the report's own disclosure
  ("The tree moved under the triage", REPORT :7); the extras prove a live-
  disk render rather than a hand edit. Healed by HEAD (50 files / 50
  entries, 0 skew).

## E. Summary-number findings (the brief's own counts vs the report's tables)

- "10 boxes closed" vs REPORT §2's own 12 rows (A1–A12 above) and 12 ticked
  boxes in the commit diff — the summary number is wrong; the item list is
  complete at 12.
- "2 plans moved" vs §3's own 3 rows (B1–B3) — wrong; the moves are three,
  each a git rename in the commit (R092/R070/R095).
- REPORT §2 line 99 ("10 closed as already earned, 7 as superseded") matches
  neither its own table (5 a-rows + 8 d-rows = 12 distinct boxes) nor the
  §5 class shares (a=10, d=7 are PRE-triage classifications of open boxes,
  not closures).
- "21 glossary entries" (S8 receipt) vs 23 TRIZ `##` headings in
  `docs/glossary.md` (:110-242) — and none of them via the cited commit.

## Re-run oracles (minutes each)

- `git show --numstat --format=short e4b2313eb0 -- plans/MASTER_PLAN.md`
  → expect `40 42`.
- `python experiments/2026-10-22_t135-verification/check_master_plan.py
  e4b2313eb0` → expect `HEAD BYTE-IDENTICAL : True`, `51 vs 52`, missing 5 /
  extra 4 as named.
- `git show --find-renames --stat e4b2313eb0 -- <the six move paths>` →
  expect the three `{old => new}` renames.
- `for %h in (b38d45e5ce adedb84375 7cb11a686e a36f434dfe 18fe82c426
  0edc8fc3fa ffe50230 671edc13 aa706817 fa5c195e f064047e 67dc9000
  805732ed 8334d3f9) do @git cat-file -t %h` → expect 17× `commit` + OK.
- `python -c "import hashlib; d=open(r'…\experiments\
  2026-10-20_kernel-audit\kernel-product-c912b4ac52.txt','rb').read();
  print(len(d), hashlib.sha256(d).hexdigest())"` → expect `75630
  8407d4aeb42dc5f2aac8bfb897a25dfcafb58809e0e3adacd01527be043b6114`.
- `grep parsePlanMap packages/opencode/src` → expect exactly the 2 comment
  hits (`spine.ts:166`, `plan-status.ts:501`), 0 code readers.
- `grep` for `MUTATION|const notice|+ notice` over
  `packages/opencode/src/tool/grep.ts` → expect "No matches found"
  (residual (г) still live — contradicts A5's tick).
- `git show --name-only --format="" 7cb11a686e` → expect the plan file only
  (contradicts A11's receipt).
- `git log --oneline -S "## Nine Windows" -- docs/glossary.md` → expect
  `168c982477`, not `7cb11a686e`.
- `git check-ignore -v experiments/2026-10-20_triz-kernel/REPORT.md` →
  expect `.gitignore:72:experiments/…`.
- `git log --all --oneline -- experiments/2026-10-20_triz-kernel/REPORT.md`
  → expect empty (never committed).
- `dir /b "C:\Windows\logs\cmd_runner\20261021T203353Z_ce9f9b26"` → expect
  File Not Found (A12 stays UNKNOWN; control
  `…\20261014T120445Z_71b83365` is likewise absent — the store prunes).
