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
| `Project.persistDiscovery` | Yes | Upsert project row / session migration |
| `Log.reopen` | Yes | Worktree log directory |

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

- If `.codegraph/codegraph.db` exists → return immediately  
- Else spawn `codegraph init` (unref) or create empty SQLite schema  
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

Three different systems — easy to confuse:

| System | Backend | Role |
|--------|---------|------|
| **Snapshot (agent undo / “Modified Files”)** | **Fossil only** (`snapshot/fossil.ts`) | Sidecar repo `{data}/fossil/{projectID}/snapshot.fsl`; track/diff/restore. Honors `.gitignore` via Fossil ignore-glob. |
| **Project VCS** (`project/vcs.ts`) | **Git** (when `project.vcs === "git"`) | Branch name, agent git-facing diffs — **source control**, not undo DB. |
| **TUI footer indicator** | Detects `.jj` / `_FOSSIL_` / `.git` | Display only (jj blue, fossil green, git red). No jj snapshot backend. |

There is **no** git/jj snapshot layer in this fork. `Snapshot.Service` dies unless `SnapshotFossil.defaultLayer` is provided.

Fossil snapshot deliberately ignores packing `.git`, `.jj`, and Fossil checkout markers into the sidecar.

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
| `packages/opencode/src/project/bootstrap.ts` | `InstanceBootstrap` |
| `packages/opencode/src/plugin/index.ts` | Plugin state + internal plugins |
| `packages/opencode/src/snapshot/fossil.ts` | Fossil snapshot backend |
| `packages/opencode/src/project/vcs.ts` | Project git VCS |
| `packages/opencode/src/shell/shell.ts` | `permissionKey` for shell tools |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx` | TUI `bootstrap()` + `ready` / `OPENCODE_FAST_BOOT` |

---

## Operator checklist (slow startup)

1. Expect multi-second cost from a **large single binary** alone.  
2. First open of a worktree pays **config + plugin** once (cached per process/dir).  
3. Prefer fewer / no external `plugin_origins` if install is slow.  
4. Large monorepos: watcher native load can overlap; disable only if needed for experiments.  
5. CodeGraph missing DB is noisy on disk but **not** the first-HTTP gate.  
6. Use `OPENCODE_FAST_BOOT=1` only when you accept partial sync readiness.
