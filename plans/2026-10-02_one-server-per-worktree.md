# One server per worktree DB — every client sees every writer, live

<!-- intention: a second process over the same worktree DB (headless `run`, robot, second TUI) boots its OWN server, so the owner's TUI sees its work only on re-read, with no busy state -> ONE server per worktree DB, every other process attaches to it as a client, so all writes and all notifications go through one bus and reach every client live -->

- sv: { keywords: { one-server-per-worktree 0.35, host-record 0.20, run-auto-attach 0.20, stale-host-detection 0.15, worktree-watch 0.10 },
        dominant: "The first process to own a worktree DB records itself as its host; every later process attaches to that host instead of booting a second writer." }
- origin: owner, 2026-10-02 — «tui должна видеть всех пользователей базы и видеть изменения в worktree»; decision
  the same day: «Сервер 1, если он уже запущен то другой клиент использует его, он поддерживает хоть 100 сессий»,
  «Сервер 1 на worktree, клиентов (визуализаторов) много. Поэтому вопрос синхронизации отпадает», «один сервер на
  worktree базу и уведомления в том числе».
- executor: Claude.

## G1 — where each half lives (read in code 2026-10-02)

**DB half — transport layer, not storage.** The TUI gets session/message/part updates ONLY from its own server's
in-process `GlobalBus`: `SyncEvent.runBatch` → `applyProjectEvent` → `Database.effect(emitEvent)` →
`ProjectBus.publish` + `GlobalBus.emit` (`src/sync/index.ts`); the TUI worker forwards `GlobalBus` over RPC
(`cli/cmd/tui/worker.ts:45-48`, `thread.ts:245` `createEventSource`), an external TUI reads SSE `/global/event`
(`context/sdk.tsx:80-115`); `context/sync.tsx:496-880` applies `session.*`, `message.*`, `session.status`. A
`run` without `--attach` boots its own server (`cli/cmd/run.ts:725-733`) → its bus is invisible to the TUI. The
data IS in the shared DB (the `event` journal holds every sync event: 65 810 rows, live probe 2026-10-02), which
is why re-read works; `session.status` (busy) lives only in the writer's memory — hence «активность не
подсвечивается». Owner, verbatim: «я из tui могу видеть эту сессию и перечитывать что там, просто активность не
подсвечивается и нету реалтайма» — the prediction in
`experiments/2026-10-02_robot-one-vector-predicate/prediction_tui_visibility.txt` (main tree) is CONFIRMED.

