# Fix: log truncate bug (bug-0001) + --help overhead

**Status**: Plan  
**Created**: 2026-06-12 (revised 2026-06-12 after root cause correction)  
**Targets**: `packages/opencode/src/index.ts`, `packages/core/src/util/log.ts`

## Abstract

Two interrelated issues:
1. `fs.truncate(logpath)` in `log.ts:init()` always fails — the log filename contains a fresh timestamp so the file never exists yet. `fs.promises.truncate()` throws `ENOENT` on non-existent files.
2. `opencode --help` and `opencode --version` run the full `Log.init()` + middleware stack, creating empty log files and collecting bugs for display-only operations.

## Root cause analysis

### Part A: fs.truncate always fails

`packages/core/src/util/log.ts:127-133`:
```ts
logpath = path.join(
  Global.Path.log,
  new Date().toISOString().replace(/:/g, "").replace("Z", "") + ".log",  // NEW every call
)
await fs.truncate(logpath).catch(() => {     // ← ALWAYS throws ENOENT
  collectBug("log.ts:init", "bug: failed to truncate log file [core/log]")
})
```

- `fs.promises.truncate(path)` throws `ENOENT` when the target file does not exist
- Every `init()` call generates a novel timestamped filename → file never exists yet
- The truncate is dead code: it fails 100% of the time, producing bug-0001 on every invocation

Evidence: `reopen()` (line 154-178) uses the same timestamped-filename pattern but **never calls truncate** — it correctly relies on `createWriteStream(logpath, { flags: "a" })` to create the file.

### Part B: --help triggers full init

`packages/opencode/src/index.ts:68-106` — yargs `.middleware()` registers `Log.init()` during the builder chain, not at parse time. The `--help` check at line 147 happens too late — `cli.parse()` already fires middleware regardless of callback form vs promise form.

Yargs provides parsed flags (`opts.help`, `opts.version`) to middleware. We can short-circuit.

`Global.Path` defaults are set at module load (`global.ts:8-14`) from `process.cwd()` → no init crash risk in the `finally` block.

## Fix

### Fix A — `packages/opencode/src/index.ts:85`

Add early return in middleware for display-only flags:

```diff
 .middleware(async (opts) => {
+  if (opts.help || opts.version) return
   if (opts.pure) {
     process.env.OPENCODE_PURE = "1"
   }
```

Yargs parses `--help`/`-h` → `opts.help`, `--version`/`-v` → `opts.version` before middleware fires. Returning early skips `Log.init()`, `Heap.start()`, env var assignment, and the info log entry. Yargs still displays help/version output after the middleware chain completes because those are handled by the yargs framework itself, not middleware.

### Fix B — `packages/core/src/util/log.ts:131-133`

Remove the dead `fs.truncate()` call:

```diff
   logpath = path.join(
     Global.Path.log,
     new Date().toISOString().replace(/:/g, "").replace("Z", "") + ".log",
   )
-  await fs.truncate(logpath).catch(() => {
-    collectBug("log.ts:init", "bug: failed to truncate log file [core/log]")
-  })
   mkdirSync(Global.Path.log, { recursive: true })
   mkdirSync(path.join(Global.Path.log, "payloads"), { recursive: true })
   const stream = createWriteStream(logpath, { flags: "a" })
```

Rationale:
- Every `init()` call creates a novel filename — truncate can never succeed
- `createWriteStream(path, { flags: "a" })` handles file creation
- `reopen()` never calls truncate and works correctly
- The `mkdirSync` calls remain in their correct positions before stream creation

## Files changed

| File | Change | Lines |
|------|--------|-------|
| `packages/opencode/src/index.ts` | Add early return in middleware for help/version | +1 |
| `packages/core/src/util/log.ts` | Remove dead `fs.truncate()` + collectBug call | -3 |

## Verification

1. `bun typecheck` from `packages/core/` and `packages/opencode/`
2. `opencode --help` → displays help text only, no "Bugs encountered" line, no log file created
3. `opencode --version` → displays version only, clean exit
4. `opencode run "echo test"` → works normally, log file created, no bug-0001
5. Existing tests pass

## Effect summary

| Scenario | Before | After |
|----------|--------|-------|
| `opencode --help` | Full init + empty log + bug-0001 | Help text only, clean exit |
| `opencode --version` | Full init + bug-0001 | Version only, clean exit |
| `opencode run "..."` | Full init + bug-0001 | Full init, no bug |
| Any real command | bug-0001 in bug report | bug-0001 eliminated |

## Related

- Previously catalogued in `plans_completed/bug-resolution-plan.md` line 92 as "E: Resource cleanup"
- `reopen()` (log.ts:154) proves the truncate-free pattern is correct
- No recursion risk: `collectBug()` uses in-memory Map, does not call `write()`
