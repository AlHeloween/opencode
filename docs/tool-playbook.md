# Tool playbook — pick by the LAYER of the question, then pay once

Written 2026-09-21 after a day in which the tools were all present and were still
used the old way. Every anti-pattern below is MEASURED from that day's own trace,
not hypothesised.

## The one rule

**Choose the instrument by the layer the question lives on, not by what is nearest.**
The adjacent layer returns accurate data about a different process — the costliest
error there is, because right numbers end the search. This is `G1`'s rule; this file
is the concrete routing table for it.

## Task → instrument → the trap it replaces

| The question | The instrument | The trap it replaces |
|---|---|---|
| Where is a file / what is in a directory | `glob`, `list` | shell `ls`/`dir` (blocked). Both search EVERYTHING by default — no ignore rule is applied, so an absence is real; pass `gitignore: true` for the quiet shape, or use `git ls-files` |
| Read a file | `read` (whole) | windowed peeks of a small file |
| A file PLUS what depends on it | `codegraph_node` (file mode) | `read` then a separate grep for importers |
| Who calls X / radius of changing X | `codegraph` (callers / impact / explore) | three `grep`s on one area, or a `grep` whose PATTERN is a symbol name — the pattern's shape does not decide the layer |
| Does this exact string occur | `grep` | codegraph for a string search |
| A long, interactive or crash-prone command | `cmd_runner start` → `wait` → **read the run dir** | bare `start` (hangs the TUI); `tail` for the verdict |
| What did a run actually do | `<run>/state.json` (status, exit_code, bytes_written, bytes_dropped, truncated) + the WHOLE `<run>/stdout_text.log` | `tail` — it shows the last lines, so a crash banner HIDES the failure inventory |
| What is the runtime saying | `logsearch`, `dbread` | hand-grepping log files |
| My own identity, permissions, context fill | `checkstate` | inferring them, or trusting a stale tail notice |
| What was said earlier | `messagesearch` → `sessionread` | re-reading the archive; summaries are Inferred handles, not Exact |
| **How much is owed, and which plans sit in the wrong terminal** | **`planstatus`** (pass `reconcile:true` to move the misplaced ones) | re-deriving the tick counts by hand. The `owed:` line in `<compaction-status>` says HOW MUCH is owed; this says WHERE it sits, what is misplaced, and the full debt. It reads `plans/` and `plans_completed/` only — the other three terminals are invisible BY DESIGN, so deferred/future/paused work counts as neither debt nor completion |
| A tool result that was released | `recall(id, range, pattern)` | re-running the tool (re-applies side effects; a `task` result cannot be reproduced) |
| A heavy result I still need | `tempenable(id, turns)` | re-fetching it every turn |
| A bounded sub-task with a checkable output | `task` (explorer for G1/G6, coder for G7/G8, general for G2/G3) | doing it in the main window and paying for its discovery |
| A verdict about MY OWN plan, no smoke available | `aicall` on a cheap model, packet complete | self-grading — agreement between two simulators is not evidence |
| A visual / TUI claim | `cmd_runner` inbox render, or `cua` `screenshot`/`verify_state` | typecheck as an oracle, or a screenshot that crops the object |
| A **write** claim | read the WRITTEN ARTIFACT back | exit code, typecheck, or the writer's own report |
| Editing source | `edit` / `multiedit` (read first), `applypatch` for a multi-file atomic change | `write` over an existing file |
| Undoing an edit | `restore` (session `.bak`) | reconstructing the old text by hand |
| A value across history | `fossilgrep` | grepping only the working tree |
| Something the next cycle must not re-derive | `memory` — criteria and state only | writing a session report into memory (it rides the fold verbatim) |
| A fold at a closed boundary | `compact` (with its reason) | letting the window fill and folding mid-task |

## Three habits that pay for themselves

1. **Measure before you window.** Read the size first and prefer ONE whole read.
   Measured: a 945-second full-suite run wrote a **40 652-byte** log
   (`bytes_dropped: 0`). Three `tail` calls showed less than one `read` would have,
   and each cost the same. A window is for an object that is genuinely huge.
2. **Every absence probe needs a POSITIVE CONTROL.** An instrument that cannot find
   something known-present cannot report an absence. Two measured failures of this:
   `findstr` on the compiled binary (Bun COMPRESSES embedded assets, so the probe
   could not see the kernel text at all — its "not found" was a verdict on the
   instrument); and `list` on a gitignored path (declared `bin/` empty while
   `bin/opencode.exe` was there).
3. **Persist the READER, not the reading.** When the same reading will recur (scan a
   run log, classify its failures), write the reader ONCE into
   `experiments/<ISO-date>_<name>/` and reason from its OUTPUT as a report. The
   report is then the object under discussion, and the next cycle re-runs one command
   instead of re-deriving the whole read.

## Anti-patterns, each measured on 2026-09-21

- **`tail` for a verdict.** The end of a crashed run's log is the crash banner; the
  inventory is above it. Wrong instrument for the question.
- **`findstr` on a compiled binary.** Failed its own positive control (compressed
  asset) — see habit 2.
- **`list` to prove absence.** `.gitignore` hides the answer.
- **A `grep` for a CONNECTION.** Symbol names in a regex do not make it a text
  question; the earlier measurement was 30+ `grep` against 4 `codegraph`, and the
  cost was a change radius that was never computed.
- **A red reported without a class.** Of 23 failures in that run, **13 were the 5 s
  default on a loaded machine** (`measured 5.4–8.1 s`) and only 10 were semantic.
  Unclassified, all 23 read alike.
- **Grepping a 40 KB log by hand** when `state.json` already carries `bytes_written`,
  `bytes_dropped` and `truncated`, and the whole file is one `read`.
- **Re-deriving what state already holds.** `dbread` / `checkstate` / `state.json`
  answer questions nobody thought to ask; a log only answers the ones pre-placed.

## Kernel binding

- `G8 RUN_ARTIFACT_FIRST` — installed 2026-09-21 (kernel `001214d4…`): a run reports
  itself through its own state and whole log; an oracle that cannot print its own
  verdict is not an oracle.
- Candidate, NOT yet added (decide against `@INSTRUMENT_RUNG` first, to avoid saying
  the same thing twice): a `G1` line for habit 1 and habit 2 — measure the object
  before choosing a window, and a probe that cannot fail is not a probe.
