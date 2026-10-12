# 2026-10-11 — sv-chain smoke (vectors / breaks / absent session)

Instrument for `plans_completed/2026-10-11_sv-chain-and-scope.md` (S2–S4). It runs the
SOURCE build (`bun run packages/opencode/src/index.ts`) in a sandbox project that carries a
COPY of the repo's project DB and memory index, asks the model to make one prescribed
`messagesearch` call, and the model quotes the tool output verbatim.

## Run it

1. `python copy-dbs.py` — copies `{repo}/.opencode/data/opencode.db` (sqlite backup API) and
   `.../memory/memory.db` into `stand/.opencode/data/`, then **delete the copied host
   registry**: `sqlite3 stand/.opencode/data/opencode.db "DELETE FROM server_host"`.
   WHY, measured 2026-10-12: the copied row makes the source-run ATTACH to the live host
   (pid 26272, port 4096) and execute the OLD binary's tools — the first smoke looked green
   while running the wrong code.
2. `run.cmd` — one prescribed call per variant:
   - `corpus=vectors, session=*, last=5` → `## Vector chain — 5 of 441 carrier(s) · 2 break(s)`,
     newest first, `prev→md5` links (`start→…` for a chain start), grouped `## Session:`
     (run `20261012T105036Z_c99fe01d`).
   - `session=ses_absent_smoke_xyz` → `session ses_absent_smoke_xyz is not in the memory
     index` (run `20261012T104941Z_504aceec`); the fresh-session `corpus=vectors` call
     honestly answers `Vector chain — 0 carrier(s)` (default scope = current session).

The sandbox's own `opencode.db`/`memory.db` are throwaway copies; the live database is never
written by these runs.
