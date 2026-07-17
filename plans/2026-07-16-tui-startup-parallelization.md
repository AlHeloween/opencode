# TUI Startup Parallelization Plan — 2026-07-16

**Status:** Phase 1 largely implemented; Phase 2–3 optional
**Goal:** Reduce TUI cold-start time by parallelizing blocking boot-path operations.

### Landed

| Step | Status |
|------|--------|
| 1.1 Plugin theme sync parallel (`Promise.allSettled`) + sequential activate | Done |
| 1.3 Config load overlapped with worker / transport | Done — starts immediately after `chdir` |
| 1.4 `import("./app")` preload early | Done |
| 1.2 Session list parallel with project.sync | **Blocked** — `session.list` needs `project.sync()` worktrees; kept chained |
| 2.3 Theme mode wait 1000→400ms | Done |

### Still open

| Step | Notes |
|------|--------|
| 2.1 Plugin pre-flight cache | Optional |
| 2.2 Config file cache | Optional |
| 2.4 Lazy non-critical providers | Optional |
| 3.1 Critical vs deferred bootstrap | Partial already (`status: partial` then deferred LSP/MCP) |
| 3.2 Stream sessions as they arrive | Optional |

---

## Current State

The TUI startup is a **serial pipeline** from entry to first render:

```
thread.ts                     app.tsx                    runtime.ts
─────────                     ───────                    ──────────
1. resolveDxcDlls()
2. new Worker()     ──────►   worker.ts init
3. TuiConfig.get()             (server, log, heap)
4. validateSession()
5. import("./app")  ──────►   6. createCliRenderer()
                              7. waitForThemeMode(1s)
                              8. render(<Providers>)
                                 ├─ KVProvider (kv.json)
                                 ├─ SDKProvider (client + SSE)
                                 ├─ ProjectProvider
                                 ├─ SyncProvider (bootstrap)
                                 ├─ ThemeProvider
                                 ├─ LocalProvider (model.json)
                                 └─ EditorContext
                              9. TuiPluginRuntime.init() ─► load()
                                                              ├─ internal plugins (9)
                                                              ├─ resolveExternalPlugins()
                                                              │   └─ npm install per plugin
                                                              └─ activatePluginEntry() ← SEQUENTIAL
                                                                  for each plugin:
                                                                    await plugin.plugin(api)
                              10. setReady(true) → loading screen dismiss
```

Total serialized stages: **10**. Each waits for all previous stages.

---

## Bottlenecks (Ranked)

| # | File:Line | What | Why Slow |
|---|-----------|------|----------|
| 1 | `runtime.ts:1021` | Sequential plugin activation | Each external plugin `await`ed before next starts. If plugin X does 500ms of network I/O, plugin Y and Z wait. |
| 2 | `thread.ts:148` | Worker spawn + serial pipeline after | `new Worker()` is synchronous constructor, then `TuiConfig.get()`, `validateSession()`, `import()` all run sequentially after — no overlap. |
| 3 | `thread.ts:231` | `import("./app")` | 70+ ES module imports resolved + parsed before render can start. |
| 4 | `app.tsx:152` | `createCliRenderer()` | Terminal protocol negotiation, graphics capability detection. |
| 5 | `thread.ts:192` | `TuiConfig.get()` | Multi-directory config reads + potential `npm install` for plugin deps. |
| 6 | `sync.tsx:617` | Session list chained on project sync | `projectPromise.then(() => sessionList)` — unnecessary serialization. |
| 7 | `app.tsx:153` | `waitForThemeMode(1000)` | 1s timeout for OSC response from terminal. |

---

## Phase 1 — Safe Parallelization (low risk, high reward)

### 1.1 Parallel Plugin Activation

**File:** `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts:1021-1028`

**Current:**
```ts
for (const next of entries) {
  await activatePluginEntry(next, plugin, false)
}
```

**Proposed:**
```ts
// Activate all plugins concurrently
const results = await Promise.allSettled(
  entries.map((next) => activatePluginEntry(next, plugin, false))
)
// Report failures without blocking others
for (let i = 0; i < results.length; i++) {
  if (results[i].status === "rejected") {
    Log.Default.warn("bug: plugin activation failed", {
      plugin: entries[i].name,
      error: String(results[i].reason),
    })
  }
}
```

**Determinism concern:** The comment says "Keep plugin execution sequential for deterministic side effects: command registration order affects keybind/command precedence, route registration is last-wins when ids collide, and hook chains rely on stable plugin ordering."

**Resolution:** Merge results in original order after all complete. The `activatePluginEntry` function can split into:
1. `preparePluginEntry()` — async init (network, file I/O) — **parallelizable**
2. `applyPluginEntry()` — register commands/routes/hooks — **must stay ordered**

**Estimated savings:** 40–70% of plugin load time (typically 1–3s for multi-plugin setups)

---

### 1.2 Decouple Session List from Project Sync

**File:** `packages/opencode/src/cli/cmd/tui/context/sync.tsx:617`

**Current:**
```ts
const projectPromise = project.sync()
const sessionListPromise = projectPromise.then(() => sdk.client.session.list({ workspace }))
```

**Proposed:**
```ts
const projectPromise = project.sync()
// Fire session list in parallel — it needs workspace from the store, not from project.sync() result
const workspace = project.workspace.current()
const sessionListPromise = sdk.client.session.list({ workspace })
// Use Promise.all to wait for both
await Promise.all([projectPromise, sessionListPromise])
```

If `session.list` truly depends on `project.sync()` having completed (e.g., workspace path resolution), keep the chain but start `project.sync()` earlier in the bootstrap flow (before the other 5 parallel requests).