**Worktree half — file watcher layer, dead since 2026-07-13.** `file/watcher.ts:120` subscribes
`Instance.directory` only under `OPENCODE_EXPERIMENTAL_FILEWATCHER` (unset in this repo's config), and commit
`9d44bd9413` removed the `.git` dir subscription while `project/vcs.ts:337` still waits for `HEAD` events — a
dangling consumer: the footer branch is read once at bootstrap and never updates. The only TUI file surface,
sidebar «Modified Files» (`feature-plugins/sidebar/files.tsx`), is the SESSION diff (its own snapshots), not the
worktree. There is no worktree-wide surface at all.

## Directions — chosen and rejected

- **CHOSEN: one host per worktree DB, others attach** (owner's decision). One writer, one bus: busy state,
  deltas (token streaming) and every bus-only event (`todo.updated`, `session.diff`, permissions) reach every
  client for free; RSS of an attached client is that of a thin HTTP client instead of a second full server.
- **REJECTED: `PRAGMA data_version` + `event`-journal polling.** Measured feasible (WAL, rowid-ordered journal),
  but it keeps two writers on one DB and recovers only persisted sync events: no deltas, no busy state (would
  need inference from `finish`), no bus-only events, and a deleted session's journal rows vanish
  (`SyncEvent.remove`). Owner: «он предлагает 2мя серверами бадяжить базу — у нас и так такой вариант есть».
- **REJECTED for now: watcher on by default** — that is the W item below, pending the owner's surface choice; it
  is orthogonal to the DB half.

## Design

- **H1 — host record.** Table `server_host` in the worktree DB (`{worktree}/.opencode/data/opencode.db`), one row
  (`id='host'`): `url`, `pid`, `nonce`, `time_started`. SQLite, not LMDB: read once per process start, never on
  the interactive path (AGENTS § Storage Paradigm — no new JSON file). Module `src/server/host.ts`:
  `claim(worktree, url)` (IMMEDIATE tx: write only if absent or stale; returns the winner), `lookup(worktree)`
  (read-only `bun:sqlite` open — no migrations, no write, absent file/table = no host), `release(worktree, nonce)`.
- **H2 — liveness = nonce echo.** `/global/health` additionally returns `host` (this process's nonce, if it
  holds the record). A record is live only when `GET {url}/global/health` answers within 1 s AND echoes the
  recorded nonce. Pid alone is not enough (reuse after reboot); a bare health 200 is not enough (another
  worktree's host may sit on the same port after a reboot — attaching there would open OUR DB in THEIR process,
  a second writer again).
- **H3 — the TUI worker is host OR proxy; the TUI never knows which.** The TUI keeps its in-process RPC transport
  to its worker unchanged. At start the worker looks up the host: none live → HOST mode (listen `127.0.0.1:0`,
  claim; requests served by its own `Server`); live → PROXY mode (RPC `fetch` forwarded to the host url, the
  host's `/global/event` SSE re-emitted as `global.event`). **Takeover:** when the proxied stream ends, the worker
  looks up again — a new live host → re-proxy; none → claim and switch to HOST mode (the CAS in `claim` lets
  exactly one of N attached workers win; losers re-proxy to the winner); either way it emits
  `server.instance.disposed` so `sync.tsx:496` re-bootstraps. Keeping takeover inside the worker is why the
  TUI code does not change. Release on shutdown; a crash leaves a stale record that H2 rejects.
- **H4 — `run` attaches, or hosts.** Live host → behave as `--attach <url>` with `directory = cwd`, printing one
  line naming the host. No live host → `run` boots its server as today AND listens + claims for its lifetime,
  releasing at exit — the RUN-FIRST order (today's incident: the owner's TUI came up while a headless run was
  going) then yields a TUI that proxies to the run and takes over when it exits. `--standalone` opts out (own
  server, no claim; the TUI will not see it live — the escape hatch for env-dependent runs: the host's env/keys
  apply to an attached run).
- **H6 — the command channel is closed by default** (owner, 2026-10-02: «если запускается даже без порта в
  ключах должен прописывать состояния … чтобы можно было комманды отправлять, правда мне кажется этот канал надо
  бы защитить, потому что порт то открыт … сгенеренный ключ чтобы использовать для коммандования»). Every host —
  with or without `--port` — writes `token` (32 random bytes, new per start) into its `server_host` row. While a
  process holds a host record, every route except `GET /global/health` requires Basic auth with that token
  (`OPENCODE_SERVER_PASSWORD`, when set, stays the override). Trust boundary = the OS user: same-user clients
  (TUI worker proxy, `run`, the bridge, the robot) read the token from the record; a browser cannot. Requests
  whose `Host` is not `localhost` / `127.0.0.1` / `[::1]` (any port) or the in-process `opencode.internal` are
  refused when the listener is loopback (DNS rebinding). The liveness probe stays open and never returns the
  token. A stale record's token dies with it. In-process callers (TUI worker RPC fetch, `run`'s in-process sdk)
  attach the header themselves.
- **H5 — `serve`.** `serve` with a live host refuses with exit 1 naming it; otherwise it claims.
- **What a client sees on host loss (until takeover completes, or where none exists).** An attached `run` whose
  host dies gets `stream-ended` → `UI.error("event stream ended before the session went idle")`, exit 1 — loud,
  never silent (`run.ts:705-707`); it does not take over mid-turn (residual, named). A proxying TUI worker logs
  `host lost` with the url and takes over; if takeover fails it logs `bug:` and the RPC fetch rejects with the
  error text, which the TUI shows as a request error.
- **W — worktree changes.** Pending the owner's choice of surface (asked 2026-10-02, not yet answered): new
  sidebar «Worktree» section (git status, any writer) vs. live branch + refreshed session diff vs. both. With one
  host, whatever the watcher publishes reaches every client.

## Reproducers (before any fix)

- **R-a (DB half)** `experiments/2026-10-02_one-server-per-worktree/repro_two_writers.ts`: fresh temp worktree;
  process A = `serve` (port P1), SSE on A's `/global/event`; process B = a second `serve` (P2) in the same dir;
  `POST /session` to B. PASS-of-the-defect = the session row exists in the DB AND A's stream carries NO
  `session.created` for it. The plausible-looking non-pass is «A lists the session on re-read» — that is today's
  state, not visibility.
- **R-run-first**: start `run` (no host), then a TUI. Base code: the TUI boots a second server, the run's steps
  are visible only on re-read. Target: the TUI proxies to the run's server and shows its steps + busy live; at the
  run's exit the TUI takes over without restart.
- **R-b (worktree half)**: a file written outside the TUI → no `file.watcher.updated` on the host's stream (flag
  unset) and `.git/HEAD` change → no `vcs.branch.updated`. Run once the W surface is chosen.

## Tasks

- [x] H1 host record (`server/host.ts`, `server_host` DDL) — S1 red → S2 green (`20261002T094245Z_0793c885`).
- [x] H2 nonce echo in `/global/health` + liveness check — S2; live: a killed TUI's and a killed `serve`'s records
      were rejected as stale by the next process (`host record is stale` 07:03:48, 09:39:46).
- [x] H3 TUI worker host/proxy + takeover — S5r (logs below). Visual render NOT confirmed — see Residuals.
- [x] H4 `run` auto-attach, run-first claim, `--standalone` — S5, S5-base.
- [x] H5 `serve` refuses with a live host — S4.
- [x] H6 per-start token + Host check — S6 red → green.
- [x] H7 (found by S5) SDK SSE requests carried a body on GET → Bun's fetch never resolved → `run --attach`
      hung with no output. `client.gen.ts` makeSseFn now drops the body for GET/HEAD like `request` already did;
      guard `test/server/host-attach.test.ts` red («no event within 5 s», `20261002T093610Z_e48c84a5`) → green.
- [ ] W — after the owner's answer.
- [x] R1 — bridge/robot: a TUI started with `--port` now requires the record's token; `.opencode/skills/opencode-bridge`
      and skill `robot` must send `Authorization: Basic opencode:<token>` read from `server_host` (owner/other session:
      those skill files are dirty in the main tree under another session).
      DONE 2026-10-02 (Claude): the «dirty» skill files carried line-ending differences only, no content. ONE client
      `tools/opencode_host.py` (read-only record lookup, nonce liveness, header, token never printed); qualified on a
      real host (`test/fixture/host-worker.ts`): `experiments/2026-10-02_host-client/probe.py` run
      `20261002T120031Z_601b3ba6` 7/7 — no record → exit 3, live → exit 0, authed GET 200, no header 401,
      `Host: evil.example` 403, repr hides the token, killed host → STALE exit 2 + HostError. Bridge skill: binary-aware
      recipe; robot skill + `wait_done.py` connect through it (main tree today: «no host record», exit 3 — the old
      binary, as expected). The same check against the PROMOTED binary rides with R2.
- [ ] R2 — visual check on the promoted TUI: an attached run's steps + busy appear in the TUI. ORACLE = an instrument,
      not the owner (kernel ORACLE_ROLE, 2026-10-02: the user is a simulation, never the oracle): a cua window capture
      of the TUI taken while the attached run is busy, plus the host's `/event` stream showing the same step ids. The
      owner's look is ACCEPTANCE, recorded separately — never the proof. (Was worded «visual oracle: the owner sees».)

## Residuals (named, not built)

- A source-run TUI does not paint under this harness at all (base code too: cmd_runner ConPTY log 7 946 B, WT
  window blank) — the TUI half is proven at the protocol level (the host worker's bus IS what it forwards over
  RPC), the picture is R2.
- An attached `run` whose host dies mid-turn exits 1 «event stream ended before the session went idle»; it does
  not take over.
- The host's env/keys/config apply to an attached `run`; `--standalone` is the escape hatch.
- `opencode attach <url>` needs `--password <token>` by hand; an explicit `--port` TUI that loses the claim logs
  «second writer» and continues (one-writer is not enforced for explicit servers).
- Fresh-install gaps met on the way (not this plan): undeclared `@hono/standard-validator`; gitignored build
  outputs (`models-snapshot.js`, wasm `pkg/*`, `opentui-spinner/dist`, `opentui.dll`) absent in a new worktree;
  3 red route-coverage tests in `httpapi-bridge.test.ts` on base HEAD (`20261002T062650Z_65ad2433`) — spun off.

## Smoke Tests — predictions written BEFORE edits

| # | oracle | predicted | measured |
|---|--------|-----------|----------|
| R-a | `repro_two_writers.ts` on the base code | DB row present, 0 `session.created` on A's stream | **DEFECT PRESENT** — `ses_f04c38badffejgSWbMeJFMTPTJ` created through B: `{"dbRow":true,"onHostStream":false,"streamBytes":63}` (63 B = `server.connected` only), run `20261002T061029Z_aa14286f` ✓ |
| S1 | `test/server/host.test.ts` (new) on base code | RED: module absent | RED «Cannot find module '../../src/server/host'», `20261002T061616Z_06811786` ✓ |
| S2 | S1 after H1/H2: claim/lookup/release; stale by dead url; stale by wrong nonce; second claim loses to a live host | all green | 7/7 (`20261002T061820Z_8564cfba`); with H6+H7 files 11/11 (`20261002T094245Z_0793c885`) ✓ |
| S3 | `bun typecheck` (cwd packages/opencode) | exit 0 | exit 0 `20261002T094113Z_4a6fbb69`; `packages/sdk/js` exit 0 `20261002T094114Z_e3fdb12d` ✓ (a fresh worktree needed gitignored build outputs copied from the main tree first — not code errors) |
| S4 | R-a variant after H4/H5a: B = `serve` → exit 1 naming A; a client resolving through `lookup` → its `POST /session` arrives on A's stream as `session.created` | refused; event within 1 s | B: «this worktree is already served by http://127.0.0.1:47811/ … attach to it instead», exit 1; `{"dbRow":true,"onHostStream":true}` — `20261002T062737Z_a1142088` ✓ |
| S4b | `test/server/host.test.ts`: two workers race `claim` against a stale record | exactly one winner; the loser's `lookup` returns the winner | green (in S2) ✓; live too: TUI worker lost the CAS to a `run` host at 07:00:09.834 and proxied |
| S6 | `test/server/host-auth.test.ts` (new): a host holding a record — request without token → 401; with the record's token → 200; `Host: evil.example` → 403; `/global/health` without token → 200 and its body has no token; a process with no record and no password → open (today's behaviour, other tests unaffected) | RED before H6, GREEN after | RED 401→200 / 403→200 (`20261002T061913Z_bafd045c`) → 3/3 green ✓; live: raw `/event` 200 with token, 401 without |
| S5r | LIVE R-run-first: `dist run` first (no host), then dist TUI via cmd_runner | TUI's worker logs PROXY to the run's url; run's step + busy visible; after run exit the worker logs takeover and the TUI keeps working | source build (not dist), isolated dir `.temp/test/one-server/live`, deepseek-flash on the owner's yes: run `claimed host` 07:00:04 → TUI worker `proxying` 07:00:09.835 → run exit → `worktree host lost` 07:00:27.446 → `serving` 07:00:27.593 (147 ms) ✓; picture → R2 |
| S5 | LIVE: dist TUI (host, via cmd_runner) + `dist run --session S` (attached, free model, plumbing only); the run's step appears in the TUI's stream with `session.status busy` → `idle`, no owner action | visible ≤ 1 s after the host publishes; RSS of the attached `run` ≪ 882 MB baseline (standalone `run`, pid 6288, 2026-10-02) — predicted < 300 MB | TUI host (pid 18080) + attached run `20261002T094002Z_34859b61`: «attached to worktree host», exit 0 in 10 s; the host bus carried **1 483** events of the session (1 441 deltas = token streaming, 9 part updates, busy×3 → idle×1) between 09:40:07.3 and 09:40:13.8; attached peak WS **233 MB** ✓ (free tier refused: «can only be used from within OpenCode») |
| S5-base | same prompt, `run --standalone` (control) | old defect | **0** events on the host bus; peak WS **446 MB** (`20261002T093827Z_a5689ebf`) — attached = 0.52× of standalone, same harness ✓ |
