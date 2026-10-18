# t91 — the robots' delegation port is 2727 (TUI host only)

<!-- intention: TUI-host delegation prefers 2727 -> TUI-host delegation prefers 2727, web/debug keep 4096 -->

```yaml
Keywords: tui-host-port-2727 0.35, serve-keeps-4096 0.25, host-record-authoritative 0.20, robot-delegation 0.15, codex-oauth-collision 0.05
Semantic dominant: The TUI worker's embedded host server prefers port 2727 with sequential next-free fallback while serve/web keep the shared 4096 default, and robot docs read the port from the host record.
md5: 7f3a9c1e4b5d6a708192a3b4c5d6e7f8
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 0e7d4b13a9c58f62d1e0a7b3c9f45d28
note: hash values are generative tags — search them, never compute them.
```

## Correction applied (Legislator, owner verbatim)

«4096 это вебка опенкода))) Вроде как ну и отладка вроде как тоже.»

So the global default does NOT move. `cli/network.ts` gives every command port
default 0 and `server/adapter.*.ts` prefers 4096 for 0 — 4096 is opencode's WEB
UI and debug port and stays theirs. The change is narrower: only the TUI's
embedded host server (the one robots are delegated through) prefers 2727, with
next-free fallback and the real port in the host record. `opencode web` and
`opencode serve` keep preferring 4096. No adapter hunks (nothing was edited
there — verified by read-back before any write).

## Binding

- TUI host start: `packages/opencode/src/cli/cmd/tui/worker.ts` `settle()`
  (`Server.listen({ port: 0, ... })`) and the explicit `rpc.server()` path used
  by `thread.ts` when `--port/--hostname/--mdns` is passed.
- New unit: `Server.listenTuiHost(hostname)` in
  `packages/opencode/src/server/server.ts` — tries 2727, then each next port
  sequentially (bounded scan), then OS-assigned; never returns the web/debug
  port. Adapters and `Server.listen` keep preferring 4096 for 0.
- Robot delegation contract: port comes from the worktree host record
  (`server_host`), never assumed. Robot docs/skills/dispatch say 2727;
  web/debug docs keep 4096.

## Tasks

- [x] T1 RED test `packages/opencode/test/server/tui-host-port.test.ts` — RED run 20261018T115822Z_38f2e364 exit 1 (missing export), GREEN run 20261018T120212Z_8c80ffb0 exit 0, 5 pass / 9 expects:
  TUI host binds 2727 when free; binds the next free port (2728 in the test,
  never the web port) when 2727 is occupied; the host record holds the real
  port; default `Server.listen({ port: 0 })` still tries the web port first
  (4096 when free, non-4096 fallback when taken — adaptive to the machine).
- [x] T2 Implement `TUI_HOST_PREFERRED_PORT = 2727` + `listenTuiHost()` in
  `server.ts`; wire `worker.ts` `settle()` and `rpc.server()` (port 0 only,
  explicit ports pass through unchanged). Adapters untouched.
- [x] T3 Robot docs/skills/dispatch to 2727-via-host-record:
  `experiments/2026-10-08_robot-wave/dispatch.py` fallback BASE,
  `.claude/skills/robot/SKILL.md` launch example + one rule line
  («clients read the port from the host record; never assume it»),
  `.opencode/skills/opencode-bridge/SKILL.md` 2727-vs-4096 distinction line.
  `docs/linux-deploy.md` (serve), `scripts/promote_bin.py` docstring (serve
  example), `run.ts`/`attach.ts` hints and `plugin/index.ts` fallbacks stay
  on the web port — justified, not changed.
- [ ] T4 Oracle: RED→GREEN run of the new test file (one file per call
  through cmd_runner), 4096-grep audit of the changed areas (0 unjustified
  hits), `_build.ps1` through cmd_runner, commit through
  `scripts/commit_own.py` + `_progress_log.md` entry.

## Smoke Tests

- Baseline (before T2): new test file FAILS — `listenTuiHost` does not exist
  (import error); the default-port assertions document current behavior
  (4096-first).
- Post-change: the same file PASSES — 2727 when free (measured free
  2026-10-18 via `experiments/2026-10-18_port-probe.mjs`: 2727 CLOSED, 4096
  live owner host 10.0.1441), 2728 when 2727 is held, host record round-trip
  holds the real port, default path still 4096-first.
- Regression guard: `test/server/host-attach.test.ts` still passes (host
  claim/lookup untouched); full `_build.ps1` exit 0.
- Discriminating control: with 2727 held by a raw server, the TUI-host call
  must NOT return 2727 and must NOT return the web port — before the fix the
  equivalent call returned the web port (or random), never 2728.

## Out of scope

ADID's canon (its resident robot does it). `bin/`. The owner's live host on
4096 (never disturbed; the audit adapts to it).
