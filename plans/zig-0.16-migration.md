# zig 0.15.2 → 0.16.0 Migration Plan

**Goal:** Migrate OpenTUI Zig native build (`packages/opentui/packages/core/src/zig/`) from zig 0.15.2 to 0.16.0, rebuild `opentui.dll`, resolve TUI startup crash.

**Status:** 0.15.2 build broken on Windows. 0.16.0 has API breaking changes. Current DLL (2026-07-03, 0.4.2-era) missing 9 per-stream audio exports → TUI exit code 1.

## Dependency Audit

| Dependency | Current | Target | Type | 0.16.0 Compat? |
|------------|---------|--------|------|----------------|
| **uucode** | `84ceda85` (pre-v0.2.0) | `54d650c` (v0.2.0) | Zig lib | ❌ current → ✅ v0.2.0 (`minimum_zig_version = "0.16.0"`) |
| **yoga** | `facebook/yoga#v3.2.1` | Pin unchanged | C++ lib | N/A (C++, not zig) — only build.zig API calls need migration |
| **miniaudio_shim.c** | Local C99 source | No change | C source | N/A — compiled via `addCSourceFile` |

uucode tags: `v0.2.0` (Feb 2026, `54d650c`, zig 0.16.0) | `v0.2.0-zig-0.16` (`faab889`) | `v0.1.0` (Sep 2025, 0.15.x).

## Scope

| File | Changes | Lines |
|------|---------|-------|
| `build.zig.zon` | Update `minimum_zig_version`, bump uucode commit | 2 edits |
| `build.zig` | API migration + version check | ~30 edits |
| `audio.zig` | Possible language-level changes | TBD after build |
| `lib.zig` | Possible language-level changes | TBD after build |
| `renderer.zig` | Possible language-level changes | TBD after build |
| `yoga.zig` | Possible FFI pointer changes | TBD after build |
| `native-renderable.zig` | New file (0.4.3), verify compiles | TBD after build |

After build: replace stale DLL at `packages/opentui/packages/core-win32-x64/opentui.dll`.

## build.zig API Breaks (zig 0.15.2 → 0.16.0)

### [Exact] Confirmed errors from `zig build` with 0.16.0:

| # | Error | 0.15.2 API | 0.16.0 Replacement |
|---|-------|-----------|-------------------|
| 1 | `std.fs.cwd()` no member | `std.fs.cwd()` | `std.fs.Dir.openDirAbsolute(...)` or `try std.fs.cwd()` with new return type |
| 2 | `std.mem.trimRight` no member | `std.mem.trimRight(u8, path, "/")` | `std.mem.trimEnd(u8, path, "/")` |
| 3 | `b.graph.env_map` no field | `b.graph.env_map.get(env_var)` | `std.process.getEnvVarOwned(b.allocator, env_var)` |
| 4 | `artifact.addIncludePath` no member | `artifact.addIncludePath(p)` | `artifact.root_module.addIncludePath(p)` |
| 5 | `artifact.linkFramework` no member | `artifact.linkFramework(fw)` | `artifact.root_module.linkFramework(fw)` |
| 6 | `artifact.linkSystemLibrary` no member | `artifact.linkSystemLibrary(lib)` | `artifact.root_module.linkSystemLibrary(lib)` |
| 7 | `artifact.linkLibCpp` no member | `artifact.linkLibCpp()` | `artifact.root_module.linkLibCpp()` |

### [Inferred] Likely further breaks (same API migration pattern):

| Method | New location |
|--------|-------------|
| `artifact.addCSourceFile(...)` | `artifact.root_module.addCSourceFile(...)` |
| `artifact.linkLibC()` | `artifact.root_module.linkLibC()` |
| `artifact.addSystemIncludePath(...)` | `artifact.root_module.addSystemIncludePath(...)` |
| `artifact.addSystemFrameworkPath(...)` | `artifact.root_module.addSystemFrameworkPath(...)` |
| `artifact.addFrameworkPath(...)` | `artifact.root_module.addFrameworkPath(...)` |
| `artifact.addLibraryPath(...)` | `artifact.root_module.addLibraryPath(...)` |

## Implementation Order

### Phase 0: Dependency updates (`build.zig.zon`)
- [ ] Update `minimum_zig_version` from `"0.15.2"` → `"0.16.0"`
- [ ] Update uucode: commit `84ceda85` → `54d650c` (v0.2.0), new hash from `zig fetch`

### Phase 1: Version gate + known API fixes (lines 237-268)
- [ ] Add `0.16.0` to `SUPPORTED_ZIG_VERSIONS`
- [ ] Fix `pathExists()` — `std.fs.cwd()` removed in 0.16 → use `std.fs.openDirAbsolute` or new fs API
- [ ] Fix `isMacOSSDKPath()` — `std.mem.trimRight` → `trimEnd`
- [ ] Fix `resolveMacOSSDKPath()` — `b.graph.env_map` → `std.process.getEnvVarOwned`

### Phase 2: Compile step linking/includes migration (lines 137-210)
- [ ] `addMiniaudioShim()` — migrate all `artifact.*` calls to `artifact.root_module.*`
- [ ] `addMacOSSDKSearchPaths()` — migrate all `artifact.*` calls
- [ ] `addMacOSSystemLibraries()` — migrate all `artifact.*` calls
- [ ] `addNativeAudioDependencies()` — migrate all `artifact.*` calls
- [ ] `addYogaDependencies()` — migrate all `artifact.*` calls

### Phase 3: Build functions migration (lines 270-510)
- [ ] `build()` — migrate test_artifact, bench_exe, bench_ffi_lib, debug_exe calls
- [ ] `buildTarget()` — migrate lib linking calls

### Phase 4: Zig source language fixes
- [ ] Attempt full build → fix any zig language-level breaks in `audio.zig`, `lib.zig`, etc.

### Phase 5: DLL deployment
- [ ] Copy built `opentui.dll` to `packages/opentui/packages/core-win32-x64/`
- [ ] Verify DLL exports all 30 audio symbols via `dumpbin /exports`
- [ ] Smoke test: `bun run packages/opencode/src/index.ts` from diagnostics worktree

## Rollback

If migration breaks beyond a single build attempt:
- Revert `SUPPORTED_ZIG_VERSIONS` add, restore exact 0.15.2 lock
- No `zig.ts` FFI symbol changes needed (DLL either builds or it doesn't)

## Verification

```powershell
# Build
cd packages/opentui/packages/core/src/zig
zig build -Doptimize=ReleaseFast

# Verify exports
dumpbin /exports lib/x86_64-windows/opentui.dll | findstr "audioCreateStream audioWriteStream audioEndStream"

# Deploy
copy lib/x86_64-windows/opentui.dll ..\..\core-win32-x64\opentui.dll

# Smoke
cd experiments/crash-diagnostics
bun run ..\..\packages\opencode\src\index.ts --log-level DEBUG --print-logs
```
