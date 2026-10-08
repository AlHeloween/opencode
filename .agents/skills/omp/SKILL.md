---
name: omp
description: Dispatch a bounded plan task to oh-my-pi (`omp`, D:\zPython\_coding_agents\omp.exe, v18.4.9) as a headless robot — the same contract as skill `robot` (Smit on opencode), on a second runtime — Codex writes the brief, launches `omp -p --mode json` with the per-run approval overlay `omp-robot.yml`, reads back only the final message + tool errors + git diff, and runs the oracle ITSELF. Use when a plan task has a concrete binding (paths, oracle) and needs no owner decision mid-run, or when the opencode bridge is not available. Never commit through it, never touch bin/, never --yolo/--auto-approve; real work on the funded pair (deepseek/deepseek-flash is the owner's omp default role).
---

# omp — the second robot runtime, same verdict rule

- sv: { keywords: { omp-dispatch 0.35, headless-print 0.20, approval-overlay 0.20, own-oracle 0.15, brief-contract 0.10 },
        dominant: "Codex hands one bounded, oracle-bound task to headless oh-my-pi and verifies the result itself." }
- sibling: skill `robot` (Smit on opencode) — the brief contract and the read-back rule are THAT skill's; this one
  only replaces the launch and the stream reader.
- status: smoke-tested 2026-10-02 (two runs, fixture `.temp/test/omp-smoke/`), see «Measured».

## Why a second runtime

`omp -p` is a working headless loop: a tool turn finishes and the process exits with a terminal `agent_end`
(measured below). The opencode headless `run` stalls after a tool result (skill `robot`, four runs 2026-10-01)
and needs the TUI-server bridge; `omp` needs nothing running. Same economics: the execution tail stays in the
robot's session, Codex's window gets one final message and a diff.

## Grounded (read 2026-10-02, source `D:\zPython\oh-my-pi\`)

- Launch flags: `docs/cli-reference.md` — `-p` (print/headless), `--mode json` (event stream), `--cwd`,
  `--max-time 10m`, `--model <provider/id>`, `--resume <id-prefix>`, `--config <overlay.yml>` (repeatable),
  `--no-title`, `--thinking <level>`, `@file` attaches a file to the message. ✓ Read.
- **Non-TTY stdin is read as the prompt** (`docs/cli-reference.md`, «Argument handling»): launched from a tool
  with stdin left open, `omp` waits for EOF forever (`phase: readPipedInput`, measured 2026-10-02 — killed after
  120 s). **Always `</dev/null`.** ✓ Measured.
- Approval: the built-in default `tools.approvalMode` is `yolo` (`docs/approval-mode.md`, «Modes»), and the owner's
  `~/.omp/agent/config.yml` sets no mode — so a bare `omp -p` approves EVERYTHING. The overlay `omp-robot.yml`
  narrows it: `write` mode, bash allowed, `eval` denied (it can spawn a shell `bash.patterns` never sees,
  `docs/approval-mode.md:72`), destructive git and `bin/` denied. ✓ Read.
- Headless prompt = fail CLOSED with a visible tool error
  (`packages/coding-agent/src/extensibility/extensions/wrapper.ts:307-322`); a `deny` is absolute in every mode.
  ✓ Read + measured.
- `--mode json`: first line is the session header `{type:"session", id, cwd}`, then events; `message_update`
  carries deltas only and the authoritative message is in `message_end`; terminal settle is `agent_end` with
  `isTerminal !== false` (`src/modes/print-mode.ts:62-97`, `docs/rpc.md` «agent_end»). ✓ Read.
- Context files: with `--cwd D:/zPython/opencode` omp reads the project rules itself (`docs/context-files.md`;
  owner config `commands.enableClaudeProject: true`). Which files it actually loads: **open**.

## The brief — skill `robot` § «The brief», verbatim contract

Write it to `experiments/<ISO-date>_omp-<task>/brief.md`: address («Smit, software architect: …» — the same role
anchor, a different runtime), intention line verbatim, task + its own sv, binding (paths it may touch), oracle +
falsifier with the expected result WITHHELD, rules (no commit, no `bin/`, a refused permission = STOP and report
which one, final message = changed paths + command/exit + unresolved).

## Launch

```bash
RUN=experiments/<ISO-date>_omp-<task>
omp -p --mode json --no-title --max-time 15m \
  --config D:/zPython/opencode/.Codex/skills/omp/omp-robot.yml \
  --cwd D:/zPython/opencode \
  "Follow the attached brief exactly." @$RUN/brief.md \
  </dev/null > $RUN/out.jsonl 2> $RUN/err.txt; echo "exit=$?" > $RUN/exit.txt
```

- Run it with `run_in_background: true` for anything longer than a smoke; `--max-time` is the bound, the
  background notification is the wake-up — no polling.
- Continue the SAME robot session: `--resume <session-id-prefix>` (the id is in the first line of `out.jsonl`
  and in the reader's output) — never a fresh session for a follow-up. ✓ measured: the resumed run recalled the
  previous turn's canary.
- **Models.** Default = the owner's omp role `default: deepseek/deepseek-flash:max` (funded, measured live).
  `--model huggingface/zai-org/GLM-5.3-Flash-BF16` for long runs is LISTED in `omp models find glm-5.3` — whether
  the HF credential is configured in omp is **open** (not called: paid). Any other paid model: explicit yes to
  paying (memory `feedback-your-choice-is-not-consent-to-pay`).

## Read back — the only things that enter Codex's window

```bash
python .Codex/skills/omp/read_run.py experiments/<ISO-date>_omp-<task>        # add --tools for every call
```

1. Reader exit 1 = no assistant message or no terminal `agent_end` → the run is UNKNOWN, never green. Also read
   `err.txt` and `exit.txt` (print-mode exit 0 = the turn completed, never task acceptance).
2. Every tool error is listed — a `blocked by tool policy` / `requires approval` line names the permission the
   brief told it to stop on.
3. `git status --short` + `git diff --stat`, then the diff of the bound paths only — a hunk outside the binding is
   off-direction: revert or justify.
4. **Run the oracle yourself.** The robot's report is testimony.

Then: box + `_progress_log.md` entry + one commit that names the plan (Codex is the one committer).

## Never

- `bin/` (edits, copies, launches) — AGENTS forbidden_actions; the overlay denies the bash route, Codex keeps the rule.
- `--yolo` / `--auto-approve` / `--approval-mode yolo`, or a run without `--config omp-robot.yml` — the built-in
  default is already yolo.
- Two robot tasks (omp or opencode) on overlapping paths in one tree.
- Reading the whole `out.jsonl` into the window — it is ~70 KB for a two-tool smoke (477 `message_update` deltas);
  the reader is the interface.

## Measured (2026-10-02, fixture `.temp/test/omp-smoke/`, session `01a0f979`)

| check | result |
|---|---|
| headless run, read tool, final message, terminal `agent_end` | ✓ exit 0, `read` returned the fixture's canary |
| `git commit` under the overlay | ✓ refused: `Tool "bash" is blocked by tool policy. Reason: Blocked by bash pattern: git commit*`; the robot reported it and did not route around |
| `--resume` continues the session | ✓ recalled the canary from the previous run |
| allowed bash (`git --version`) + `write` + read-back | ✓ all three ok, `note.txt` = `ok` (2 bytes, `od -c`) |
| cost | first run $0.0049 summed over assistant messages, deepseek/deepseek-flash |
| open stdin | ✗ hangs in `readPipedInput` until killed — hence `</dev/null` |

## Open — measure on the first real task, then rewrite as facts

- bash tool timeout is 60 s by default (`details.timeoutSeconds: 60` in the smoke): a longer oracle run inside the
  robot may need a setting — which one is not read yet.
- Which context files (AGENTS.md, AGENTS.md, `.Codex/skills/*`) omp loads with `--cwd` at the repo root.
- Whether omp's own subagents (`task` tool) and the advisor runtime inherit the overlay's denies.
