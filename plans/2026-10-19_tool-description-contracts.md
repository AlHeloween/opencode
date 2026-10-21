# t94 — every tool's description states what its code enforces

<!-- intention: tool descriptions drift from refusals across 36 tools -> each description checked against its code by refusal keys, schema and examples, in error-rate order, so no model fails a tool because its manual promised what the code refuses -->
<!-- goal_sv:
```yaml
Keywords: tool-description-audit 0.35, refusal-key-contract 0.25, error-census-priority 0.20, orphan-descriptions 0.12, contract-tests 0.08
Semantic dominant: The edit lesson is applied to every tool: each description is checked against its code by refusal keys, schema and examples, in order of measured failure rate, so that no model fails a tool because its manual promised something the code refuses.
md5: a3eb5a7edb7d42fabae35e82e1c60284
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
note: hash values are generative tags — search them, never compute them.
```
-->

## Goal

`t93` fixed `edit` (20 refusal keys, decode named, `edit.txt` 5 506 B, test 7/7). `t94` applies the same
contract to every tool with a description, in measured error-rate order, so that at most 2% of calls per
tool fail for reasons the caller could have avoided (schema, refusal key). External failures and
repetition-loop sessions are counted separately, never silently.

## Context

- t93 plan/commit/test: `plans/2026-10-19_edit-description-contract.md`, commits `ee714492ec` (contract),
  `df82218a84` (test), `e739fd0b20` (2% box S7). Reuse its test helper (`extractKeys` regex,
  `EXPECTED_KEYS` catalogue shape) — do not write a second mechanism.
- t93 residual (open for EVERY tool, edit included): the test sees only refusals that carry a key. A new
  bare `throw new Error("…")` without a key slips past. Guard: every refusal/throw literal in a tool's
  code starts with a `[key]`; the test fails on any un-keyed throw. Exempt only named internal invariants.
- Error census (opencode.db, trailing 7 days, `type='tool'`, measured 2026-10-19):
  `edit` 1564 ok / 1317 err (877 are one GLM repetition loop `ses_ec2961e15ffefWEjqE2WOQOj10`, t46, 10-15;
  without it ≈22% week, ≈11-12% 10-17..19 — owned by t93),
  `logsearch` 14/7 (6× `ENAMETOOLONG uv_spawn`, 1× missing `pattern`),
  `universalsearch` 215/24 (all external: `localhost:3000` refused / aborted),
  `list` 184/11 (missing path ×9, stale `[graph-first: BLOCKED]` ×1),
  `question` 3/3 (all aborted),
  `recall` 452/10 (all 10 missing `reason`),
  `glob` 447/10 (1× access-denied, 5× stale BLOCKED, 4× aborted),
  `read` 4905/68 (file-not-found / offset-out-of-range / encoding),
  `grep` 2572/26 (stale BLOCKED ×8 sampled, aborted, invalid ripgrep output, missing path).
  All other tools ≤3% or no errors. Stale `[graph-first: BLOCKED]` classes are historical: t95
  (`c615342eec`) turned the graph rule into a reminder; `grep` for the string returns zero matches
  on current code (2026-10-19).
- Inventory: `packages/opencode/src/tool/*.txt` (36 files) vs `*.ts` (65 files). Tools with a `.ts` and no
  `.txt` carry an inline `description:` (notably `pipeline.ts`, `capability.ts`). Four `.txt` without a
  same-named `.ts` are NOT orphans — each is loaded under another name (grep 2026-10-19):
  `plan-enter.txt` → `plan.ts:ENTER_DESCRIPTION`, `planexit.txt` → `plan.ts:EXIT_DESCRIPTION`,
  `powershell.txt` → `bash.ts:POWERSHELL_DESCRIPTION` (ps-shell variant),
  `todowrite.txt` → `todo.ts:DESCRIPTION_WRITE`. Record the mapping; remove nothing without that grep.
- Priority order for the audit (by avoidable-error rate × volume): edit (t93-owned) → logsearch →
  universalsearch → list → question → recall → glob → read → grep → all remaining tools with a
  description (alphabetical), then tools with inline descriptions.

## State 2026-10-19 (stop with next named — bounds held for shared tree)

