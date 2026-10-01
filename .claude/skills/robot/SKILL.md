---
name: robot
description: Dispatch a bounded plan task to the opencode robot (`dist\bin\opencode.exe run`, headless) so Claude only frames and verifies — the robot carries the execution tail, Claude's window stays small and the cycle count drops. Use when a plan task has a concrete binding (paths, oracle) and needs no owner decision mid-run. Claude writes the brief, launches, reads back the final message + git diff, and runs the oracle ITSELF. Never bin/, never --dangerously-skip-permissions; real work on the funded pair (GLM-5.3-Flash-BF16 on HF, DeepSeek V4.1 Flash), free models only for plumbing.
---

# robot — delegate execution, keep the verdict

- sv: { keywords: { robot-dispatch 0.35, brief-contract 0.25, own-oracle 0.25, free-model 0.15 },
        dominant: "Claude hands one bounded, oracle-bound task to the headless opencode robot and verifies the result itself." }
- plan: `plans/2026-09-30_robot-delegation-and-orchestration.md` (stages S1–S4; this skill is its Claude half)
- status: WRITTEN 2026-09-30, **not yet smoke-tested** — every «open» line below is measured on the first run

## Why

Owner, 2026-09-30: «робот … значительно снизит нагрузку и количество циклов». Claude pays per token of the
execution tail it carries (tool output, diffs, retries); the robot runs on cheap flash models and its
tail never enters this window. What comes back is one final message and a diff — Claude's cost is the brief
and the oracle. This is also the second form of consolidation (plans/futures/2026-09-29_mission-runtime…
§ Consolidation): the working state lives in the robot's session, only the verified result enters ours.

## Grounded (read 2026-09-30)

- `run [message..]` options (`packages/opencode/src/cli/cmd/run.ts:209-282`): `--model provider/model`,
  `--agent`, `--format json`, `--file`, `--title`, `--dir`, `--session`, `--continue`, `--fork`, `--variant`,
  `--attach`. ✓ Read.
- `--format json` writes one JSON object per line: `{type, timestamp, sessionID, …}` with types `tool_use`,
  `step_start`, `step_finish`, `text`, `reasoning`, `error` (`run.ts:411-415`, 470-511). ✓ Read.
- Headless permission asks are AUTO-REJECTED (`run.ts:523-541`); the notice goes through the UI printer, so
  in json mode a rejection may be visible only as a failing `tool_use`. ✓ Read / ✗ not run.
- Exit code = setup errors only (`process.exit(1)` at 301/313/331/336/613/619), never task acceptance. ✓ Read.
- Launch point: `D:\zPython\opencode\dist\bin\opencode.exe` (next to `opentui.dll`); `bin\` is the owner's
  live runtime and forbidden. ✓ ls.
- Zen free models answer only from INSIDE opencode (aicall skill, measured 2026-09-27: 403 `FreeTierError`
  from outside) — so the robot reaches free models Claude's own falsifier cannot. The catalog lists many
  (`src/provider/models/opencode.json`: `deepseek-v4-flash-free`, `glm-5-free`, `kimi-k2.5-free`, …);
  which are LIVE today is **open**.

## The brief (a file, never a quoted shell string)

Write it to `experiments/<ISO-date>_robot-<task>/brief.md`:

0. **Address** — the brief opens by naming the robot: «Smit, software architect: …» — spelled **Smit**, not Smith, as in `d:\!Smit\Smit2` (owner, 2026-10-01:
   «называй его Смит. Так он будет лучше помнить что он software architect»). The name is a role anchor —
   frame, decompose, verify — not decoration.
1. **Intention** — the plan's `<!-- intention: … -->` line, verbatim.
2. **Task** — plan path + task id, and the sv of THIS task (@SV_FORMAT, its own, not the turn's).
3. **Binding** — the exact paths/symbols it may touch; everything else is read-only.
4. **Oracle** — the command that decides, and its falsifier. **Withhold the expected result** (DELEGATION:
   send for test, not verdict). Claude's own prediction is written in the plan BEFORE launch (@SMOKE_BEFORE).
5. **Rules** — do not commit; do not touch `bin/`; if a permission is refused, STOP and report which one —
   never route around it; finish with a final message: what changed (paths), what ran (command + exit),
   what is unresolved.

## Launch

```bash
tools/cmd_runner.exe start --cwd D:/zPython/opencode --timeout-s 1800 --raw --no-tail -- \
  D:/zPython/opencode/dist/bin/opencode.exe run "Follow the attached brief exactly." --dir D:/zPython/opencode \
  --model opencode/<free-model> --agent build --format json --title "<plan>:<task>" \
  --file experiments/<dir>/brief.md
