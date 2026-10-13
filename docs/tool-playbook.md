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
| A long, interactive, crash-prone or unknown (freshly built) command | `cmd_runner start` → `wait` → **read the run dir** | bare `start` (hangs the TUI); `tail` for the verdict |
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
| Editing source | `edit` (read first; it takes the whole batch itself) | `write` over an existing file |
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

## Moved from AGENTS.md (2026-10-13)

### The no-script constraint (owner, 2026-09-22 / 2026-09-29)

- **Never edit source with a direct, UNVERIFIABLE script — and before the edit, ask codegraph what it touches.** Source
  changes go through `edit` / `write`, by hand, and the hand is informed: call
  `codegraph` (impact / explore) FIRST to confirm the blast radius, so the change is bounded by
  evidence and not by the two files the author happened to have open. After the edit the oracle
  answers the same question with runtime evidence — the two are not interchangeable, and neither
  replaces the other. Owner, 2026-09-22, verbatim: «Руками блин.», «Добавь в agents.md - никогда не
  редактируй код скриптами.», «Более того перед правкой надо вызывать codegraph чтобы подтвердить
  что ничего не полетело это тоже в agents.md.» A script that rewrites source carries its own anchors,
  computes its own diff and reports its own success: nobody reads the seam, a stale anchor is
  indistinguishable from a fresh one, and the read-before-edit that makes a change reviewable never
  happens. Measured the same day, which is where the rule comes from: a 75-line `cut.py` removed ~400
  lines of dead sidecar machinery by anchor and saved nothing — the seam still had to be re-read by
  hand afterwards, while the edit itself had been withheld from review in the meantime. The second
  precedent, and the one that shows what «unverifiable» costs: an agent wrote Python scripts to rewrite
  source — no syntax check before the write, no backup — corrupted the files and recovered by rolling
  back from git, which returns the WHOLE file to the last commit and takes every uncommitted change in it
  along (owner, 2026-09-29). Scripts stay
  for READING and MEASURING (a probe over the DB, a log analysis) — never for writing source.
  **ADM update descriptors are NOT scripts in this sense** (owner, 2026-09-29, verbatim: «запрещает
  редактирование исходников прямыми unverifable скриптами, adm — это другое»). An `updates/*.xml`
  descriptor (`D:\zPython\ADID_Python\updates\` is the corpus; `src/adm/` the engine) answers each
  objection above by construction: every payload is an `<update_md5_…>` block carrying its own md5 and
  size, and the md5 IS the tag name (`<update_md5_<hash>>…<content_md5_<hash>>…</content_md5_<hash>>`); the
  parser locates the payload by those raw open/close tokens, not by XML escaping
  (`src/adm/manager_methods/_stream_md5_wrapped_updates.py:113`), and an unclosed block, a duplicate content
  block or content outside an update raises (same file, lines 44/64/67/76 — read in code, not run).
  **Measured 2026-09-30 on adm 5.0.6** (`experiments/2026-09-30_adm-binary-smoke/`, both runs): the md5 is
  a change detector FOR THE REPORT, by design (owner: «это для отчёта»), not a refusal — `--apply`
  re-stamps the descriptor before parsing (`apply_descriptor.py:20-22`), a payload altered after stamping
  is applied, and `--dry-run` shows the mismatch («MD5=auto-corrected, expected … actual …»). The gap: the
  NON-dry-run report does not show it («MD5 match … no adjustments required»), so read the dry-run audit
  when the question is «was this descriptor touched». The PROCESS itself, run on an existing file: a missed
  `<find_text>` anchor aborts with the target untouched (✓); apply writes a `.baseline`, a timestamped
  backup, an in-file `ADID_ROLLBACK` block (backup/new hash, goal_id, semantics, restore command), a
  `<file>.adid.log.jsonl` ledger and the integrity report (✓); `--list-diff` shows the hunk with the
  semantics as its `Reason` (✓); `--replay-updates` prints the intent AND a semantic vector per mutation
  with an MD5 chain (✓); `--rollback` restored the file byte-identical and re-verified its hash (✓). Raw bytes between the tags: the descriptor is read as
  strict UTF-8, so a byte ≥ 0x80 fails loudly with `UnicodeDecodeError` and nothing is written (✓ safe, but
  only UTF-8-valid content passes raw). And the `binary-overwrite` template's base64 path wrote the base64
  TEXT itself (388 B) instead of the 291 decoded bytes — md5/size are computed over the text, not «on decoded
  bytes» as the template says (✗, an ADM defect to fix in `ADID_Python`); a `replace` names its exact anchor
  in `<find_text>`, so a moved anchor fails instead of landing elsewhere; `<semantics>` states the intent
  in the descriptor itself; `adm --apply` writes atomically with a baseline snapshot, rotating backups, a
  rollback block and a ledger entry, and `adm --rollback <file>` restores and RE-VERIFIES; the edit is
  never withheld from review — `adm --replay-updates [--unified-diff]` shows the intent and the exact
  hunks, `adm --list-diff <file> N` the history of one file, and `--rag` indexes the descriptors as exact
  history records keyed by `goal_id` + `target_file` (`src/adm/rag/adid_history.py`). The requirement
  that does NOT go away: the descriptor is authored after reading the code and asking codegraph what it
  touches — a verifiable mutation of the wrong thing is still the wrong thing.

### The search-instrument rule's owner statement (2026-10-10)

**A symbol, a caller or an impact question is a GRAPH question. `grep` answers a different one — «does this text occur» — and a lexical answer presented as a structural one is an UNGROUNDED claim, which is exactly where fabrication starts.** Owner, 2026-10-10, verbatim: «народ в последнее время слишком налегает на греп без codegraph это очень криво потому что codegraph хоть какой-то нечеткий поиск дает, glob, list - ладно нашли файлы, но грепить без графа - ну как бы несколько странновато не находишь?» — and on the price: a model that «самоотмазался грепом от граундинга и потом когда надо было зен проверить как работает просто начал фантазировать».
