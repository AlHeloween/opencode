# Fix: Make Global data paths worktree-relative

## Problem

`Global.Path.data`, `Global.Path.log`, `Global.Path.cache`, `Global.Path.state`, and `Global.Path.bin` all default to `{exeDir}/.opencode/data/` (next to the executable) at module load time. `Global.initFromWorktree()` exists but is **never called** anywhere in the codebase — it's dead code.

Consequence: if you copy `opencode.exe` to a different project, all data stored at `Global.Path.*` (snapshots, session diffs, state, cache, logs) is lost or mixed between projects.

### Current state (verified)

Executable is at `D:\zPython\opencode\bin\opencode.exe`. Data exists at `bin\.opencode\data\`:
- `opencode.db` — global DB
- `cache/models.json`
- `log/2026-05-14T132026.log`, `2026-05-14T132028.log`
- `snapshot/<hash>/` — git snapshots
- `state/model.json`, `state/plugin-meta.json`, `state/prompt-history.jsonl`, `state/locks/`
- `storage/session_diff/ses_*.json`

The project DB at `{worktree}/.opencode/data/opencode.db` works correctly because `getProjectDbPath(worktree)` constructs the path directly from the worktree parameter. But everything using `Global.Path.data` directly goes to the wrong place.

## Root Cause

`packages/core/src/global.ts:11-16` — defaults all paths to `exeDir`-relative.

`packages/core/src/global.ts:20-29` — `initFromWorktree()` defined but **zero call sites** in entire codebase.

### Why the project DB still works

`packages/opencode/src/storage/db.ts:33-35` — `getProjectDbPath(worktree)` constructs path from `worktree` parameter, bypassing `Global.Path.data`.

### Components writing to `Global.Path.data` directly (all broken)

| Component | File:Line | What's stored |
|-----------|-----------|---------------|
| Edit backups | `tool/edit.ts:39` | Backup files |
| Truncation output | `tool/truncation-dir.ts:4` | Tool output files |
| Storage | `storage/storage.ts:45` | Session diff storage |
| Snapshots | `snapshot/index.ts:86` | Git snapshot repos |
| Plans dir | `session/session.ts:305` | Plan documents |
| Worktree root | `worktree/index.ts:217` | Worktree metadata |
| Gateway store | `provider/gateway/store.ts:38,152,208,246` | Gateway data |
| Gateway log | `provider/gateway/mod.ts:72` | Gateway logs |
| Adaptive client | `provider/gateway/adaptive-client.ts:26` | Gateway logs |
| LSP temp | `lsp/server.ts:1270` | LSP temp data |
| Global DB fallback | `storage/db.ts:327,379` | Fallback DB |

## Fix Plan

### 1. `packages/core/src/global.ts` — Remove `_initialized` guard

Remove the `_initialized` variable and guard from `initFromWorktree()` so it can be called each time the worktree changes (needed for server mode with multiple projects):

- Remove line 18: `let _initialized = false`
- Remove line 21: `if (_initialized) return`
- Remove line 28: `_initialized = true`

### 2. `packages/core/src/util/log.ts` — Add `Log.reopen()` function

Add a function to re-create the log file at the current `Global.Path.log`:

```ts
export async function reopen(dev?: boolean) {
  // If writing to stderr (print mode or before init), do nothing
  if (write === _stderr) return
  // Close current stream and create new one at current Global.Path.log
  logpath = path.join(
    Global.Path.log,
    dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
  )
  mkdirSync(Global.Path.log, { recursive: true })
  const stream = createWriteStream(logpath, { flags: "a" })
  write = async (msg: any) => {
    return new Promise((resolve, reject) => {
      stream.write(msg, (err) => {
        if (err) reject(err)
        else resolve(msg.length)
      })
    })
  }
}
```

Also extract the stderr writer to a named const so `reopen` can check for it:
```ts
const _stderr = (msg: any) => {
  process.stderr.write(msg)
  return msg.length
}
let write = _stderr
```

### 3. `packages/opencode/src/project/instance.ts` — Call `initFromWorktree` + `Log.reopen` in `boot()`

Add imports and insert calls inside `boot()` after worktree resolution but before `context.provide()`:

- Add import: `import { Global } from "@opencode-ai/core/global"` (note: `Log` already imported at line 6)
- Add import: `import { Installation } from "@/installation"`

Inside `boot()`, between line 40 (`}))` closing the ternary) and line 41 (`await context.provide(ctx, ...)`):

```ts
Global.initFromWorktree(ctx.worktree)
await Log.reopen(Installation.isLocal())
```

### 4. Fix module-level constants that capture stale `Global.Path.data`

Three files capture `Global.Path.data` at **module import time** (before `boot()` runs). These constants never update after `initFromWorktree()` is called.

#### 4a. `packages/opencode/src/tool/truncation-dir.ts` — Convert to getter

Line 4: `export const TRUNCATION_DIR = path.join(Global.Path.data, "tool-output")`

Replace with a getter function so the value is resolved lazily (at call time, after boot() has run):

```ts
export function truncationDir() {
  return path.join(Global.Path.data, "tool-output")
}
```

#### 4b. `packages/opencode/src/tool/truncate.ts` — Update to use getter

Lines 11, 18, 19, 59, 65, 70, 71 reference `TRUNCATION_DIR` as a const. Update:

- Import: `import { truncationDir } from "./truncation-dir"` (replaces `import { TRUNCATION_DIR } from "./truncation-dir"`)
- Replace `TRUNCATION_DIR` with `truncationDir()` at each usage site (lines 59, 65, 70, 71)
- Replace module-level `DIR` and `GLOB` consts (lines 18-19) with getter functions:
  ```ts
  export function truncateDir() { return truncationDir() }
  export function truncateGlob() { return path.join(truncationDir(), "*") }
  ```
- Update all external consumers of `Truncate.DIR` and `Truncate.GLOB`:
  - `agent/agent.ts:84` — `Truncate.GLOB` → `Truncate.truncateGlob()`
  - `agent/agent.ts:271` — `Truncate.GLOB` → `Truncate.truncateGlob()`
  - `agent/agent.ts:277` — `[Truncate.GLOB]` → `[Truncate.truncateGlob()]`
  - Search for any other usages of `Truncate.DIR` or `Truncate.GLOB`

#### 4c. `packages/opencode/src/provider/gateway/store.ts` — Move paths inside init function

Lines 38-39: `policyLogDir` and `policyLogPath` are module-level consts used only in `initPolicyLogger()` (line 42). Move them inside the function:

```ts
// Remove lines 38-39 (module-level consts)