**Estimated savings:** ~100–500ms (the project.sync() duration)

---

### 1.3 Start Config Load Before Worker Spawn

**File:** `packages/opencode/src/cli/cmd/tui/thread.ts:148,192`

**Current:** Config loads AFTER worker spawn.

**Proposed:** Start config load in parallel with worker spawn since they have no dependency on each other:

```ts
const [, config] = await Promise.all([
  (async () => { worker = new Worker(file, { env }) })(),
  TuiConfig.get(),
])
```

**Estimated savings:** ~200–800ms (config file reads + npm install run concurrently with worker bootstrap)

---

### 1.4 Preload App Module During Worker Spawn

**File:** `packages/opencode/src/cli/cmd/tui/thread.ts:148,231`

**Current:** `import("./app")` happens AFTER worker spawn + config load + session validation.

**Proposed:** Start the dynamic import earlier — it has no dependency on the worker or config:

```ts
// Start module load in background immediately
const appModulePromise = import("./app")

// ... worker spawn, config load, session validate in parallel ...

// Then await everything
const app = await appModulePromise
```

**Estimated savings:** ~500–1000ms (module resolution overlapped with network + process spawn)

---

## Phase 2 — Structural Improvements (medium risk, medium reward)

### 2.1 Plugin Pre-flight Cache

**File:** `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts:600-700`

Cache the results of `resolveExternalPlugins()` (npm install + compatibility check + entrypoint detection). On subsequent cold starts, skip resolution for plugins whose package.json hasn't changed. Store cache in `.opencode/data/cache/plugins.json`.

**Estimated savings:** ~500–2000ms on second+ cold start

---

### 2.2 Config File Cache

**File:** `packages/opencode/src/cli/cmd/tui/thread.ts:192`

Cache merged TUI config. Invalidate on mtime changes of source config files. Avoid reading + merging multi-directory configs on every cold start.

**Estimated savings:** ~50–200ms per cold start

---

### 2.3 Theme Mode Detection Timeout Reduction

**File:** `packages/opencode/src/cli/cmd/tui/app.tsx:153`

**Current:** `renderer.waitForThemeMode(1000)` — 1 second timeout.

**Proposed:** Reduce to 500ms. Most terminals respond to OSC theme queries within 100–200ms. A 1s timeout means every fast terminal still waits the full 500ms+ for the slowest case.

**Estimated savings:** 200–500ms (change from 1000ms to 300ms with 300ms as reasonable worst-case)

---

### 2.4 Lazy-load Non-critical Providers

**File:** `packages/opencode/src/cli/cmd/tui/app.tsx:159-222`

Some providers don't need to be initialized before the first render:
- `FrecencyProvider` — only needed when user opens command palette
- `PromptHistoryProvider` — only needed when user types in prompt
- `CommandProvider` — only needed when command palette opened
- `EditorContextProvider` — only needed when editor/LSP panel opened

Move these to lazy initialization (mount on first use rather than at app root).

**Estimated savings:** ~50–150ms

---

## Phase 3 — Pipeline Restructure (higher risk, lower reward per change)

### 3.1 Split `bootstrap()` into Critical + Deferred

**File:** `packages/opencode/src/cli/cmd/tui/context/sync.tsx:638-700`

Only 6 requests are needed for the UI to be functional (providers, agents, config, project, sessions). The other 10 (LSP status, MCP status, formatters, VCS, etc.) can load after the first render. Split into:

```ts
const critical = Promise.all([providers, agents, config, project, sessions])
await critical
setStore("status", "ready")  // ← UI renders here

const deferred = Promise.all([lsp, mcp, formatters, vcs, ...])
await deferred
setStore("status", "complete")  // ← panels populate here
```

This way the session list and prompt are interactive while LSP/MCP status loads in background.

**Estimated savings:** UI interactive 500–1500ms sooner (though total load unchanged)

---

### 3.2 Stream Sessions as They Arrive

**File:** `packages/opencode/src/cli/cmd/tui/context/sync.tsx:676`

**Current:** `sessionListPromise` collects ALL sessions before setting `store.session`.

**Proposed:** As each session arrives from the API, insert it into the store immediately (pagination / streaming). User sees sessions populate progressively rather than waiting for the full list.

**Estimated savings:** Perceived load time drops from "total" to "time to first session" (~50–200ms vs ~500–2000ms)

---

## Implementation Order

| Step | File | Risk | Reward | Dependencies |
|------|------|------|--------|-------------|
| 1.1 | `runtime.ts` | Low | High | None |
| 1.3 | `thread.ts` | Low | Medium | None |
| 1.4 | `thread.ts` | Low | Medium | None |
| 1.2 | `sync.tsx` | Low | Medium | None |
| 2.3 | `app.tsx` | Low | Low | None |
| 3.1 | `sync.tsx` | Medium | Medium | None |
| 2.1 | `runtime.ts` | Medium | High | 1.1 |
| 2.2 | `thread.ts` | Medium | Low | None |
| 2.4 | `app.tsx` | Medium | Low | None |
| 3.2 | `sync.tsx` | Medium | Medium | 3.1 |

---

## Rollback Plan

Each step is independent. Revert any failing step by reverting the specific commit. No cross-step coupling.

---

## Verification

After each phase:
1. `bun run typecheck` from `packages/opencode`
2. Cold start TUI: `opencode.exe` — measure time to prompt-ready
3. Verify plugin functionality: commands register, hooks fire, routes resolve
4. Verify session list populates correctly
5. Verify theme detection works
