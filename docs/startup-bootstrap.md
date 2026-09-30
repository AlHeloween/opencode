---
last_verified: 2026-09-10
reproduce:
  files:
    - packages/opencode/src/storage/db.ts
    - packages/opencode/src/project/instance.ts
  commands:
    - cd packages/opencode && ..\\..\\tools\\adm.exe --cmd-runner start -- bun test test/storage/db.test.ts test/project/project.test.ts
    - cd packages/opencode && ..\\..\\tools\\adm.exe --cmd-runner start -- bun typecheck
  inputs: locked, slow, or malformed portable project database during startup
  expected_outputs: bounded WAL lock wait and an exact logged startup stage or failure
---

# Startup, bootstrap, plugins, and related systems

Operational notes for **cold start**, **instance bootstrap**, **plugins**, **snapshot vs VCS**, and **shell permissions**. Derived from production code paths and runtime logs on Local_Development.

## Cold-start pipeline (TUI)

```
opencode.exe load (~294 MB binary — multi-second tax on Windows)
    → TUI thread: TuiConfig + dynamic import("./app")
    → spawn Worker (second process; same stack)
    → Worker: HTTP server + first Instance.provide → InstanceBootstrap
    → TUI: renderer / theme / providers
    → Sync.bootstrap: providers, agents, config, project, then sessions…
    → status "partial" (UI usable) → secondary panels → "complete"
```

Rough costs seen in practice:

| Stage | Order of magnitude | Notes |
|-------|--------------------|--------|
| Binary load | ~3 s for `--version` alone | Bundle size dominates |
| Instance bootstrap (first request) | often several–10+ s | Config + **Plugin.init** block; services forked |
| Provider catalog | ~2 s | After instance is up |
| CodeGraph | **not on critical path** | Fire-and-forget |

Escape hatches:

- `OPENCODE_FAST_BOOT=1` — TUI treats sync as ready without waiting for load (`SyncProvider.ready`)
- `OPENCODE_PURE=1` — skip **external** `plugin_origins` (internal auth plugins still load)
- `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER` — skip file watcher native bind

### Log rotation must not gate the worker (black-screen root cause)

`Log.init()` runs in the TUI **worker** before `Rpc.listen()`. It used to
`await cleanup(Global.Path.log)`, which bulk-unlinks old log files once the flat
log dir holds more than `keep = 100` entries
(`packages/core/src/util/log.ts`). While that loop ran, the worker did not serve
RPC, so the host's first `fetch` timed out and the UI painted nothing at all —
the "second launch shows a black screen" report, reproduced as: >100 log files →
hang; <100 → instant.

Two things follow, and both are enforced:

- **Rotation is background housekeeping.** `init()` uses `void cleanup(...)`, so
  it never sits on the startup critical path. (On Windows, unlinking a file
  another process still holds open *fails*; `cleanup()` swallows that per-file
  error, so a large directory could keep the loop busy on every boot.)
