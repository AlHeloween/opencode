# Robot host stop check — k2 mechanism (a turn may not END on an offer or a hand-off)

<!-- intention: a primary-agent turn in opencode may finish on a prose question/offer to the owner («Хотите, поищу…?», «Want me to…?») or by handing him an action after one failed route -> the runtime continues that turn ONCE with a synthetic message carrying the reason; a real owner decision goes through the `question` tool; never twice in a row; never for sub-agents; env switch disables -->

<!-- goal_sv: stop-check, no-offer-stop, turn-continuation, k2-kernel-bug, question-tool-exemption -->

- **plan_id:** 2026-10-13_robot-host-stop-check
- **revision:** 1
- **state:** DRAFT
- **reported:** owner, 2026-10-13: «в кернеле критический баг. Он позволяет не доделывать работу»; the same day's decision after the audit (`experiments/2026-10-13_kernel-exit-audit/REPORT.md`): «Механизм + 2 строки» — the mechanism on the robots' host FIRST, kernel text (t37) is a separate task and `prompt_kernel/**` is NOT touched here.
- **why it matters:** measured twice on this host — log row 40 (turn ended on «Хотите, поищу такие ссылки …?» for work the request covered; the owner had to answer «установи … но вообще ты это должен был сделать сам») and row 44 (one route failed, `cmd_runner` WinError 5, and the owner was handed the launch that the Terminal panel performed at the first try minutes later). On the Claude host this class is closed by a Stop hook; the robots' host has no equivalent.

```yaml
Keywords: stop-check 0.30, turn-continuation 0.22, no-offer-stop 0.20, k2-kernel-bug 0.16, question-tool-exemption 0.12
Semantic dominant: Continue a primary-agent turn once, with a synthetic reason message, when its final text ends on a prose question/offer to the owner or hands him an action.
md5: 8f3c1d6a29b47e05c8d4f1a6b3e90725
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Evidence (each line carries its instrument)

- ✓ **The hook point — where a completed, tool-free turn leaves the loop.** `packages/opencode/src/session/prompt.ts:1695` (`while (true)` — `runLoop`, opened `:1569`); the exit is the loop-head check at `:1794-1803`: `SessionCompaction.isAssistantTurnComplete(lastAssistantMsg) && !hasToolCalls && lastUser.id < lastAssistant!.id && !summaryAttempt` → `slog.info("exiting loop")` → `break`. A normal clean completion (`finish` set, no tool parts, no error) returns `"continue"` from the step effect (`:2553-2557`, `:2912`) and exits HERE on the next iteration; `result === "stop"` is reserved for blocked/errored turns and breaks at `:2813` — a different path, untouched.
- ✓ **The reference implementation** `C:\Users\Alexander\.claude\hooks\no_offer_stop.py` (read 2026-10-13): detector 1 `ends_on_question` (strip a trailing ```` ```yaml … Keywords: … ``` ```` block, last paragraph ends on `?`), detector 2 `hands_off` (drop fenced code, drop `«…»`, `"…"`, `` `…` `` quoted spans, then the RU/EN regex); `stop_hook_active` = never blocks twice in a row; real decisions go through the AskUserQuestion tool, which the hook never blocks. Claude-host fixtures: case B 6/6 (REPORT.md:74), case A 4/4 (REPORT.md:66, log row 44).
- ✓ **Our `question` tool is the AskUserQuestion equivalent.** `src/tool/question.ts:15` — `Tool.define("question", …)`; tool parts store `tool: "question"`; a call makes `finish = "tool-calls"` and the loop continues rather than exiting.
- ✓ **Primary identities** (sub-agent sessions excluded by this predicate): `src/session/mode-identity.ts:26-29` — `build_mode` / `plan_mode` / `reasoning_mode` (aliases handled by `canonicalIdentity`).
- ✓ **Synthetic, model-visible user message — the existing pattern.** `compaction.ts:2931-2946` (message* injection: `sessions.updateMessage({role:"user", agent, model, time})` + a `synthetic: true` text part). Model visibility: `message-v2.ts:1475-1480` — only `ignored` parts are skipped; `synthetic` parts ride to the model. `TextPart.metadata` exists (`message-v2.ts:157`) → the "never twice" latch lives there, not in prose.
- ✓ **Ordering and re-discovery:** `Identifier.ascending` is monotonic (`src/id/id.ts:61-70`), so the injected id sorts after the assistant message; the loop's cache fast-path picks it up via `MessageV2.messagesSince` (`message-v2.ts:1891-1904`, `id > after`, ascending).
- ✓ **Env opt-out convention to mirror:** `src/config/codegraph-mcp-auto.ts:45-48` (`0 | false | off | no`).
- ✓ **KV constraint:** the injection is a NEW message in the tail; no byte of the system prefix changes (checkpoint save happens in the step effect, `prompt.ts:2839-2912`).
- ✓ **The loop e2e harness for the oracle:** `test/session/prompt.test.ts` — `it = testEffect(makeHttp())` (`:266`), `provideTmpdirServer` + `TestLLMServer` (`test/lib/llm-server.ts`; `llm.text()` queues one finish=stop reply).

## Acceptance frame (named BEFORE the work)

| # | Criterion | Surface | Instrument | Falsifier |
|---|---|---|---|---|
| A1 | A primary-agent turn ending on a prose question runs ONE more step whose parent is a synthetic message carrying the reason | `runLoop` loop head, `prompt.ts:1794` | new `prompt.test.ts` case: 2 queued replies, `llm.hits` = 2, session contains the synthetic message | `llm.hits` = 1 or 3, or no synthetic message |
| A2 | Never twice in a row | same | new case: reply 1 and reply 2 both end on a question → hits = 2, final text = reply 2 | hits = 3 |
| A3 | A hand-off ("Запусти …"/"you need to run …") is continued the same way | same | new case (one reply pair) | hits = 1 |
| A4 | Quoted spans, fences and the SV block are citations, not detections; sub-agent / question-tool / switch-off turns are never blocked | `src/session/stop-check.ts` | `test/session/stop-check.test.ts` (pure) + differential run of `prompt.test.ts` with `OPENCODE_STOP_CHECK=0` | any case fires on noise, or the differential run stays green |

## Tasks

- [x] **T1 — tests first (pure).** `test/session/stop-check.test.ts`: the reference's own cases (question tail, handoff regex, quoted/«…»/fenced citations, SV yaml block stripped, emphasis-closer `?` variants) plus the decision table (disabled env, sub-agent, already-continued, question-tool-called). RED before any module exists. ✓ 2026-10-13 — RED on the untouched tree: run `20261013T151834Z_19c6f90e` (exit 1, 0 pass / 1 fail: `Cannot find module '../../src/session/stop-check'`); GREEN after T2: run `20261013T151923Z_c8e0b28f` (23/0, exit 0), re-run post-wiring `20261013T152715Z_d4b44194` (23/0).
- [x] **T2 — the module.** `src/session/stop-check.ts`: `endsOnQuestion`, `handsOff` (same detectors as the reference), `stopCheckDisabled(env)`, `stopCheckDecision({text, agent, alreadyContinued, questionToolCalled, env?})` returning `{kind, reason}` or `undefined`. Module doc names the reference file and k2. ✓ 2026-10-13 — PARITY IS EXACT: the probe `experiments/2026-10-13_robot-host-stop-check/` ran the Claude host's OWN `ends_on_question`/`hands_off` (imported from the hook file) and our module over 24 shared cases: **24 cases, 0 mismatches** (run `20261013T152045Z_4be4139a`, exit 0).
- [x] **T3 — wire `prompt.ts`.** At the loop-head exit (`:1794-1803`): when the decision fires, insert the synthetic continuation message (role user, same `agent`/`model` as `lastUser`, text part `synthetic: true`, `metadata.stop_check = kind`), log `stop-check continuation`, and `continue`; otherwise the existing `exiting loop` break. Assembly is inline and linear: tail text = non-ignored text parts of `lastAssistantMsg`; `alreadyContinued` = `lastUser` carries a part with `metadata.stop_check`; `questionToolCalled` = any assistant message with `parentID === lastUser.id` has a `question` tool part. ✓ 2026-10-13 — the branch is the loop-head exit only (1801-1845 after the edit, import at `:134`); filtered loop run `20261013T152221Z_00186909` (3/0, exit 0).
- [x] **T4 — loop-level tests.** `test/session/prompt.test.ts`: A1, A2 and A3 cases (queued replies in the file's own `provideTmpdirServer` harness), asserting `llm.hits`, the injected message's presence/shape (`synthetic`, metadata latch, parent of the final assistant message), and the final text. ✓ 2026-10-13 — the three cases at `prompt.test.ts:2439-2541`; whole file `20261013T152246Z_a60f4378` **47 pass / 13 skip / 0 fail** against the S2 baseline 44/13/0 (the 13 skips are the file's own win32-gated `unix` cases).
- [x] **T5 — verification.** `bun typecheck` (exit 0); the whole `test/session/prompt.test.ts` file green; the differential run with `OPENCODE_STOP_CHECK=0` — the stop-check cases go RED, everything else stays green (this doubles as the env-switch oracle). ✓ 2026-10-13 — typecheck `20261013T152146Z_616353e1` exit 0; whole file `20261013T152246Z_a60f4378` 47/13/0; DIFFERENTIAL `20261013T152430Z_d1c50ec0` exit 1 — 44 pass / 13 skip / **3 fail, exactly the three new cases** (each `hits` 1 instead of 2), every other case identical to S2; proportional regression `test/session/compaction.test.ts` `20261013T152656Z_f49e81d2` 91/0. The branch is inert for every other fixture in the tree (grep over `test/**`: only these three replies end on `?`).
- [x] **T6 — records.** `docs/architecture.md` (dated section + Key Files), `agi_workout/` entry, `_progress_log.md` entry, `svm render` from the repo root, one commit naming this plan, `_build.ps1` through `cmd_runner` with `state.json` read. ✓ 2026-10-13 — `docs/architecture.md` §8d + the `session/stop-check.ts` row in §9; `agi_workout/2026-10-13_robot-host-stop-check.md`; `_progress_log.md` entry; `svm render` put this plan on `plans/MASTER_PLAN.md`; `_build.ps1` green (run `20261013T152810Z_479fe21a`, exit 0, v10.0.1318, its own smoke test passed, artifacts in `dist/` — `bin/` untouched); commit names this plan (hash in the session report).

## Smoke Tests

| # | Instrument | Prediction BEFORE the run |
|---|---|---|
| S1 baseline | `cmd_runner start --cwd packages/opencode -- bun test test/session/stop-check.test.ts` on UNCHANGED tree | FAIL — module does not exist (the red of "tests first") |
| S2 baseline loop file | `bun test test/session/prompt.test.ts` on unchanged tree | PASS — the file is green today; recorded as the comparison base for T3 |
| S3 after T2+T3 | same two files | PASS; the new cases fail if either detector, the latch or the exemption is compiled out |
| S4 differential | `cmd /c "set OPENCODE_STOP_CHECK=0&& bun test test/session/prompt.test.ts"` | the three new loop cases FAIL, every other case keeps its S2 result — the switch and the sensitivity of the tests, in one run |
| S5 typecheck | `bun typecheck` from `packages/opencode` | exit 0 |
| S6 build | `pwsh -NoProfile -File _build.ps1` through `cmd_runner`, `state.json` read | exit 0; the candidate lands in `dist/`, `bin/` untouched |

A full `bun test` is forbidden (AGENTS) — always a named file, one file per cmd_runner call.

### Smoke results (actual, 2026-10-13)

| # | Run | Result |
|---|---|---|
| S1 | `20261013T151834Z_19c6f90e` | exit 1 — 0 pass / 1 fail, `Cannot find module '../../src/session/stop-check'` (the required RED) |
| S2 | `20261013T151851Z_8ff21709` | exit 0 — 44 pass / 13 skip / 0 fail [130.5s] |
| S3a pure | `20261013T151923Z_c8e0b28f`, re-run `20261013T152715Z_d4b44194` | 23 pass / 0 fail both times |
| S3b filtered loop | `20261013T152221Z_00186909` | 3 pass / 0 fail (the three new cases) |
| S4 whole loop file | `20261013T152246Z_a60f4378` | exit 0 — 47 pass / 13 skip / 0 fail [95.7s] = S2 + 3 |
| S4b differential, switch OFF | `20261013T152430Z_d1c50ec0` | exit 1 — 44 pass / 13 skip / **3 fail, exactly the new cases** (`hits` 1 instead of 2) |
| S4c proportional, compaction | `20261013T152656Z_f49e81d2` | 91 pass / 0 fail |
| S5 typecheck | `20261013T152146Z_616353e1` | exit 0 |
| S6 build | `20261013T152810Z_479fe21a` | exit 0 — v10.0.1318, smoke `--version` + `reasoning_prompt.txt embedded` passed |
| Detector parity (extra) | `20261013T152045Z_4be4139a` | 24/24 cases identical to the Claude host's own hook functions |

## Residuals (open)

- **R1 — the parity probe is not archived to `experiments_history/`.** The repo's archiver (`experiments/2026-09-13_experiments-canon/archive.cjs`) is tree-wide and a dry-run showed it would move 2 487 files, most of them OTHER robots' experiment trees in this shared checkout — out of this task's envelope. The probe lives in gitignored `experiments/2026-10-13_robot-host-stop-check/`; its cases are carried by the committed `stop-check.test.ts`, so the evidence that matters is tracked.
- **R2 — no live model run** (a real provider session where a model actually ends a turn on an offer and the runtime continues it). Claimed layer: the real `runLoop` + real processor + real DB in `prompt.test.ts` — a provider adds the wire half, not the decision half.
- **R3 — the `question`-tool exemption is proven at the decision layer only** (`stop-check.test.ts`); a loop-level case needs a live answer to `question.ask`, which the harness does not drive. Same for the sub-agent exemption (pure layer; the loop-level proof would need a full `task` child turn).
- **R4 — kernel text (t37) untouched by design**: cases A/B's kernel wording (`source.py:157`, `:448`) is the separate task the owner named; this plan is the mechanism half only.

## Envelope (G4)

- action classes: READ (grounding), PLAN_WRITE (`plans/`, `agi_workout/`, `_progress_log.md`), MODIFY_PROJECT (`packages/opencode/src/session/stop-check.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/test/session/`, `docs/`).
- prohibitions: `prompt_kernel/**` (t37 — separate task), `bin/`, `git add -A`, `--no-verify`, full `bun test`, branch/worktree changes.
- branch: `Local_Development`, same tree (two other robots work on disjoint paths).

## Out of scope

Kernel text (`source.py:157`, `:448` fixes — REPORT.md §6, task t37); case C/D kernel clauses; the Claude-host hook (already built).

## Rollback

`git revert` of the commit; the mechanism is additive (one decision function + one branch at the loop head) and persists nothing new beyond one synthetic message per firing.
