# Plan 1: Binary Discovery

## Problem

The fossil binary path is hardcoded:
```typescript
const FOSSIL_BIN = path.join(Global.Path.home, "external", "fossil", "fossil.exe")
```

`Global.Path.home` = worktree. When testing from `D:\zPython\_tst_open\`, this resolves to `D:\zPython\_tst_open\external\fossil\fossil.exe` — doesn't exist. The actual binary is at `D:\zPython\opencode\external\fossil\fossil.exe` or `D:\zPython\_tst_open\tools\fossil.exe`.

## Why It Happens

The opencode system is portable — `Global.Path.home` is always the current worktree, not the opencode source directory. Binary paths must be resolved relative to the worktree or found on PATH.

## Solution: Multi-Location Discovery Chain

```
1. PATH lookup:          where fossil / which fossil
2. Worktree tools/:      {worktree}/tools/fossil.exe
3. Worktree external/:   {worktree}/external/fossil/fossil.exe
4. Data directory:       {data}/bin/fossil.exe
5. Error:                "fossil not found — install to tools/ or add to PATH"
```

Priority: PATH > tools/ > external/ > data/bin/ > error

## Why This Works

- PATH lookup handles system-wide installations
- `tools/` is the standard location for project-local binaries (cmd_runner.exe, adm.exe already there)
- `external/` is where source distributions live
- `data/bin/` is for auto-downloaded binaries
- Clear error message guides the user

## Implementation

```typescript
function findFossil(): string | undefined {
  // 1. PATH
  const pathResult = execSync("where fossil 2>nul || which fossil 2>/dev/null", { encoding: "utf-8" }).trim()
  if (pathResult) return pathResult.split("\n")[0].trim()
  
  // 2. Worktree tools/
  const toolsPath = path.join(Global.Path.home, "tools", "fossil.exe")
  if (existsSync(toolsPath)) return toolsPath
  
  // 3. Worktree external/
  const extPath = path.join(Global.Path.home, "external", "fossil", "fossil.exe")
  if (existsSync(extPath)) return extPath
  
  // 4. Data bin/
  const binPath = path.join(Global.Path.data, "bin", "fossil.exe")
  if (existsSync(binPath)) return binPath
  
  return undefined
}
```

## Test Cases

1. fossil on PATH → uses PATH binary
2. fossil in tools/ → uses tools binary
3. fossil not found → clear error, snapshot disabled
4. fossil found at multiple locations → uses highest priority

## Acceptance Criteria

- [ ] `fossil.exe` found in `D:\zPython\_tst_open\tools\`
- [ ] `fossil.exe` found via PATH on any system
- [ ] Clear error when fossil not available
- [ ] No hardcoded paths