- **Rotation still bounds the directory.** Deferring it does not leak: with 300
  files, boot completed in ~4 s and the background pass trimmed the dir to
  `keep` (300 → 104, stable — 100 kept plus the new session's own files).
- **Any remaining stall must be visible, not silent.** The bounded guards below
  convert a hang into a rendered, degraded UI plus a `--print-logs` line.

### TUI startup deadline (black-screen guard)

The TUI wraps every provider in `SyncProvider`/`KVProvider`, and both gate
rendering on `ready` (`context/helper.tsx` renders children only when
`init.ready === true`). Because `App` — and therefore `StartupLoading`
("Loading plugins...") — sits *inside* those gates, a bootstrap that never
answers renders **nothing at all**, with no spinner and no log line.

Bounds added 2026-09-12 (fix for the black-screen report):

| Guard | Value | Behaviour on expiry |
|-------|-------|---------------------|
| `STARTUP_DEADLINE_MS` (`tui/context/sync.tsx`) | 15 s | `status: loading → partial`; gate opens, UI renders degraded, `warn("bug: tui bootstrap exceeded startup deadline")` |
| `KV_LOCK_TIMEOUT_MS` (`tui/context/kv.tsx`) | 2 s | warn + fall back to default KV (never gate the UI on the lock) |
| `META_LOCK_TIMEOUT_MS` (`plugin/meta.ts`) | 5 s | warn + continue without metadata bookkeeping |
| `MODELS_LOCK_TIMEOUT_MS` (`provider/models.ts`) | 10 s | warn + serve the bundled models snapshot |
| `WORKER_CALL_TIMEOUT_MS` (`tui/thread.ts` + `util/rpc.ts`) | 30 s | RPC `call()` rejects instead of hanging forever (opt-in; default stays unbounded) |

A TUI that shows nothing is a defect, not a slow start: after these bounds it
either renders or reports the stall in `--print-logs`.

---

## Instance bootstrap block

On the **first** HTTP request for a directory, middleware does:

```ts
Instance.provide({
  directory,
  init: () => AppRuntime.runPromise(InstanceBootstrap),
  fn: () => next(),
})
```

Until `init` completes, that request (and concurrent first hits for the same dir) **wait**. Later requests reuse the cached instance.

### A. Before `InstanceBootstrap` (`Instance.boot`)

| Step | Blocking? | What |
|------|-----------|------|
| `Project.fromDirectory` | Yes | Worktree, project id, VCS metadata |
| `Global.initFromWorktree` | Yes | Data/log/cache under `{worktree}/.opencode/data/` |
| `Database.withProject` | Yes | Project SQLite binding |
| `Log.reopen` | Yes | Worktree log directory |

`Project.fromDirectory` owns the ordinary project-row upsert. A moved portable database is not repaired during startup; `opencode db fix` is the explicit repair action.

### SQLite startup freeze guard

Opening `{worktree}/.opencode/data/opencode.db` is synchronous native work. The process cannot safely cancel a native call that has already entered SQLite, so startup uses a diagnostic-and-boundary guard rather than a fake Promise timeout:

1. `PRAGMA busy_timeout = 5000` is applied before `journal_mode = WAL`, the only normal startup step that may need an exclusive lock.
2. The passive WAL checkpoint is not run during startup; shutdown owns the explicit truncate checkpoint.
3. Every native stage logs `started`, then either `completed` with duration or `failed` with the error: directory creation, client open, lock timeout, WAL, synchronous/cache/foreign-key pragmas, migrations, and core schema.
4. `Instance.boot` logs its current phase and emits `instance boot failed` plus `instance boot rejected` before evicting a failed cached instance.

If a native SQLite call itself wedges, the last `project database startup stage started` record names the exact operation and DB path; a subsequent request is not silently attached to a rejected instance promise.

### B. `InstanceBootstrap` (`packages/opencode/src/project/bootstrap.ts`)

```
1. Config.get()                 ← WAIT
2. Plugin.init()                ← WAIT  (force-builds plugin state)
3. forkDetach × 7 service inits ← do NOT wait for constructors to finish
4. initCodeGraphBg()            ← fire-and-forget
5. Bus.subscribe(Command.INIT)  ← WAIT (subscribe only)
→ bootstrap Effect completes → first HTTP continues
```

#### Sequential (critical path)

1. **Config** — merge global + project config (agents, permissions, plugins, LSP flags, …).
2. **Plugin.init()** — see [Plugin.init](#plugininit) below. Plugins may mutate config, so this must finish before other services.

#### Forked service `init()` (not awaited)

`Effect.forkDetach(service.use(i => i.init()))` for:

| Service | What state/init does |
|---------|----------------------|
| **LSP** | Registry of language servers (ids, extensions, spawn recipes). **Does not** start tsserver/etc. yet. |
| **ShareNext** | Session-share plumbing (often no-op if disabled). |
| **Format** | Formatter table + enable checks. |
| **File** | File service; git status-style work can run later. |
| **FileWatcher** | Load `@parcel/watcher`, pick backend (`windows` / fs-events / inotify). Full tree subscribe only under experimental flag. |
| **Vcs** | **Project** git branch / default branch (not Fossil snapshot). |
| **Snapshot** | **Fossil only** — open/create `.opencode/data/fossil/{projectID}/snapshot.fsl`. |

These can still burn CPU/disk **after** bootstrap returns (overlap with first paint).

#### CodeGraph — not the bootstrap wait

```ts
// Fire-and-forget, non-blocking
initCodeGraphBg()
```

- If `.codegraph/codegraph.db` missing → spawn `codegraph init` (unref) or create empty SQLite schema  
- Live graph is **not** a detached `serve --mcp` from bootstrap — configure `mcp.codegraph` (`codegraph serve --mcp`). While MCP is active, SQLite/CLI are blocked; codegraph tools **hard-fail** if MCP is down (no soft-skip; reindex without MCP ~20m).  
- **Does not** gate first HTTP  

Full indexing (when CLI runs) is background and unrelated to the first-request block.

---

## Plugin.init()

```ts
// packages/opencode/src/plugin/index.ts
const init = () => InstanceState.get(state)  // force first state build
```

The cost is the **Plugin.state** builder:

1. Dynamic import of server module; in-process SDK client for hooks  
2. **Internal plugins** (always, sequential) — each `plugin(input)` → hooks  
3. **External plugins** from `config.plugin_origins` (unless `OPENCODE_PURE`)  
   - `config.waitForDependencies()` (install/network)  
   - `PluginLoader.loadExternal` + sequential `applyPlugin`  
4. Call each hook’s `config?(cfg)`  
5. Subscribe bus events into plugin `event` hooks; register dispose finalizers  

### Built-in internal plugins (auth providers)

| Plugin | Package / path | Purpose |
|--------|----------------|---------|
| CodexAuthPlugin | `./codex` | OpenAI Codex auth |
| CopilotAuthPlugin | `./github-copilot/copilot` | GitHub Copilot auth |
| GitlabAuthPlugin | `opencode-gitlab-auth` | GitLab auth |
| **PoeAuthPlugin** | `opencode-poe-auth` | **[Poe](https://poe.com)** OAuth + API key (`provider: "poe"`) |
| CloudflareWorkersAuthPlugin | `./cloudflare` | CF Workers auth |
| CloudflareAIGatewayAuthPlugin | `./cloudflare` | CF AI Gateway auth |
| AzureAuthPlugin | `./azure` | Azure auth |
| DigitalOceanAuthPlugin | `./digitalocean` | DigitalOcean auth |
| **XaiAuthPlugin** | `./xai` | **xAI** auth |

**Poe auth** specifically: browser OAuth via `poe-oauth` (PKCE, opens browser) or manual API key; loader exposes `{ apiKey }` for the `poe` provider. Unrelated to shell/permissions/CodeGraph.

External plugins from config can dominate startup if install is required. Internals still run every boot even when unused that session.

---

## Snapshot vs project VCS vs TUI indicator

Three control systems — easy to confuse; the TUI footer is display-only:

| System | Backend | Role |
|--------|---------|------|
| **Snapshot (agent undo / “Modified Files”)** | **Fossil only** (`snapshot/fossil.ts`) | Sidecar `{data}/fossil/{projectID}/snapshot.fsl`; track / full-leaf undo-redo / diffs. Honors `.gitignore` via ignore-glob. Binary: [tools-and-sidecars.md](tools-and-sidecars.md) §4.1. **Full semantics:** [fossil-snapshot.md](fossil-snapshot.md). |
| **Project VCS** (`project/vcs.ts`) | **Git** (when `project.vcs === "git"`) | Branch name, agent git-facing diffs — **source control**, not the undo timeline. |
| **Point edit recovery** (`restore`) | **`.bak`** under `{data}/backups/{sessionID}/` | Restores the pre-edit content of one file. It does not read or modify Git, Fossil, `/undo`, or `/redo`. |
| **TUI footer indicator** | `vcs-indicator.ts`: `.jj` → fossil sidecar/`_FOSSIL_`/`_fossil` → `.git` | Display only (jj blue, fossil green, git red). Fossil wins when the **sidecar** exists even without an open marker — a git monorepo still shows green fossil for agent undo. |

`Snapshot.Service` is provided only via `SnapshotFossil.defaultLayer`. Fossil deliberately does not pack `.git`, `.jj`, or Fossil checkout markers into the sidecar.

### Undo/redo (leaf navigation)

Session undo materializes one **checkin leaf** (`revertTo`), not a mix of per-file hashes. After checkout, only agent-owned extras (paths that were in pre-checkout `fossil ls`) are removed so tree structure matches the leaf; user-only untracked files stay. Multi-level redo uses `session.revert.redo_stack`. Corrupt reinit writes `HISTORY_INVALID.json` and fails loud on old hashes. Details: [fossil-snapshot.md](fossil-snapshot.md).

`.bak` is intentionally outside this flow: it is read only by `restore` for a one-file pre-edit recovery.

### Git vs Fossil must stay decoupled

- **`.git/index.lock`** is a git-only concern. It must not block Fossil open/init.
- Snapshot `ensureInit()` runs **eagerly** when `SnapshotFossil` state is first built (instance bootstrap), not only on the first `track()` after an agent edit.
- Project discovery git calls use `--no-optional-locks` so read paths do not create `index.lock`.
- Footer detection uses the sidecar file (and open markers), not git health.

---

## Shell & exec permissions (separated)

Permission keys are **not** all `bash`:

| Key | Gates | Default (agent `*`: allow + overrides) |
|-----|--------|----------------------------------------|
| **destructive** | Constitution high-risk (`rm -rf`, force-push, …). Not covered by bash/cmd/ps/run wildcards. | **deny** |
| **bash** | `bash` tool with POSIX shell (bash/zsh/sh) | allow |
| **powershell** | `bash` tool when shell is `pwsh` / `powershell` | allow |
| **cmd** | Windows `cmd` tool + `bash` tool when shell is `cmd.exe` | allow |
| **run** | `run` tool — direct binary exec | allow |

`Shell.permissionKey(shell)` maps the active shell for the bash tool. `/permissions` lists these under **Shell & exec** with draft edit (↑↓ / ←→) and explicit Save/Reload.

TUI: `bash` / `cmd` / `run` share a **ShellTool** renderer (streaming `metadata.output`), not GenericTool (hidden unless “show generic tool output”).

---

## What is *not* in the first-request wait

- Full provider/model catalog (later `/config/providers` etc.)
- MCP server processes  
- LSP **processes** (spawn on file touch)  
- TUI OpenTUI renderer / theme probe  
- Session list (after instance up)  
- CodeGraph full index  

---

## Related code

| Path | Role |
|------|------|
| `packages/opencode/src/cli/cmd/tui/thread.ts` | TUI process + worker spawn |
| `packages/opencode/src/project/instance.ts` | Instance cache + boot |
| `packages/opencode/src/storage/db.ts` | Per-project SQLite open stages, lock bound, and shutdown checkpoint |
| `packages/opencode/src/project/bootstrap.ts` | `InstanceBootstrap` |
| `packages/opencode/src/plugin/index.ts` | Plugin state + internal plugins |
| `packages/opencode/src/snapshot/fossil.ts` | Fossil snapshot backend |
| `packages/opencode/src/project/vcs.ts` | Project git VCS |
| `packages/opencode/src/shell/shell.ts` | `permissionKey` for shell tools |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | TUI `bootstrap()` + `ready` / `OPENCODE_FAST_BOOT` / `STARTUP_DEADLINE_MS` (black-screen guard) |
| `packages/opencode/src/cli/cmd/tui/context/kv.tsx` | KV state; `KV_LOCK_TIMEOUT_MS` — never gates the UI |
| `packages/opencode/src/util/rpc.ts` | Worker RPC client; optional per-call `timeoutMs` |

---

## Config overlay and `/permissions` save

TUI and `opencode dirs` write a **worktree overlay** at `{directory}/config.json` via `Config.update(..., { dispose: false })`.

That path must **invalidate per-directory InstanceState** (Config, Agent, Plugin, …) after writing so the next `Config.get()` rebuilds from disk. If only the file is written and the cache is kept, the permissions dialog reloads stale values and settings appear to “revert.”

Full `Instance.dispose()` still runs when `dispose` is not `false` (heavier; tears down the instance context).

**TUI `/permissions` write path (simple):** the dialog writes `{directory}/config.json` with `Bun.write` (merge patch into existing file). It then updates the in-memory sync store and calls `instance.dispose` + bootstrap so the server reloads that file. No SDK `config.update` body mapping for this dialog.

---

## Incremental build (`build.py`)

Content-addressed **xxhash128** fingerprints decide which stages to run:

```text
python build.py              # incremental
python build.py --status     # plan only
python build.py --full       # force all steps
python build.py --skip-reasoning
python build.py --only opencode
```

Steps: `kernel` → `reasoning` → `rust` → `opentui` → `opencode` → `stage`.  
Cache: `.build-cache/manifest.json` (gitignored).  
On incremental failure: message to retry with `--full`.  
Still uses existing `_build_rust.ps1`, OpenTUI `bun run build`, and `script/build.ts --single` under the hood. `--only` is repeatable (`--only opencode --only stage`).

### Host prerequisites for `opentui` (measured 2026-09-30)

Every other step needs only bun, python and git. The native half needs two things this host did not have ready:

| Needs | Why | Supplied by `build.py` |
|---|---|---|
| **Zig 0.16** | `packages/opentui/packages/native/build.zig` uses the 0.16 API — `std.Io.Dir`, `b.Graph.environ_map`, `std.mem.find`; on 0.15 `build.zig:111` fails | The tree **ships its own compiler** at `external/zig-x86_64-windows-0.16.0/`. `build.py` **prepends** the highest `external/zig-*/zig.exe` by name, so the pinned compiler wins over whatever the host exposes |
| A POSIX **`sh`** | bun's `prepare:zig` runs `sh scripts/prepare-zig-deps.sh`, which unpacks the vendored `src/vendor/zig-deps.tar.gz` — offline, no download | Windows has none; `build.py` **appends** Git for Windows' `Git\usr\bin` |

**Why `zig` is PREPENDED and `sh` is APPENDED — the two orderings are the whole fix.**
`packages/opentui/packages/core/scripts/build.ts:194` calls `zig` BY NAME with no `env`, so the process
PATH decides which compiler builds the DLL — and this host's PATH carries chocolatey's **0.15.2**, which
cannot compile the tree. The in-repo compiler must therefore come FIRST. `sh` goes LAST on purpose:
prepending also puts Git's GNU `tar` first, and GNU tar reads the drive-letter root bun hands the script
as a **remote host**, dying with `tar (child): Cannot connect to D: resolve failed`, while the Windows
bsdtar in system32 handles it. Appending keeps the blast radius at exactly the tools Windows lacks
(`sh`, `cksum`, `cmp`, `ln`).

**Do NOT measure this with a bare `zig` from python.** `subprocess.run(["zig", …], env=…)` resolves the
program with the PARENT's PATH, not the `env` you passed — so it reports the host's 0.15.2 while the child
would have used 0.16. That artifact cost two attempts on 2026-09-30 (the second through cmd_runner's
auto-wrap, which swallows a `set PATH=…`). Ask the resolution itself — `python -c "import shutil;
print(shutil.which('zig'))"` under the same PATH — or run the real step.

**The other entry points do NOT do this.** `_opentui.ps1` and `_build.ps1` never touch PATH: they call
`bun run build` and let the host's `zig` win. A native build through them needs
`external/zig-x86_64-windows-0.16.0` on PATH by hand; through `build.py` it does not.

**When the native half cannot be rebuilt**, a binary still builds from the DLL in the tree:

```text
python build.py --only opencode --only stage
```

That is correct only while the DLL is source-current. Check before trusting it:
`git log -1 -- packages/opentui` — the step's fingerprint counts every non-ignored file, so a commit
touching only `.gitignore` (measured: `26604f2ca4`) flips it to `[REBUILD]` as **bookkeeping, not staleness**.

### Artifacts, and the freshness oracle

`stage` copies into `dist/`:

| File | Role |
|---|---|
| `dist/bin/opencode.exe` | the binary to promote into `bin/` |
| `dist/bin/opentui.dll` | must sit NEXT TO the exe at runtime — without it the TUI dies `error 126` |
| `dist/bin/opencode-markdownify.exe` | markdown-rendering sidecar |

**A fresh mtime is not a fresh build.** `stage` writes with `write_bytes`, so every copied artifact carries
the current time. Ask the binary instead:

```text
dist\bin\opencode.exe --version
```

### Under cmd_runner, use ConPTY — not `--raw`

With `--raw`, `bun run script/build.ts` **stalls**: measured 2026-09-30 at **0.11 s of CPU per 20 s of wall
time**, 0 bytes written, while the job wrapper already reported `done` and the run's own `state.json` still
said `running`. The same command under cmd_runner's ConPTY backend completes. Progress is a **CPU delta**
(`(Get-Process bun).CPU` sampled twice), never silence — a stall and a slow build look identical otherwise.

---

## Operator checklist (slow startup)

1. Expect multi-second cost from a **large single binary** alone.  
2. First open of a worktree pays **config + plugin** once (cached per process/dir).  
3. Prefer fewer / no external `plugin_origins` if install is slow.  
4. Large monorepos: watcher native load can overlap; disable only if needed for experiments.  
5. CodeGraph missing DB is noisy on disk but **not** the first-HTTP gate.  
6. Use `OPENCODE_FAST_BOOT=1` only when you accept partial sync readiness.