function initPolicyLogger() {
  if (!policyLogger) {
    try {
      const policyLogDir = path.join(Global.Path.data, "gateway")
      const policyLogPath = path.join(policyLogDir, POLICY_LOG_FILE)
      fsSync.mkdirSync(policyLogDir, { recursive: true })
      policyLogger = makeAsyncLogger({ path: policyLogPath, maxBuffer: 2000, intervalMs: 200 })
    } catch {
      // ...
    }
  }
}
```

#### 4d. `packages/opencode/src/provider/gateway/adaptive-client.ts` — Move paths inside init functions

Lines 26-28: `logDir`, `logFilePath`, `errorLogFilePath` are module-level consts used in logger init functions (lines 96-107). Move inside the init functions, keeping the `OPENCODE_GATEWAY_LOG_DIR` env var check.

```ts
// Remove lines 26-28 (module-level consts)

// In each init function, replace with:
const logDir = process.env.OPENCODE_GATEWAY_LOG_DIR || path.join(Global.Path.data, "gateway")
```

## Verification

After the fix:
- `Global.Path.data` → `{worktree}/.opencode/data` (was `{exeDir}/.opencode/data`)
- `Global.Path.log` → `{worktree}/.opencode/data/log`
- `Global.Path.cache` → `{worktree}/.opencode/data/cache`
- `Global.Path.state` → `{worktree}/.opencode/data/state`
- `Global.Path.bin` → `{worktree}/.opencode/data/cache/bin`
- `Global.Path.config` → `exeDir` (unchanged, intentional — shared auth/config)
- `Global.Path.home` → `worktree` (unchanged)

## What does NOT change

- `Global.Path.config` stays at `exeDir` — shared config (auth.json, gateway.jsonc, tui.json) should remain global
- `Flock.setGlobal` at module load time uses `exeDir` — global locks across all projects
- Log entries written before `boot()` runs (in yargs middleware) go to exe-adjacent log — acceptable minimal loss
