Rules for this task (owner, 2026-10-08):
- Work in D:\zPython\opencode on branch Local_Development. Do NOT check out another branch, do NOT create a worktree:
  two other robots work in this same tree on disjoint paths.
- Commit ONLY your own paths (`git add <path>…`, never `git add -A`). `_progress_log.md` is shared: append your entry;
  on a cherry-pick conflict there keep BOTH entries. If git reports index.lock, wait 5 s and retry.
- A progress-log row goes ONLY through the log route (t131): write your entry to a row file (LF bytes, no BOM), then
  `python scripts/commit_own.py --session <your-session-id> -m <msg> --append _progress_log.md=<row-file> [-- <paths>]`.
  Never stage `_progress_log.md` whole, never hand-build a patch for it (`git apply` rejects CRLF patches on this host
  and stale context fails — the route appends your row to HEAD's bytes and refuses foreign hunks).
- Commit through your private index: `python scripts/commit_own.py --session <your-session-id> -m <msg> -- <paths>` (never bare `git commit` — one shared `.git/index` sweeps other robots' staged work; t66).
- Tests: from packages/opencode, ONE file per call, through cmd_runner (`cmd_runner start --cwd packages/opencode --
  bun test <file>`); read the run's state.json and the whole output. Never `bun test` without a path.
- A red test is first a question about the TEST against the requirement (AGENTS.md § Bug Policy); never weaken it.
- Never touch bin/. Never --no-verify. If a permission is refused, STOP and say which one.
- When done: run `pwsh -NoProfile -File _build.ps1` through cmd_runner from the repo root and read its state.json.
- Final message: what changed (paths + commit hashes), what ran (command, run id, exit), what is unresolved.
- Prior art first (@REUSE_BEFORE, G6 «explain any invention»). For any non-trivial solution, the final message carries a
  PRIOR-ART receipt:
  - what you searched (instrument + query: repo, history, plans, docs, the web via Universal Search);
  - what you found;
  - why your choice beats the found alternatives.
  An invention that is worse than one found, or was never compared, is not accepted. Owner, 2026-10-20: «чел потратил
  время впустую, усложнил жизнь своим коллегам и потенциально ухудшил финальный продукт.»
- Trials — profiling, measurements, probes, model checks — go to your `researcher_agent` sub-agent (owner, 2026-10-08).
- **Clean up after yourself** (owner, 2026-10-22: «засрали диск. Дубликатов море»). `experiments/` is scratch you BORROW:
  - when your task closes, remove what you can regenerate — build targets (`target/`, `dist/`, `out/`, `build/`, `release/`, `deps/`), `node_modules` copies, repo tree/archive copies, and the second and later copy of a byte-identical file (keep one) — and leave a note naming how to regenerate each item;
  - NEVER delete a unique result (report, csv, json finding, script): a finished experiment whose finding is recorded moves to `experiments_history/` per its canon; anything you cannot classify goes on a list for the owner;
  - **Never copy a repo tree with `shutil.copytree`** — it follows NTFS junctions and copied 72.4 GB until drive D had 0 GB free (2026-10-21). Use `scripts/copy_tree_safe.py`: it treats a junction as a leaf (never descends, never copies the target);
  - budget: ONE experiment folder ≤ 2 GB, the whole `experiments/` tree ≤ 16 GB. Check it at task close: `python scripts/experiments_budget.py --root experiments --max-total-gb 16 --max-folder-gb 2` — it prints the size and the top offenders and exits NON-ZERO over budget. Clean with `python scripts/experiments_cleanup.py --root experiments` (dry run) and `--apply` (junction-safe; it proves every junction target survived);
  - never touch `bin/`, `external/`, `.claude/`, `bin_tst/`.
