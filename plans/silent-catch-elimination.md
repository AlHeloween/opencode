# Silent Catch Elimination — Observable Everything

## Philosophy

Do NOT infer from code whether a catch is "expected" or a "bug." Instrument all catches with at minimum `log.debug()`. Let real-world logs answer which ones need upgrading. A comment is a guess; a log line is a fact.

## Scope

Every `catch {}`, `.catch(() => {})`, `.catch(() => commentOnly)`, and `console.error/warn` in `packages/`. Excludes test files (`*.test.ts`, `*.test.tsx`) and build/CLI scripts (`script/`). Web/console/enterprise packages included since they share code conventions.

---

## Phase 1: Logger-internal catches → `logError()`

**Rationale:** The log system cannot call itself, but empty `.catch(() => {})` is still invisible. Use `logError()` to write to `LoggerErrors.log`.

### files
- `packages/core/src/util/log.ts`

### tasks
1. [ ] Line 78: `fs.appendFile(...).catch(() => {})` → `.catch((e) => logError("appendFile failed", { error: String(e) }))`
2. [ ] Line 103: `fileWrite(msg).catch(() => {})` → `.catch((e) => logError("fileWrite failed", { error: String(e) }))`
3. [ ] Line 125: `fileWrite(msg).catch(() => {})` in reopen → same fix
4. [ ] Line 179: `fs.writeFile(payloadPath, json).catch(() => {})` → same fix

---

## Phase 2: TUI silent catches — prompt subsystem

**Rationale:** Prompt stash/history/frecency are fire-and-forget file writes. Failures are non-critical but must be observable for debugging session restore issues.

### files
- `packages/opencode/src/cli/cmd/tui/component/prompt/stash.tsx`
- `packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx`
- `packages/opencode/src/cli/cmd/tui/component/prompt/frecency.tsx`
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

### tasks
5. [ ] `stash.tsx:42`: `writeFile(...).catch(() => {})` → `.catch((e) => Log.Default.debug("stash write failed", { error: errorMessage(e) }))`
6. [ ] `stash.tsx:69`: same
7. [ ] `stash.tsx:73`: `appendFile(...).catch(() => {})` → `.catch((e) => Log.Default.debug("stash append failed", { error: errorMessage(e) }))`
8. [ ] `stash.tsx:85`: same as 5
9. [ ] `stash.tsx:97`: same as 5
10. [ ] `history.tsx:54`: `writeFile(...).catch(() => {})` → `.catch((e) => Log.Default.debug("history write failed", { error: errorMessage(e) }))`
11. [ ] `history.tsx:100`: same
12. [ ] `history.tsx:104`: `appendFile(...).catch(() => {})` → `.catch((e) => Log.Default.debug("history append failed", { error: errorMessage(e) }))`
13. [ ] `frecency.tsx:57`: `writeFile(...).catch(() => {})` → `.catch((e) => Log.Default.debug("frecency write failed", { error: errorMessage(e) }))`
14. [ ] `frecency.tsx:72`: `appendFile(...).catch(() => {})` → `.catch((e) => Log.Default.debug("frecency append failed", { error: errorMessage(e) }))`
15. [ ] `frecency.tsx:80`: `writeFile(...).catch(() => {})` → same as 13
16. [ ] `index.tsx:843`: `.catch(() => {})` on session.create → `.catch((e) => Log.Default.error("prompt submit failed", { error: errorMessage(e) }))` — this is a CRITICAL path, message submission failure must be logged
17. [ ] `index.tsx:1200`: `.catch(() => {})` on binary paste → `.catch((e) => Log.Default.debug("binary paste failed", { filepath: filepath.slice(0, 100), error: errorMessage(e) }))`

---

## Phase 3: TUI silent catches — context providers

**Rationale:** Context initialization failures (model config, workspace sync, editor polling) impact user experience. Currently swallowed silently.

### files
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`
- `packages/opencode/src/cli/cmd/tui/context/local.tsx`
- `packages/opencode/src/cli/cmd/tui/context/editor.ts`
- `packages/opencode/src/cli/cmd/tui/context/editor-zed.ts`
- `packages/opencode/src/cli/cmd/tui/context/theme.tsx`

### tasks
18. [ ] `sdk.tsx:91`: `.catch(() => {})` on `sync.start()` → `.catch((e) => Log.Default.warn("bug: workspace sync start failed", { error: errorMessage(e) }))`
19. [ ] `sdk.tsx:108`: same → `.catch((e) => Log.Default.warn("bug: event loop failed", { error: errorMessage(e) }))`
20. [ ] `sdk.tsx:119`: same as 18
21. [ ] REMOVED — `sdk.tsx` is only 142 lines, no such pattern exists
22. [ ] `local.tsx:171`: `.catch(() => {})` on model config load → `.catch((e) => Log.Default.warn("bug: model config load failed", { error: errorMessage(e) }))`
23. [ ] `editor.ts:148`: comment-only catch → `.catch(() => { Log.Default.debug("Zed selection poll failed") })`
24. [ ] `editor-zed.ts:45`: `.catch(() => undefined)` on Bun.file read → `.catch((e) => { Log.Default.debug("Zed buffer read failed", { error: errorMessage(e) }); return undefined })`
25. [ ] `theme.tsx:342`: `.catch(() => { setStore("active", "opencode") })` → add `Log.Default.debug("theme resolution failed, falling back")` before fallback
26. [ ] `theme.tsx:369`: same pattern → same fix

---

## Phase 4: TUI silent catches — misc components

### files
- `packages/opencode/src/cli/cmd/tui/ui/link.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

### tasks
27. [ ] `link.tsx:22`: `.catch(() => {})` on `open()` → `.catch((e) => Log.Default.debug("open URL failed", { href: props.href.slice(0, 100), error: errorMessage(e) }))`
28. [ ] `routes/session/index.tsx:410`: clipboard copy error → add `Log.Default.debug("clipboard copy failed", { error })` inside catch
29. [ ] `routes/session/index.tsx:567`: `.catch(() => {})` on session.abort → `.catch((e) => Log.Default.debug("session abort failed", { error: errorMessage(e) }))`
30. [ ] `routes/session/index.tsx:877`: clipboard copy (toast variant) → add `Log.Default.debug("clipboard copy failed", { error })` inside catch

---

## Phase 5: TUI silent catches — app entry

### files
- `packages/opencode/src/cli/cmd/tui/app.tsx`

### tasks
31. [ ] `app.tsx:653`: `.catch(() => {})` on `open("https://opencode.ai/docs")` → `.catch((e) => Log.Default.debug("open docs failed", { error: errorMessage(e) }))`

---

## Phase 6: Server-side silent catches

**Rationale:** These catches swallow errors in critical server paths — session/LLM, provider/gateway, storage. Some are `Effect.die` which crashes without logging. Some return errors silently.

### files
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/provider/gateway/h2-transport.ts`
- `packages/opencode/src/provider/gateway/capability-probe.ts`
- `packages/opencode/src/provider/google-code-assist.ts`
- `packages/opencode/src/storage/db.ts`
- `packages/opencode/src/plugin/index.ts`

### tasks
32. [ ] `session/llm.ts:258`: tool execution catch → add `Log.Default.warn("bug: tool execution failed", { error: errorMessage(e) })` before returning error result
33. [ ] `session/prompt.ts:276`: `Effect.die` on ensureDir → change to log then die: `.pipe(Effect.tapError((e) => Effect.sync(() => Log.Default.warn("bug: ensureDir failed", { path: plan, error: errorMessage(e) }))).pipe(Effect.catch(Effect.die)))` — or if Effect.die is acceptable, add `.pipe(Effect.tapError(...))` before it
34. [ ] `session/prompt.ts:1167`: `Effect.die` on readFile → same pattern: log then die. Log as `warn("bug: readFile for base64 failed", { filepath, error })`
35. [ ] `provider/gateway/h2-transport.ts:341`: silent catch with `req.destroy()` → add `log.warn("bug: h2 stream write failed", { error: errorMessage(e) })` before destroy
36. [ ] `provider/gateway/capability-probe.ts:91`: outer probe catch returns error in result but never logs → add `log.warn("bug: ALPN capability probe failed", { error: errorMessage(err) })` before return
37. [ ] `provider/google-code-assist.ts:284`: stream error pushed to controller but never logged → add `log.warn("bug: GCA stream failed", { error: errorMessage(error) })` before `controller.error(error)`
38. [ ] `storage/db.ts:326`: already has `log.debug("using default db", { caller: "use" })` — SKIP, already logged
39. [ ] `storage/db.ts:380`: already has `log.debug("using default db", { caller: "transaction" })` — SKIP, already logged
40. [ ] `plugin/index.ts:221`: `Effect.void` with TODO → `log.warn("bug: plugin load failed", { id, error: errorMessage(e) })` then `Effect.void`

---

## Phase 7: `console.error` / `console.warn` → Log in opencode core

**Rationale:** `console.*` bypasses the log system. All runtime error output must go through `Log` or `logError`. This phase covers `packages/opencode/src/` and `packages/core/src/`. Script files (`script/`) kept as-is since they are CLI scripts writing to stderr intentionally.

### files
- `packages/opencode/src/util/fn.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- `packages/opencode/src/cli/cmd/run.ts`
- `packages/opencode/src/cli/cmd/github.ts`
- `packages/opencode/src/cli/cmd/agent.ts`
- `packages/opencode/src/storage/db.ts` (if any remaining)

### tasks
41. [ ] `util/fn.ts:11`: `console.error("schema validation issues:", ...)` → `Log.Default.warn("bug: schema validation issues", { errors })` — need to import Log
42. [ ] `cli/cmd/tui/plugin/runtime.ts:92`: duplicate `console.error` after `log.error` → remove `console.error`, keep `log.error`
43. [ ] `cli/cmd/tui/plugin/runtime.ts:99`: same → remove `console.error`, keep `log.error`
44. [ ] `cli/cmd/tui/plugin/runtime.ts:104`: same → remove `console.warn`, keep `log.warn`
45. [ ] `cli/cmd/run.ts:617`: `console.error(e)` → `Log.Default.warn("bug: run command failed", { error: errorMessage(e) })` — need to import Log (may already be imported)
46. [ ] `cli/cmd/github.ts:691`: `console.error(...)` → `Log.Default.warn("bug: github command failed", { error })`
47. [ ] `cli/cmd/github.ts:856`: `console.error(\`Failed to download image: ${url}\`)` → `Log.Default.warn("bug: image download failed", { url })`
48. [ ] `cli/cmd/github.ts:985`: `console.error("Agent error:", err)` → `Log.Default.warn("bug: github agent error", { error: errorMessage(err) })`
49. [ ] `cli/cmd/github.ts:1015`: same pattern
50. [ ] `cli/cmd/github.ts:1032`: `console.error("Failed to get OIDC token...")` → `Log.Default.warn("bug: OIDC token failed", { error })`
51. [ ] `cli/cmd/github.ts:1225`: `console.error(\`Failed to check permissions: ${error}\`)` → `Log.Default.warn("bug: permission check failed", { error })`
52. [ ] `cli/cmd/agent.ts:214`: `console.error(\`Error: Agent file already exists...\`)` → `Log.Default.error("agent: file already exists", { filePath })`

---

## Phase 8: `console.error/warn` → Log in downstream packages

**Rationale:** `packages/app/`, `packages/desktop-electron/`, `packages/desktop/`, `packages/console/`, `packages/web/`, `packages/enterprise/`, `packages/function/`, `packages/slack/` all have `console.error/warn` calls and silent catches. Fix systematically.

### `packages/app/` — `console.error/warn`
53. [ ] `app/src/context/terminal.tsx:205,218,269,339` — 4× `console.error("Failed to ... terminal", error)` → `Log.error(...)`
54. [ ] `app/src/context/global-sync.tsx:261` — `console.error("Failed to load sessions", err)` → `Log.error(...)`
55. [ ] `app/src/context/global-sdk.tsx:146,188` — 2× `console.error("[global-sdk] event stream ...")` → `Log.error(...)`
56. [ ] `app/src/context/command.tsx:264` — `console.warn("[command] duplicate...")` (guarded by `import.meta.env.DEV`) → `log.debug(...)` or keep as-is for dev-only debug
57. [ ] `app/src/pages/session/message-timeline.tsx:390,397` — 2× `console.error("Failed to ...share session", err)` → `Log.error(...)`
58. [ ] `app/src/context/global-sync/child-store.ts:129` — `console.error("No directory provided")` → `Log.error(...)`
59. [ ] `app/src/context/global-sync/bootstrap.ts:370` — `console.error("Failed to finish bootstrap...")` → `Log.error(...)`
60. [ ] `app/src/utils/notification-click.ts:11` — `console.warn("notification-click: navigate...")` → `log.debug(...)` (expected state, not an error)
61. [ ] `app/src/utils/server-health.ts:35` — empty `catch {}` on `AbortSignal.timeout()` → `log.debug("server health check failed")`

### `packages/app/` — silent catches (non-logging body)
62. [ ] `app/src/context/layout.tsx:517` — `.catch(...)` without log (only `colorRequested.delete`) → add `Log.Default.debug("project.update color failed")`
63. [ ] `app/src/context/permission.tsx:121` — `.catch(...)` without log (only `responded.delete`) → add `Log.Default.debug("permission.respond failed")`
64. [ ] `app/src/pages/layout.tsx:1637` — `.catch(...)` without log (sets error state) → add `Log.Default.debug("file.status failed")`
65. [ ] `app/src/pages/layout.tsx:1706` — same pattern → check and fix
66. [ ] `app/src/components/prompt-input/submit.ts:246` — `.catch(() => {})` on session.abort → `Log.Default.debug("session abort failed")`
67. [ ] `app/src/pages/session/use-session-commands.tsx:294` — `.catch(() => {})` on session.abort → `Log.Default.debug("session abort failed")`
68. [ ] `app/src/pages/session.tsx:1621` — `.catch(() => {})` on session.abort → `Log.Default.debug("session abort failed")`

### `packages/desktop-electron/`
69. [ ] `desktop-electron/src/main/index.ts:17` — empty `catch {}` on `process.chdir(homedir())` → `log.debug("chdir failed")`
70. [ ] `desktop-electron/src/main/shell-env.ts:69` — `console.warn("[server] Interactive shell env...")` → `Log.Default.warn("shell env probe timeout")`
71. [ ] `desktop-electron/src/main/shell-env.ts:79` — `console.warn("[server] Falling back to app environment...")` → `Log.Default.warn("shell env fallback")`

### `packages/desktop/`
72. [ ] `desktop/src/index.tsx:188` — silent fallback on `Store.load()` → add `Log.Default.debug("store load failed, using memory store")` before fallback

### `packages/console/`
73. [ ] `console/core/src/billing.ts:122` — `console.error(e)` → `Log.error(...)`
74. [ ] `console/core/src/user.ts:156` — `console.error(e)` → `Log.error(...)`
75. [ ] `console/app/src/routes/api/enterprise.ts:49,55,97,108,117,120,126` — 7× `console.error/warn(...)` → `Log.error/warn(...)`
76. [ ] `console/app/src/lib/salesforce.ts:19,25,31,70,76` — 5× `console.error(...)` → `Log.error(...)`
77. [ ] `console/app/src/lib/github.ts:35` — `console.error(e)` → `Log.error(...)`
78. [ ] `console/app/src/component/spotlight.tsx:510,518,537,730` — 4× `console.warn(...)` WebGPU → `Log.Default.debug(...)` or keep as browser dev hints
79. [ ] `console/app/src/component/header.tsx:34,108,119` — 3× `console.error(...)` → `Log.error(...)`
80. [ ] `console/app/src/routes/enterprise/index.tsx:64` — `console.error(...)` → `Log.error(...)`
81. [ ] `console/app/src/routes/brand/index.tsx:52` — `console.error(...)` → `Log.error(...)`
82. [ ] `console/app/src/routes/zen/index.tsx:27` — `.catch(() => {})` on getLastSeenWorkspaceID → `Log.Default.debug("getLastSeenWorkspaceID failed")`
83. [ ] `console/app/src/routes/zen/util/handler.ts:360` — empty `catch {}` on `logger.metric()` → `log.debug("metric failed")`
84. [ ] REMOVED — no `.catch(() => emptyConsoleState)` pattern exists in this file. Line 374 is inside a `Response` constructor.

### `packages/web/`
85. [ ] `web/src/components/share/part.tsx:69` — `console.error("Copy failed", err)` → `Log.error(...)`
86. [ ] `web/src/components/share/copy-button.tsx:16` — `console.error("Copy failed", err)` → `Log.error(...)`
87. [ ] `web/src/components/share/common.tsx:65` — `console.error("Copy failed", err)` → `Log.error(...)`
88. [ ] `web/src/components/Share.tsx:90,145,151` — 3× `console.error(...)` → `Log.error(...)`
89. [ ] `web/src/components/share/content-diff.tsx:105` — `console.error("Failed to parse patch:", error)` → `Log.error(...)`

### `packages/enterprise/`
90. [ ] `enterprise/src/routes/share/[shareID].tsx:128` — `console.error(error)` → `Log.error(...)`

### `packages/function/`
91. [ ] `function/src/api.ts:252,283` — 2× `console.error(...)` → `Log.error(...)`

### Other packages
92. [ ] `packages/slack/src/index.ts:50` — `.catch(() => {})` on chat.postMessage → `log.debug("slack postMessage failed")`
93. [ ] `packages/ui/src/pierre/selection-bridge.ts:78` — empty `catch {}` on selection operations → `log.debug("selection operation failed")`
94. [ ] `packages/ui/src/pierre/media.ts:91` — empty `catch {}` on atob fallback → `log.debug("atob decode failed")`
95. [ ] `packages/ui/src/theme/context.tsx:101,108` — 2× empty `catch {}` on localStorage → `log.debug("localStorage write/remove failed")`

---

## Phase 9: Downstream package `.catch()` with non-empty non-logging body

These catches have some body logic (setting state, deleting from maps) but no log call.

### files
- Various across `packages/app/`, `packages/desktop/`

### tasks
96. [ ] `app/src/context/layout.tsx:517` — add `Log.Default.debug(...)` before existing body
97. [ ] `app/src/context/permission.tsx:121` — add `Log.Default.debug(...)` before existing body
98. [ ] `app/src/pages/layout.tsx:1637` — add `Log.Default.debug(...)` before existing body
99. [ ] `desktop/src/index.tsx:188` — add `Log.Default.debug(...)` before fallback
100. [ ] Check line 1706 in `app/src/pages/layout.tsx` — verify and fix

---

## Phase 10: Build and verify

### tasks
101. [ ] Run `bun typecheck` from `packages/opencode/` — fix any import issues
102. [ ] Run `bun typecheck` from `packages/app/` (if applicable)
103. [ ] Verify all `import { Log }` or `import * as Log` lines are present where needed
104. [ ] Build opencode binary: `pwsh _build.ps1`
105. [ ] Launch from `dist/bin/`, interact with TUI, run typical operations
106. [ ] Tail logs: `rg -nu 'bug:|error|ERROR|warn' .opencode/data/log`
107. [ ] Verify `LoggerErrors.log` works — induce a log error (trigger a payload write failure)
108. [ ] Review the produced logs to classify which debug calls should be upgraded to warn/error

---

## Verification Checklist

After complete, run against the full codebase:

```bash
# Zero empty catch blocks (excluding scripts and tests)
rg -nu 'catch \{\s*\}' packages/ | rg -v 'script/' | rg -v '\.test\.'

# Zero .catch(() => {}) (excluding scripts, tests, and logError internal)
rg -nu '\.catch\(\(\) => \{\s*\}' packages/ | rg -v 'script/' | rg -v '\.test\.' | rg -v 'logError'

# Zero console.error/warn in source (excluding scripts, tests, and stories)
rg -nu 'console\.(error|warn)\(' packages/ | rg -v 'script/' | rg -v '\.test\.' | rg -v '\.stories\.' | rg -v '\.bak$'

# Verify logError calls exist in log.ts internal catches
rg -n 'logError' packages/core/src/util/log.ts
```
