# Build and run — `_build.ps1`, `_run.cmd` from source, the full-suite measurement (moved from AGENTS.md, 2026-10-13)

The rules stay in AGENTS.md (§ Build after tests and changes, § Full package test suite); this file keeps the details and the measured history verbatim.

Owner, verbatim: «запуск _build.ps1 после тестов и изменений обязателен. Темп 80гиг это слишком.»

- **When:** after any test run and after any source change, before the work is reported done.
- **How:** `cmd_runner start -- pwsh -File _build.ps1` from the repo root (a build is crash-prone in the agent shell —
  § Shell Command Restrictions); read the run's own state file for the exit code, never a tail.
- **What it does** (read in `_build.ps1`, 2026-10-03 ✓): removes `.temp\test\` (lines 69-74, 131-136) — where test
  runs leave their scratch; clears `dist/` content except a running build's state (lines 143-158); builds and stages
  the candidate into `dist/` (`dist\bin\opencode.exe`). It writes **only** `dist/` and `.temp/` — never `bin/`;
  promotion into `bin/` stays the owner's act.
- **Why it is a rule:** the cleanup lives in the build, so a session that tests and never builds leaves its scratch
  behind — `.temp` reached 80 GB (owner). A build that fails still ran its cleanup first, so run it even when the
  candidate itself is not wanted.
- **The cleanup reports honestly since 2026-10-03.** The first mandated run printed «.temp/test/ cleaned» while
  50.2 GB / 4.07 M files of 62.7 GB stayed (measured): the old block was `Remove-Item -ErrorAction SilentlyContinue`
  plus an unconditional «cleaned». Now `Clear-ScratchDir` removes entry by entry and names every survivor with its
  reason (fixture: 3 entries, one locked → 2 removed, the locked one named; the old block said «cleaned» over it).
   A `[WARN] … still in use` line is not noise: a live process holds that test dir.
- **The cleanup skips live test dirs since t74 (2026-10-16).** `Clear-ScratchDir` delegates to
  `scripts/test-scratch.ps1`: a dir with a sibling `<dir>.owner.json` naming a live pid, a
  `opencode-test-data-<live pid>` per-process dir, or an entry younger than 60 min is left in place
  (`[SKIP]`, not `[WARN]`); dead/old entries go exactly as before. The marker sits NEXT TO the dir,
  never inside it — inside would break the git-porcelain-clean fixture test and the ripgrep exact file
  listings. The 80 GB rule stands: the mass is hours/days old, the 60 min threshold never spares it.
- **Where the mass comes from (✓ measured 2026-10-03):** every test dir under `.temp\test\` carries its own
  `.opencode\node_modules` (24–26 MB, ~2.5 k files: zod, effect, @ai-sdk…) and is not removed when the test ends —
  1 731 dirs from one day ≈ 43 GB. The build only sweeps it; the leak is in the test harness and is open.
- **Running the product is `_run.cmd` — open it before starting anything by hand** (owner, 2026-10-11, verbatim:
  «Почему ты просто не следовал _run.cmd»). It sets `OPENCODE_TEST_CONFIG`/`OPENCODE_CONFIG_DIR` to `bin/`
  and `OPENCODE_DB` to the worktree DB, then runs **`bun run --cwd packages/opencode --conditions=browser
  src/index.ts <worktree>`** — the product executed from **SOURCE**, not from a built binary.
- **Why this is the live oracle for a source change.** A change under `src/**` (a tool, a gate, a session
  path) is verifiable LIVE by launching through `_run.cmd`, because that is a NEW process reading the
  sources you just edited. «The live session does not see a tool change» describes the AGENT'S OWN session
  only — its catalogue is frozen in its checkpoint and built from the executable — and it is **never** a
  reason to declare a live verdict impossible. Division: `_build.ps1` stages a candidate into `dist/`;
  `_run.cmd` runs what you just edited; promotion into `bin/` stays the owner's act.
- **Measured 2026-10-11, the reason this rule exists:** a `messagesearch` scope fix was reported as having
  «no live verdict possible in this session» while `_run.cmd` sat in the repo root, unread — the fix was
  proven only by the source-loading test. The procedure existed; the agent invented its own and skipped the
  live oracle. Same class as «scripts/ = reuse the procedure, never re-invent it».
- **A source-run's PROJECT is its WORKING DIRECTORY — that is the whole mechanism (✓ measured 2026-10-12).**
  `cd` into the directory that should be the project and run the entry file by ABSOLUTE path:
  `SET OPENCODE_CONFIG_DIR=<repo>\bin` (provider auth), `cd /d <target>`, then
  `bun run <repo>\packages\opencode\src\index.ts run "<prompt>" -m <model>`. Verified both ways the same day:
  with `cd` into `experiments/2026-09-29_source-run/stand`, the run wrote THAT stand's `opencode.db` and its
  own session, touching no other database.
- **Two knobs that look like they set the project and DO NOT.** (a) `--cwd <repo>\packages\opencode` overrides
  the shell's `cd`, so the worktree becomes `packages/opencode` — which means
  `experiments/2026-09-29_source-run/run.cmd` does **not** isolate the way its own comment claims: it `cd`s into
  the stand and then points `--cwd` at the package, and the run wrote there. Treat that runner as non-isolating
  until fixed. (b) `OPENCODE_TEST_CONFIG` does not redirect the data dir (measured: a run with it set to the
  stand left the stand's DB untouched), and neither does `OPENCODE_DB` — `getProjectDbPath` is hard-coded
  (`{worktree}/.opencode/data/opencode.db`), recorded 2026-09-29.
- **Garbage belongs in `experiments/` — never in a live DB.** Measured mistake 2026-10-11: a source-run with no
  project set resolved to `packages/opencode` and wrote its throwaway sessions into THAT package's DB.
- **Two traps that still bite (✓ measured):** an `opencode/*-free` model REFUSES from a source-run — «free tier
  can only be used from within OpenCode» — while an **openrouter `:free`** model passes and costs nothing; and
  the subcommand comes FIRST (`src/index.ts <project> run …` prints help instead of running).
- **Overriding the model needs the CLI flag** (`run2.cmd` = `run.cmd` + `-m`): `bin/opencode.jsonc` pins a model
  and `OPENCODE_CONFIG_DIR` is re-applied as highest priority (`config.ts:885`), so the flag is the only override
  that wins.

## Full package test suite — the measurement

Measured 2026-09-22 in `packages/opencode`: **18 minutes, `bytes_written: 0`, ~5 GB RSS, no progress
signal of any kind** — the run cannot be told apart from a stall, and killing it is the only way to
learn that. Two consequences, both load-bearing:
