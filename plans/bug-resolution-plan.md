# Bug Resolution Plan

## Status: Active

60 unique `"bug:"` messages across 22 files, collected via `bugReport()` and printed to stderr on exit.

---

## Active Bugs (observed in logs)

### 1. `bug: upgrade check failed` (fired)
- **Source**: `worker.ts:84` → `upgrade.ts:27`
- **Cause**: `Installation.getReleaseType()` throws `TypeError: Invalid Version` for dev builds (`0.0.0-Local_Development-*`)
- **Fix**: Wrap `getReleaseType` in try/catch; skip upgrade when version unparseable

---

## Bug Inventory by Category

### A: Guard invalid inputs (1 item)
| Bug | File | Fix |
|-----|------|-----|
| `bug: upgrade check failed` | `worker.ts:84` / `upgrade.ts:27` | Skip when semver unparseable |

### B: Exit/shutdown cleanup — informational (5)
| Bug | File | Notes |
|-----|------|-------|
| `bug: writer abort failed` | `h2-transport.ts:371` | Stream abort on cancel |
| `bug: mcp process kill failed` | `mcp/index.ts:523` | process.kill on shutdown |
| `bug: pty process kill failed` | `pty/index.ts:128` | process.kill on shutdown |
| `bug: pty subscriber close failed` | `pty/index.ts:134` | WebSocket close |
| `bug: failed to close file handle` | `async-logger.ts:43` | File handle cleanup |

### C: OS-specific fs operations — platform-guarded already (8)
| Bug | File | Notes |
|-----|------|-------|
| `bug: chmod zls binary failed` | `lsp/server.ts:689` | `if platform !== "win32"` guard |
| `bug: chmod clangd binary failed` | `lsp/server.ts:1095` | Same guard |
| `bug: unlink clangd symlink failed` | `lsp/server.ts:1098` | Could use `{ force: true }` |
| `bug: symlink clangd binary failed` | `lsp/server.ts:1099` | Check source exists first |
| `bug: chmod kotlin launcher script failed` | `lsp/server.ts:1380` | Guarded |
| `bug: chmod terraform-ls binary failed` | `lsp/server.ts:1734` | Guarded |
| `bug: chmod texlab binary failed` | `lsp/server.ts:1828` | Guarded |
| `bug: chmod tinymist binary failed` | `lsp/server.ts:2018` | Guarded |

### D: External tool failures — informational (9)
| Bug | File | Notes |
|-----|------|-------|
| `bug: wl-copy process exited with error` | `clipboard.ts:133` | User clipboard tool |
| `bug: xclip process exited with error` | `clipboard.ts:147` | User clipboard tool |
| `bug: xsel process exited with error` | `clipboard.ts:161` | User clipboard tool |
| `bug: powershell clipboard process exited with error` | `clipboard.ts:188` | User clipboard tool |
| `bug: clipboardy.read failed` | `clipboard.ts:107` | Clipboardy npm package |
| `bug: clipboardy.write failed` | `clipboard.ts:195` | Clipboardy npm package |
| `bug: failed to open browser to localhost` | `web.ts:71` | `open()` npm package |
| `bug: failed to open browser to display URL` | `web.ts:75` | `open()` npm package |
| `bug: debug server health check failed, retrying` | `debug-workspace-plugin.ts:21` | Dev mode probe |

### E: Resource cleanup — informational (9)
| Bug | File | Notes |
|-----|------|-------|
| `bug: failed to remove clipboard temp file` | `clipboard.ts:73` | tmp cleanup |
| `bug: failed to unlink rotated log file` | `log-rotator.ts:83` | Log rotation |
| `bug: failed to truncate log file [core/log]` | `log.ts:69` | Log init |
| `bug: failed to scan log files during cleanup [core/log]` | `log.ts:107` | Log cleanup |
| `bug: failed to unlink old log file [core/log]` | `log.ts:113` | Log cleanup |
| `bug: failed to create gateway data directory` | `store.ts:246` | Gateway init |
| `bug: failed to flush log entries` | `async-logger.ts:58` | Async logger |
| `bug: failed to trim log file` | `async-logger.ts:45` | Log rotation |
| `bug: failed to unsubscribe file watcher` | `watcher.ts:115` | Cleanup |

### F: Network/protocol — informational (3)
| Bug | File | Notes |
|-----|------|-------|
| `bug: h2 session creation failed` | `h2-transport.ts:102` | Retry elsewhere |
| `bug: h1 request error` | `h1-transport.ts:81` | Retry elsewhere |
| `bug: failed to check latest version for upgrade` | `upgrade.ts:15` | Network fetch |
| `bug: upgrade installation failed` | `upgrade.ts:37` | Auto-upgrade |

### G: Data/parsing — informational (6)
| Bug | File | Notes |
|-----|------|-------|
| `bug: copilot vision detection failed` | `copilot.ts:146` | Message parsing |
| `bug: plugin specifier parse failed` | `shared.ts:20` | Plugin name |
| `bug: failed to parse provider error body as JSON` | `error.ts:72` | Error parsing |
| `bug: failed to read models json` | `models.ts:125` | Config file |
| `bug: failed to import models snapshot` | `models.ts:132` | Module import |
| `bug: failed to read models json from cache` | `models.ts:139` | Config file |

### H: RPC/fire-and-forget — informational (3)
| Bug | File | Notes |
|-----|------|-------|
| `bug: checkUpgrade call failed` | `thread.ts:225` | Fire-and-forget RPC |
| `bug: upgrade check failed` (worker) | `worker.ts:84` | From A above |
| `bug: ModelsDev.refresh failed` | `providers.ts:327` | Fire-and-forget |
| `bug: failed to migrate legacy config` | `config.ts:432` | One-shot migration |

---

## Fixes (ordered by priority)

### [ ] 1. Fix upgrade check for dev builds
- **File**: `src/cli/upgrade.ts:27`
- **Change**: wrap `Installation.getReleaseType()` in try/catch; return early if version parse fails
- **Kills**: `bug: upgrade check failed`

### [ ] 2. Guard clangd symlink operations
- **File**: `src/lsp/server.ts:1098-1099`
- **Change**: `fs.unlink(..., { force: true })`; check `bin` exists before symlink
- **Kills**: `bug: unlink clangd symlink failed`, `bug: symlink clangd binary failed`

### [ ] 3. Triage remaining categories B-H
- After collecting bug reports from real usage, classify each remaining bug as:
  - **Fix**: code change eliminates the failure path
  - **Keep**: expected/ignorable, log stays at warn
  - **Downgrade**: truly ignorable, change to `log.debug` (exit report filters these)

---

## Bug Report Mechanism

- **Collection**: `log.ts` module-level `Set<string>` intercepts all `warn()` calls starting with `"bug:"`
- **Dedup**: Same message text deduplicated automatically (Set)
- **Exit report**: `index.ts` finally block calls `bugReport()`, prints sorted list to stderr:
  ```
  Bugs encountered (N):
    - bug: failed to chmod zls binary
    - bug: upgrade check failed
    ...
  ```
- **Criteria for `"bug:"` prefix**: Any caught error where failure is not an expected/benign condition
- **Criteria for `log.debug`**: Truly expected/ignorable failures (e.g., chmod on Windows, fire-and-forget cleanup on shutdown)