Landed 2026-10-19 (restarts verified): T0 contract+EXPECTED_FAIL (198d902241), T2 logsearch (0edc8fc3fa), T3 universalsearch (ffe50230), T4 list (671edc13), T5 question (ef9e5e79), T6 recall keys+example (aa706817), T7 glob (fa5c195e), T8 read 8-sites/5-keys (f064047e), T9 grep (67dc9000), T1 edit residual (no change), T10-write doc-only (805732ed), T10-task doc-only (8334d3f9; 2/61 both TDZ `ge`, source outside src — defect line recorded, doc not bent). Closing oracle this turn: contract 4/4 GREEN 2e5b1554; typecheck exit 0 7c5a8e37; build exit 0 smoke 10.0.1462 43bd3e4e. T10 scoping census holds. NEXT: T10-webfetch (3/748 — all aborted; external-failure note + example schema check), then run/aicall/codegraph/jobwait/shell, then remaining alphabetical + kernel-prose move to docs/tool-playbook.md. T11 orphans: none (four mapped). T12 post-promotion measure owed separately.

## Tasks

- [x] T0 Generic contract + un-keyed-throw guard (all tools) — DONE 2026-10-19: `test/tool/description-contract.test.ts` GREEN 4/4 run 20261019T085733Z_b02b2d6a (commit 198d902241). RED path recorded: aicall [Exact], messagesearch labels, run.txt JSONL, edit 7-vs-20, allowlist census. EXPECTED_FAIL: removed `[same-file]` line → 3/1 fail run 20261019T085815Z_60467854; restored, GREEN run 20261019T085836Z_5267b38d. Extend the t93 helper into
  `test/tool/description-contract.test.ts`: for every tool with a description (`.txt` import or inline
  `description:`), extract refusal keys from code (`["']\[[A-Za-z][A-Za-z0-9_+-]{2,}\]`) and from the doc;
  every code key appears in the doc and vice versa; every `throw new Error("` / `return { ok: false, error:`
  literal starts with a `[key]` (allowlist: named internal invariants with reason); every ```json example
  in the `.txt` parses against the tool's `Parameters` Schema. RED (missing key, un-keyed throw, bad
  example) then GREEN. Owns the final-oracle EXPECTED_FAIL control. <!-- sv:
```yaml
Keywords: generic-contract 0.40, unkeyed-throw-guard 0.30, example-schema-test 0.20, red-green 0.10
Semantic dominant: One contract test covers every tool so a new bare throw or a doc line without code fails the suite.
md5: b1c2d3e4f5a60718293a4b5c6d7e8f01
prev-md5: a3eb5a7edb7d42fabae35e82e1c60284
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T1 edit (t93-owned residual only) — DONE 2026-10-19: guard already covers edit.ts (contract key-equality 20==20 GREEN; unkeyed-scan finds no bare throw — `resolveEdits`/`refusals.join` throws are keyed by construction, no allowlist entry). Census rerun 2026-10-19: 1564 ok / 1317 err, 877 in loop ses_ec2961e15ffefWEjqE2WOQOj10 → ≈22% week ex-loop, ≈11–12% 10-17..19 (t93-owned). No `.txt` change needed. <!-- sv:
```yaml
Keywords: edit-residual 0.50, throw-guard 0.30, census-rerun 0.20
Semantic dominant: Close the t93 residual for edit: no un-keyed throw survives, census re-run recorded.
md5: c2d3e4f5a60718293a4b5c6d7e8f01a2
prev-md5: b1c2d3e4f5a60718293a4b5c6d7e8f01
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T2 logsearch (27% raw, 1 avoidable) — DONE 2026-10-19: census + cluster (ENAMETOOLONG ×6 external/tool-bug, missing-pattern ×1). Diff before: SILENCE `pattern` required; after: doc `**required**` + `## External failures` + `## Example` JSON. No keys in code, none in doc (vacuous pass). GREEN run 20261019T085959Z_f1a76525. ENAMETOOLONG recorded as suspected argv-too-long defect for a later code fix — not bent in the doc. <!-- sv:
```yaml
Keywords: logsearch-audit 0.40, required-pattern 0.30, external-spawn 0.20, defect-line 0.10
Semantic dominant: Logsearch doc states the required pattern and names the external spawn failures it cannot prevent.
md5: d3e4f5a60718293a4b5c6d7e8f01a2b3
prev-md5: c2d3e4f5a60718293a4b5c6d7e8f01a2
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T3 universalsearch (10%, all external) — DONE 2026-10-19: census 215/24 (service refused/aborted, all external) + cluster. Diff before: SILENCE (`query` Schema.optional but code throws per-source unless `job_id` polls; external down/disabled/abort unnamed). After: query row `required unless job_id polls` + `## External failures` (down/refused, disabled, aborted, agent-job timeout) + `## Example` call JSON (parses; keys valid per Parameters). No keys either side (17 bare throws stay allowlisted — code owns no keyed refusals, doc promises nothing the throws contradict). GREEN run 20261019T105154Z_e4182411 exit 0. census + cluster (service-down, aborted). Diff: no refusal
  keys in code vs doc promises; doc must name the external dependency (`localhost:3000` service) and the
  `source` values. RED test (keys empty on both sides + example parses), fix `.txt` only. <!-- sv:
```yaml
Keywords: universalsearch-external 0.50, service-dependency 0.30, doc-only-fix 0.20
Semantic dominant: Universalsearch doc names the external service it depends on because the code has no refusals to key.
md5: e4f5a60718293a4b5c6d7e8f01a2b3c4
prev-md5: d3e4f5a60718293a4b5c6d7e8f01a2b3
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
- [x] T4 list (6%) — DONE 2026-10-19: census 184/11 (missing path ×9, stale BLOCKED ×1 historical) + cluster. Diff before: SILENCE (all five Parameters optional but undocumented; missing-path behavior unnamed). After: `## Parameters` table (all optional, defaults) + `## Missing path` (reported, never invented; check path first) + `## Example` JSON (parses; path valid per Parameters). No throws in ls.ts (missing dir returns output; fs `No such file` surfaces from rg/stat — caller-avoidable, counted). GREEN run 20261019T105356Z_014b6f97 exit 0. <!-- sv:
```yaml
Keywords: list-audit 0.40, missing-path 0.30, stale-gate-gone 0.20, example-parse 0.10
Semantic dominant: List doc states exactly what its missing-path refusals do now that the stale gate is gone.
md5: f5a60718293a4b5c6d7e8f01a2b3c4d5
prev-md5: e4f5a60718293a4b5c6d7e8f01a2b3c4
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T5 question (50%, n=3, all aborted) — DONE 2026-10-19: census 3/3 aborted (interrupted, all external) + cluster. Diff: no schema/refusal surface beyond abort; doc example parses; added `## Aborted calls` (external stop, counted separately) + ask-only-what-words-alone-settle restraint. No keys either side. GREEN run 20261019T105529Z_b3e636b1 exit 0. Test:
  keys empty both sides, no example to parse or example parses. Fix `.txt` only if it over-promises. <!-- sv:
```yaml
Keywords: question-abort 0.60, no-schema-surface 0.25, doc-restraint 0.15
Semantic dominant: Question doc promises nothing the abort path cannot keep because all errors are external aborts.
md5: a60718293a4b5c6d7e8f01a2b3c4d5e6
prev-md5: f5a60718293a4b5c6d7e8f01a2b3c4d5
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T6 recall (2%) — DONE 2026-10-19: census 452/10 (all missing `reason`) + cluster. Keyed 6 `ok:false` refusals in recall.ts (`[not-a-tool-part]`, `[recall-of-recall]`, `[unfinished-result]`, `[empty-result]`, `[keep-on-attachment]`, `[release-needs-reason]` — additive prefixes, substring-safe); doc gains matching `## Refusals` table + `## Example` JSON with `reason` (parses; keys valid per Parameters). Contract 4/4 GREEN run 20261019T105749Z_526fc255, recall.test.ts 25/25 run 20261019T105802Z_7c3e07b4, recall-address 14/14 run 20261019T105817Z_f4143126. <!-- sv:
```yaml
Keywords: recall-reason 0.40, example-with-reason 0.30, refusal-keys 0.20, keep-release 0.10
Semantic dominant: Recall keeps its required reason and gains a parsing example plus keys on every refusal.
md5: b718293a4b5c6d7e8f01a2b3c4d5e6f7
prev-md5: a60718293a4b5c6d7e8f01a2b3c4d5e6
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T7 glob (2%) — DONE 2026-10-19: census 447/10 (1 access-denied external, 5 stale BLOCKED historical t95, 4 aborted) + cluster. Keyed the 1 throw in glob.ts (`[not-a-directory]`); doc gains `## Refusals` table + missing-path/external note (existing example parses). Allowlist drops `glob.ts`. Contract 4/4 GREEN run 20261019T110106Z_8078c1df, glob.test.ts 3/3 run 20261019T110119Z_6561e4a8. <!-- sv:
```yaml
Keywords: glob-audit 0.40, stale-block-gone 0.30, access-denied-external 0.20, example-parse 0.10
Semantic dominant: Glob doc matches the code after the stale gate removal, with external denial counted separately.
md5: c8293a4b5c6d7e8f01a2b3c4d5e6f708
prev-md5: b718293a4b5c6d7e8f01a2b3c4d5e6f7
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T8 read (1%) — DONE 2026-10-19: census 4905/68 (file-not-found w/ similar names, offset-out-of-range, bad-encoding) + cluster. Keyed 8 refusal sites in read.ts under 5 keys (`[not-found]` ×2 Effect.fail, `[offset-out-of-range]` ×2, `[bad-encoding]`, `[binary-file]` ×2 incl. lines(), `[undecodable]`); doc gains matching 5-row `## Refusals` table (existing example parses). Fixed one self-made brace deletion (duplicate-line repair dropped a `}`; restored, diff verified additive-only). Allowlist drops `read.ts`. Contract 4/4 GREEN run 20261019T110645Z_30f3f98a, read.test.ts 46/46 run 20261019T110659Z_8150e3c8. <!-- sv:
```yaml
Keywords: read-audit 0.40, address-contract 0.30, encoding-page 0.20, example-parse 0.10
Semantic dominant: Read doc states exactly the address, range and encoding refusals the code enforces.
md5: d93a4b5c6d7e8f01a2b3c4d5e6f70819
prev-md5: c8293a4b5c6d7e8f01a2b3c4d5e6f708
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [x] T9 grep (1%) — DONE 2026-10-19: census 2572/26 (stale BLOCKED ×8 historical t95, aborted, invalid ripgrep output, missing path) + cluster. Keyed the 1 throw in grep.ts (`[pattern-required]`); doc gains `## Refusals` table + include-filter control rule + stale-gate/external note (existing example parses). Allowlist drops `grep.ts`. Contract 4/4 GREEN run 20261019T111002Z_947f0aa2 exit 0. <!-- sv:
```yaml
Keywords: grep-audit 0.40, dialect-contract 0.30, stale-block-gone 0.20, example-parse 0.10
Semantic dominant: Grep doc states the dialect and filter-control rules the code enforces after the stale gate removal.
md5: e3a4b5c6d7e8f01a2b3c4d5e6f708192a
prev-md5: d93a4b5c6d7e8f01a2b3c4d5e6f70819
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [ ] T10 remaining `.txt` tools (alphabetical, ≤3% or no errors) — per tool: census (counts + 1–2 examples
  or `no errors in window`), diff (params vs Schema, examples parse, refusals keyed ↔ doc lines,
  CONTRADICTION/SILENCE/FICTION counts before→after), RED test extension, fix, GREEN, one commit per
  tool. Order: aicall, bash (+powershell variant), cmd, codegraph, compare, compact, cua, dbread,
  fossilcell, fossilgrep, imagerender, lsp, messagesearch, question (done T5), restore, run, samply,
  sessionread, skill, summaryedit, task, todowrite (mapped), treediff, webfetch, write, plan-enter,
  planexit, capability/inline, pipeline/inline, plus any other inline-`description:` tool found by the
  T0 inventory. Kernel-gate prose and dated history move to `docs/tool-playbook.md`; the `.txt` keeps
  only send/receive/refused. <!-- sv:
```yaml
Keywords: remaining-tools 0.40, alphabetical-sweep 0.30, kernel-prose-out 0.20, one-commit-per-tool 0.10
Semantic dominant: Every remaining tool gets the same census, diff, keyed refusals and parsing example, one commit at a time.
md5: f4b5c6d7e8f01a2b3c4d5e6f708192a3b
prev-md5: e3a4b5c6d7e8f01a2b3c4d5e6f708192a
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [ ] T11 orphans + inline inventory — record the four mappings (plan-enter, planexit, powershell,
  todowrite) with the loading grep as evidence; verify no other `.txt` lacks a loader (T0 inventory
  enumerates every `.txt` → loader). If a true orphan appears, remove it in its own commit with the
  grep as evidence. If a `.ts` has no `.txt`, check its inline `description:` under the same contract. <!-- sv:
```yaml
Keywords: orphan-mapping 0.50, loader-grep 0.30, inline-descriptions 0.20
Semantic dominant: No description file is removed without a loader grep, and inline descriptions face the same contract.
md5: a5c6d7e8f01a2b3c4d5e6f708192a3b4c
prev-md5: f4b5c6d7e8f01a2b3c4d5e6f708192a3b
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->
- [ ] T12 acceptance + post-promotion measure — per-tool ≤2% caller-avoidable errors (schema, refusal key)
  over 7 days after promotion; exclusions listed, never silent (external: network/provider/missing binary;
  repetition-loop sessions named by id). Record the rerun query (current schema: `part` table,
  `tool_name`/`status`/`time_created`, `data` JSON for classes) and the baseline from Context. Not a
  gate for GREEN — a separately recorded owner measure. <!-- sv:
```yaml
Keywords: acceptance-2pct 0.45, avoidable-vs-external 0.30, loop-exclusion 0.15, rerun-query 0.10
Semantic dominant: The owner fixes acceptance at one or two avoidable errors per hundred calls, exclusions named, measured after promotion.
md5: b6d7e8f01a2b3c4d5e6f708192a3b4c5d
prev-md5: a5c6d7e8f01a2b3c4d5e6f708192a3b4c
parent-goal-md5: a3eb5a7edb7d42fabae35e82e1c60284
note: hash values are generative tags — search them, never compute them.
```
-->

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/tool/description-contract.test.ts` — RED before
  T0 (missing key / un-keyed throw / bad example), GREEN after every tool fix.
- `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-description-contract.test.ts` — stays
  7/7 GREEN (t93 guard, extended by T1 only).
- Per-tool focused test only: `cmd_runner start --cwd packages/opencode -- bun test <that-tool-test-file>` —
  never the full suite (`bun test` with no path is forbidden).
- EXPECTED_FAIL control: deliberately remove one doc line from the contract test's scope and show it FAILS,
  then restore.
- `bun typecheck` in `packages/opencode` — green.
- `pwsh -NoProfile -File _build.ps1` via cmd_runner from repo root — green; read `<run>/state.json` + full
  output.
- Post-promotion (owner, separately): same per-tool 7-day avoidable-error query. Rerun intent (current
  schema; rerun against current schema at the time):
  ```sql
  -- rerun intent: per-tool calls vs caller-avoidable errors over trailing 7 days
  -- avoidable = status='error' AND (SchemaError OR refusal [key]) in data, minus exclusions
  SELECT tool_name, status, COUNT(*) FROM part
  WHERE type='tool' AND time_created > <now_ms> - 7*86400*1000
  GROUP BY tool_name, status ORDER BY tool_name, status;
  -- then per tool: substr(data,1,900) for status='error', cluster by class, name exclusions by session id
  ```

## Risks

- Decode/key renames hide another schema error → parse-then-validate, message test per tool (t93 pattern).
- Full-suite temptation → one test file per cmd_runner call; a wall of output is not a report.
- `bin/` untouched; wire/gateway out of scope; behaviour changes only for a code defect found against a
  documented requirement, in its own commit with its own test.
- Shared tree: two other robots work here — `git add` only own paths, `_progress_log.md` append-only
  (cherry-pick conflict: keep both entries), `scripts/commit_own.py --session ses_eaca6cd7fffepObRe1US60KICD`.

## Out of scope

Tool behaviour changes beyond fixing a code defect found against a documented requirement, `bin/`, wire/
gateway code. Bounds: steps 120, tools 300, loops 2, depth 2, time 10 800 000 ms. At the limit, persist
per-tool state in this plan and stop with the next tool named.

## Report

- «Измерено:»: per tool, CONTRADICTION/SILENCE/FICTION counts before and after, the commits, the orphans
  found (here: none — four mapped, grep above);
- «Не измерено:».
