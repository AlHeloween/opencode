<!-- intention: граф не строится вовсе, агенты сканируют и читают доки скриптами -> на старте задачи хост сам строит граф (sync + explore с текстом задачи, результат в ход до первого вызова тула), первый сканер без codegraph-вызова отказывается один раз с маршрутом, а python/node-скрипт над текстом .md/.txt/.rst отказывается с маршрутом на read -->
<!-- goal_sv: turn-start-prebuild 0.35, graph-first 0.30, docs-are-read 0.20, once-only-latch 0.15 -->
# Graph first; docs are read, not scanned (t45)

State: CLOSED — the owner's correction 1 (msg_13d50620d0, «перед выполнением задачи надо построить граф») was restored after the fold lost it; the PRIMARY item (T6, turn-start graph pre-build) is implemented and receipted, the backstop (scanner once-refusal) and the docs-are-read gate from 4301e3a8ec are kept. Owner, 2026-10-15: «наши ребятушки совсем не используют codegraph скатываются на
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
- [x] T2 Tests first, RED on current behaviour: `test/session/graph-first.test.ts` + `test/session/doc-read.test.ts`, each file in its own `bun test <file>` call through cmd_runner; false-positive controls inside (a byte check passes, a scanner after a codegraph call passes, no `.codegraph/` passes). Receipt: RED runs 20261015T024936Z_68dcd953 + 20261015T024949Z_44ac33c0 (both exit 1, 0 pass — the modules did not exist); GREEN after implementation 9/0 and 12/0. <!-- sv: red-first 0.6, controls 0.4 -->
- [x] T3 graph-first: `src/session/graph-first.ts` — OPT_OUT_ENV=`OPENCODE_GRAPH_FIRST`, per-session latch `{codegraph, refused}`, `isCodegraphTool` = normalized name startsWith("codegraph") (covers codegraph, codegraphexplore, codegraphcodegraph*), `scannerGate` refuses the FIRST grep/glob/list of a session with no codegraph call in a worktree with `.codegraph/`, route «ask codegraph first — codegraph_explore "<symbols or question>"; grep stays the negative text control after the graph answers»; wired: `processor.ts` completeToolCall → `noteToolCall(sessionID, part.tool)`; grep/glob/list execute → `scannerGate` BEFORE `ctx.ask` (a refused call never prompts for permission). No `.codegraph/` → inert. Receipt: commit 4301e3a8ec; suite 9 pass / 0 fail (20261015T025236Z_e410d21f). <!-- sv: graph-first 0.5, once-only-latch 0.3, wiring 0.2 -->
- [x] T4 docs-are-read: `src/session/doc-read.ts` — OPT_OUT_ENV=`OPENCODE_DOC_READ_GATE`; fires on python/python3/node + `.md`/`.txt`/`.rst` + a TEXT read (`read_text(`/`readlines(`/`.read(`/`open(` — python text mode is the default; `readFileSync|readFile` only WITH an explicit utf8 encoding) and NOT on byte/write ops (`read_bytes`, `'rb'`/`'br'`, readFileSync without encoding, `open(...,'w'|'a'|'x')`, `write_text`/`write_bytes` — byte-level checks and doc writes stay allowed; writes are another rule's business); wired: `bash.ts` + `cmd.ts` after `enforceDestructiveShellFromAst`, throw with the route «read the document with `read` — a script over a doc is a scan, not reading». Receipt: commit 4301e3a8ec; suite 12 pass / 0 fail (20261015T025414Z_f530b170; one TEST assertion fixed — its regex was stricter than the brief's route text; the code was right). <!-- sv: docs-are-read 0.5, byte-allowance 0.3, wiring 0.2 -->
- [x] T5 Oracles + close: `bun typecheck` from packages/opencode exit 0; the two named suites green, one file per call; commit naming the plan; `_progress_log.md` entry; the report says the build is pending (t44). Receipt: typecheck exit 0 (20261015T025427Z_6c58effd); code commit 4301e3a8ec; plan moves to plans_completed/ in the close commit; build PENDING — t44 runs the one build of this batch. <!-- sv: closure 0.6, evidence 0.4 -->
- [x] T6 Turn-start graph pre-build — PRIMARY (owner correction 1, «перед выполнением задачи надо построить граф»; the correction named it T5 — the number was taken by the closure box first): at the start of a task (the user turn that opens the work, in a worktree with `.codegraph/`) the HOST itself (a) runs the incremental codegraph sync, (b) runs codegraph explore with the task text, (c) attaches the result — files, symbols, call paths, blast radius — to that turn as context the model sees before its first tool call. Once per task at the start of the turn, like the fossil turn-start snapshot (AGENTS.md § Granularity); into the turn (mutable tail), never the system prefix. Size: codegraph's own cap (maxFiles), chosen from measured attached sizes on three real briefs (t44, t42, t31), recorded in this plan. A failed sync/explore is logged and the turn proceeds. The pre-built graph counts as the session's codegraph call for the graph-first latch. IMPLEMENTATION: `src/session/graph-prebuild.ts` (decision graphPrebuildDecision: disabled/empty-task/no-index/build; syncCodegraphIndex — the resolved binary, incremental, 30 s cap, logged never fatal; buildGraphContext — explore via the codegraph MCP, failure logged → undefined); wired at the START of runLoop (prompt.ts) — the loop is the turn's actual start: a noReply prompt records a message without opening work, and the harness drives loop() directly (the first wiring in prompt() after the noReply early-return was unreachable in the harness pattern and was moved); the part is a synthetic text part with metadata `graph_prebuild` on the OPENING USER MESSAGE (not a separate message — the stop-check's lastUser/parentID logic stays intact); markPrebuilt(sessionID) arms the graph-first latch. MEASURED attached sizes (maxFiles = the tool's own default 12, three real briefs, primary-agent probes after the delegated counter was stall-killed): t44 ≈ 24 KB, t42 ≈ 22 KB, t31 ≈ 26 KB — cap choice: the tool's own default (12); maxFiles is the knob if a smaller attachment is wanted. Receipt: RED 20261015T031450Z_220c9b64 (3 pass / 1 fail — the attach case red, all three controls green on current behaviour); GREEN 20261015T032049Z_42608cd6 (4 pass / 0 fail); typecheck exit 0 (20261015T032149Z_3155aee5); commit b463c82d07. <!-- sv: turn-start-prebuild 0.5, host-attach 0.3, fail-open 0.2 -->
- [x] T6-review — owner review of b463c82d07 found ONE defect (rest PASS: fail-open, mutable tail, markPrebuilt latch, tests RED→GREEN): the hook at runLoop start + findMessage (newest-first) fired on EVERY user turn — every correction, every stop-check continuation, every «привет» paid sync+explore (~2.4 s) and attached another 20-26 KB (ten user messages ≈ 250 KB). FIX (owner's simplest form, commit 2748ae288f): build only when NO message of the session already carries a part with metadata PREBUILD_KEY — once per SESSION, on the opening turn; synthetic user messages never build (the empty-task branch — every part synthetic → taskText empty); later turns that need structure call codegraph themselves (the backstop latch is already satisfied). Tests: once-per-session RED first (20261015T033104Z_30ef600b, 5 pass / 1 fail — the second turn attached a SECOND part, Expected 1 Received 2), then GREEN 6 pass / 0 fail (20261015T033242Z_cd067b22: attach, no-index, failing-explore, opt-out, once-per-session, synthetic-never-builds); typecheck exit 0 (20261015T033348Z_ff721239). <!-- sv: once-per-session 0.6, review-fix 0.4 -->

## Smoke Tests

Prediction (T2–T5, closed): both suites RED before the modules exist (import failure IS the current behaviour —
no gate); after implementation green. Controls predicted to PASS before the gate exists and stay
PASS after: `read_bytes`/`'rb'`/readFileSync-without-utf8 over a doc runs; a scanner call after
`noteToolCall(codegraph…)` runs; a scanner call in a worktree without `.codegraph/` runs. The
refusal is visible in the tool part (status error), never swallowed. Mutation control: dropping
the once-only latch (`refused` flag) makes the SECOND scanner call refuse too — the suite must
catch it.

Prediction (T6, open): the pre-build test is RED on current behaviour — the opening turn carries
NO graph-context part. Controls: a worktree WITHOUT `.codegraph/` attaches nothing (the tmpdir
fixtures are the natural control); a FAILING explore (the harness's default MCP mock refuses
callTool) leaves the turn proceeding — the assistant reply still arrives, a warning is logged,
no part appears; the opt-out env attaches nothing. After implementation the `.codegraph/` +
mocked-explore case attaches exactly one synthetic part carrying the graph text, and the
graph-first latch reads the session as codegraph-aware (a scanner call runs freely right after).

Residuals named, not built: the `run` tool (argv form) does not carry the doc gate — the brief
scoped bash/cmd; a python script FILE that reads docs internally is invisible to a text
heuristic; the latch is in-memory (a restart re-arms the once-refusal — a cheap nudge, by
design).

```yaml
Keywords: turn-start-prebuild 0.35, graph-first 0.30, docs-are-read 0.20, once-only-latch 0.15
Semantic dominant: Хост сам строит граф на старте задачи и кладёт его в ход до первого тула; сканер без графа и питон над докой отказываются один раз с маршрутом.
md5: b83e4f26a17c95d0e8b64f21c3a97d58
prev-md5: f45a2c11b8e94d07a3c65f10d2b84e97
parent-goal-md5: 617f4b0ae28149d0a8c369bec5724f13
```
