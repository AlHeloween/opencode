<!-- intention: агенты сканируют list/glob/grep и читают доки питоном, не трогая codegraph и не читая файл -> первый сканер сессии без codegraph-вызова отказывается один раз с маршрутом на граф, а python/node-скрипт над текстом .md/.txt/.rst отказывается с маршрутом на read -->
<!-- goal_sv: graph-first 0.40, docs-are-read 0.35, once-only-latch 0.25 -->
# Graph first; docs are read, not scanned (t45)

State: ACTIVE. Owner, 2026-10-15: «наши ребятушки совсем не используют codegraph скатываются на
list/glob/grep это архи не эффективно, и еще одна деталь, у ребят привычка анализировать доки
питоном без вчитывания это надо пресекать». MECHANISM task — the kernel G1 rule already says
graph-before-scanners and is ignored; do NOT touch `prompt_kernel/` (t44 edits it this batch).

Baseline (my query, `.opencode/data/opencode.db`, named):
`SELECT tool_name, COUNT(*), COUNT(DISTINCT session_id) FROM part WHERE type='tool' AND
time_created > (strftime('%s','now') - 604800)*1000 GROUP BY tool_name ORDER BY calls DESC`
— last 7 days, 115 sessions with tool calls: scanners grep 1649/90 + glob 712/67 + list 199/55
= **2560 calls / 92 sessions**; codegraph* 2692/41 with the owner's self-test skew
(codegraphcodegraphsearch 814 in ONE session); organic spread codegraphcodegraphexplore 143/16,
codegraph 42/24. Sub-agents: 159 scanner calls / 17 sessions (joined on `session.parent_id`) —
included per the brief; each sub-agent session carries its own latch.

Shape: `stop-check.ts` (once-only latch, route text, opt-out env) + the shell constitution's
refusal path (throw with a route message — visible in the part as status:error, never swallowed).

Envelope: `src/session/graph-first.ts` (new), `src/session/doc-read.ts` (new), `processor.ts`
(one latch line), `tool/grep.ts` + `glob.ts` + `ls.ts` (gate before ask), `tool/bash.ts` +
`cmd.ts` (doc gate after AST enforcement), `test/session/graph-first.test.ts` +
`doc-read.test.ts` (new), this plan, `plans/MASTER_PLAN.md` (svm render), `_progress_log.md`.
No `bin/`, no `prompt_kernel/`, no other lanes' dirty files — stage by path. Bounds: steps 60,
tools 120, loops 4, depth 2, time 3 600 000 ms. NO `_build.ps1` — t44 runs the one build of this
batch; the report says the build is pending.

## Tasks

- [x] T1 Baseline re-measured with a named query; the owner's numbers reproduce (2560/92 scanner calls vs organic codegraph ≈1:65; sub-agents 159/17). <!-- sv: baseline 1.0 -->
- [ ] T2 Tests first, RED on current behaviour: `test/session/graph-first.test.ts` + `test/session/doc-read.test.ts`, each file in its own `bun test <file>` call through cmd_runner; false-positive controls inside (a byte check passes, a scanner after a codegraph call passes, no `.codegraph/` passes). <!-- sv: red-first 0.6, controls 0.4 -->
- [ ] T3 graph-first: `src/session/graph-first.ts` — OPT_OUT_ENV=`OPENCODE_GRAPH_FIRST`, per-session latch `{codegraph, refused}`, `isCodegraphTool` = normalized name startsWith("codegraph") (covers codegraph, codegraphexplore, codegraphcodegraph*), `scannerGate` refuses the FIRST grep/glob/list of a session with no codegraph call in a worktree with `.codegraph/`, route «ask codegraph first — codegraph_explore "<symbols or question>"; grep stays the negative text control after the graph answers»; wired: `processor.ts` completeToolCall → `noteToolCall(sessionID, part.tool)`; grep/glob/list execute → `scannerGate` BEFORE `ctx.ask` (a refused call never prompts for permission). No `.codegraph/` → inert. <!-- sv: graph-first 0.5, once-only-latch 0.3, wiring 0.2 -->
- [ ] T4 docs-are-read: `src/session/doc-read.ts` — OPT_OUT_ENV=`OPENCODE_DOC_READ_GATE`; fires on python/python3/node + `.md`/`.txt`/`.rst` + a TEXT read (`read_text(`/`readlines(`/`.read(`/`open(` — python text mode is the default; `readFileSync|readFile` only WITH an explicit utf8 encoding) and NOT on byte/write ops (`read_bytes`, `'rb'`/`'br'`, readFileSync without encoding, `open(...,'w'|'a'|'x')`, `write_text`/`write_bytes` — byte-level checks and doc writes stay allowed; writes are another rule's business); wired: `bash.ts` + `cmd.ts` after `enforceDestructiveShellFromAst`, throw with the route «read the document with `read` — a script over a doc is a scan, not reading». <!-- sv: docs-are-read 0.5, byte-allowance 0.3, wiring 0.2 -->
- [ ] T5 Oracles + close: `bun typecheck` from packages/opencode exit 0; the two named suites green, one file per call; commit naming the plan; `_progress_log.md` entry; the report says the build is pending (t44).

## Smoke Tests

Prediction: both suites RED before the modules exist (import failure IS the current behaviour —
no gate); after implementation green. Controls predicted to PASS before the gate exists and stay
PASS after: `read_bytes`/`'rb'`/readFileSync-without-utf8 over a doc runs; a scanner call after
`noteToolCall(codegraph…)` runs; a scanner call in a worktree without `.codegraph/` runs. The
refusal is visible in the tool part (status error), never swallowed. Mutation control: dropping
the once-only latch (`refused` flag) makes the SECOND scanner call refuse too — the suite must
catch it.

Residuals named, not built: the `run` tool (argv form) does not carry the doc gate — the brief
scoped bash/cmd; a python script FILE that reads docs internally is invisible to a text
heuristic; the latch is in-memory (a restart re-arms the once-refusal — a cheap nudge, by
design).

```yaml
Keywords: graph-first 0.40, docs-are-read 0.35, once-only-latch 0.25
Semantic dominant: Первый сканер без графа и питон над докой отказываются один раз с маршрутом — механизм, а не текст правила.
md5: f45a2c11b8e94d07a3c65f10d2b84e97
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 617f4b0ae28149d0a8c369bec5724f13
```
