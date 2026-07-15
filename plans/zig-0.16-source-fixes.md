# zig 0.16.0 Source Migration Plan

**Prerequisite:** `plans/zig-0.16-migration.md` (build.zig + build.zig.zon + lib.zig) — COMPLETE.

**Current state:** 29 compilation errors in zig source files after build system migration.

## Error Categories

### A. `std.Thread.Mutex` removed (4 files, 5 occurrences)

Files: `audio.zig` (lines 151, 195), `yoga.zig` (line 103), `file-logger.zig` (line 11), `tests/test-renderer.zig` (line 11)

Fix: Replace with `std.atomic.Mutex`. This is a simple enum spinlock — no `io` needed.
- `std.Thread.Mutex` → `std.atomic.Mutex`
- `= .{}` → `= .unlocked`
- `.lock()` → `while (!mutex.tryLock()) {}`
- `.unlock()` → `.unlock()` (unchanged)

### B. `std.Thread.Condition` removed (2 files, 2 occurrences)

Files: `audio.zig` (line 152), `renderer-output.zig` (line 198)

Fix: Audio streaming can't work without native symbols (which is WHY we're rebuilding). Define local `Condition` stub type:
```zig
const Condition = struct {
    fn wait(_: *Condition, _: anytype) void {}
    fn broadcast(_: *Condition) void {}
    fn signal(_: *Condition) void {}
};
```
Place stub at file root, replace `std.Thread.Condition` → `Condition`.

### C. `ArrayListUnmanaged = .{}` needs `.empty` (12+ files, ~20 occurrences)

Files: `buffer.zig` (2), `edit-buffer.zig` (1), `event-emitter.zig` (1), `grapheme.zig` (1), `lib.zig` (1), `link.zig` (1), `rope.zig` (4), `text-buffer-segment.zig` (1), `text-buffer-view.zig` (4), `text-buffer.zig` (4), `utf8.zig` (2)

Fix per file (surgical, one at a time): `= .{}` → `= .empty` on lines declaring `ArrayListUnmanaged(T)`.

For `rope.zig:1174` (`gop.value_ptr.* = .{}`): `= .{}` → `= .{ .items = &.{}, .capacity = 0 }` (assigned value, not init).

For `event-emitter.zig:36` (`self.listeners.put(event, .{})`): same pattern.
For `text-buffer.zig:716` (`self.line_highlights.append(self.global_allocator, .{})`): same pattern.

### D. `std.fs.cwd()` → `std.Io.Dir.cwd()` (3 files)

Files: `file-logger.zig`, `renderer.zig`, `text-buffer.zig`

Simple global replace: `std.fs.cwd()` → `std.Io.Dir.cwd()`

### E. `cwd().openFile/createFile/makeDir` needs `io` (3 files)

Files: `text-buffer.zig:1190`, `file-logger.zig:22`, `renderer.zig:1788,1809,1817,1854,1862`

These are debug/diagnostic features (clipboard file load, log file, buffer dump). 
Fix: Comment out file I/O lines with TODO, fall through to error/default return.

### F. `std.process.EnvMap` → `std.process.Environ.Map` (2 files)

Files: `renderer.zig:230`, `terminal.zig`

Simple global replace.

## Implementation Order

1. **D + F** (simplest global replaces, ~5 min)
2. **C** (mechanical `.{}` → `.empty`, ~5 min)  
3. **A** (mutex type change + spin-lock, ~10 min)
4. **B** (condition stub type, ~5 min)
5. **E** (debug stubs, ~5 min)

## Verification

```powershell
cd packages/opentui/packages/core/src/zig
zig build -Doptimize=ReleaseFast --summary all
```

Success criteria: 0 errors, DLL at `lib/x86_64-windows/opentui.dll`.

After build:
```powershell
dumpbin /exports lib/x86_64-windows/opentui.dll | findstr "audioCreateStream"
copy lib/x86_64-windows/opentui.dll ..\..\core-win32-x64\opentui.dll
```