```

- ✗ → ✓ (measured 2026-10-01, run `20260930T234022Z_dedc9a8e`): the MESSAGE goes BEFORE `--file`. `--file` is an
  array option and swallows a trailing positional — the run fails `File not found: <message>`.
- ✗ (measured 2026-10-01): `--format json` may print only `step_start` while the DB holds the full reply. A
  silent stream is not an empty reply — read the turn from `.opencode/data/opencode.db` (`part` by `message_id`).
- ✗ (measured 2026-10-01, run `20260930T234231Z_82d53c38`): a run continued with `--session` on a session the
  owner also has open in the TUI stalled after a tool result until the timeout. The same stall then
  reproduced in FRESH sessions with no TUI running (runs `20261001T001049Z_7d682c7e`,
  `20261001T001539Z_cf6c38f9`, and with `snapshot:false` `20261001T001913Z_5873e037`) — so the TUI is not the
  cause; Unknown, last seen in the gateway stream path (owner's zone).
- **The bridge to a session the owner has open is the SERVER, not a second process.** Without `--attach`,
  `run` boots its own server and writes the same session DB as the owner's TUI — two writers. When the owner
  starts the TUI with `--port <N>`, continue the owner's session with `run --attach http://127.0.0.1:<N> --session
  <id> …` (or `POST /session/:id/prompt_async`) and read state from the API — never by driving the TUI
  through cmd_runner (owner, 2026-10-01: «через cmd_runner — это как операция на гланды через анус»).
  The verified recipe lives in ONE place: skill **`opencode-bridge`** (`.claude/skills/opencode-bridge/SKILL.md`).

- cmd_runner gives the timeout (plan B8) and a run dir with `state.json`; `--raw` = clean stdout but
  all-or-nothing (memory `reference_cmd_runner_raw_buffers`) — read it after `cmd_runner wait <id>`.
- **Models (owner, 2026-09-30: «для реального workflow бесплатные модели не вариант»).** Real work runs on
  the funded pair, once the HF + DeepSeek balance has landed (~2026-10-01 — read the balance, never assume
  it): `huggingface/zai-org/GLM-5.3-Flash-BF16` and `deepseek/deepseek-flash` (catalog name «DeepSeek V4.1
  Flash»; `deepseek-v4-flash` is the V4 entry). **Long runs (automode, AGI cycles) default to GLM-5.3-Flash-BF16**
  — owner: «модель просто идеальная для долгих забегов»; on an HF Pro account it is cheaper but still billed,
  so read the HF balance before and after a long run and record the spend in the run's log entry. Free Zen
  models only for plumbing smokes. Space Bunny
  (MiniMax 3) is under evaluation, not a default. Any other paid model: explicit yes to paying (memory
  `feedback-your-choice-is-not-consent-to-pay`). Open: the HF catalog entry has no `cost`, so its spend is
  not metered from the catalog.
- Continue the same robot session with `--session <sessionID>` (from any json line), never a fresh one.

## Read back — the only things that enter Claude's window

1. `state.json` of the run (status, exit, bytes written/dropped) — a silent run is UNKNOWN, never green.
2. The LAST `text` event (the final message) and every `error` event; count `tool_use` with status `error`.
3. `git status --short` + `git diff --stat`, then the diff of the bound paths only — a hunk outside the
   binding is off-direction: revert it or justify it.
4. **Run the oracle yourself.** The robot's report is testimony; its green is not ours.

Then: box + `_progress_log.md` entry + one commit that names the plan (Claude is the one committer).

## Never

- `bin/` (edits, copies, launches — AGENTS forbidden_actions).
- `--dangerously-skip-permissions` — it approves everything not denied; the unattended envelope is plan B7.
- Two robot tasks on overlapping paths in one tree (kernel G7: two in flight share one oracle).
- A paid model outside the funded pair without an explicit yes.

## Open — measure on the first run (plan S1), then rewrite this section as facts

- Which tools ask under the default permission config headless (config is executable-adjacent, none tracked).
- Which free Zen models are live, and whether `opencode/<id>` is the right `--model` spelling.
- Whether a rejected ask shows up in the json stream, and how the robot reacts to it.
- The AGI/automode route (TUI in cmd_runner, `/automode` via `cmd_runner send`) — plan S1, not this skill.
