# Background Jobs: Streaming Output, Type Safety, Silent Catches

**Date**: 2026-07-20  
**Commit**: `4d189f2d0`  
**Status**: ✅ Completed  

## Problem

Background jobs (`bash`, `cmd`, `run`, `task` tools with `run_in_background: true`) had no incremental output streaming. The agent couldn't see progress until the command finished, making long-running commands (git, npm install, builds) appear stalled. Git commands especially suffered — interactive prompts (SSH passphrase, merge conflicts) would hang forever with no visibility.

Additionally, there were TypeScript type violations (`as any` casts, invalid `JobKind` values) and silent catch blocks violating project logging rules.

## Root Cause Analysis

1. **No streaming**: `startEffect` accepted a plain `Effect<string, Error>` — output only captured when effect completed via `Effect.tap`. The `start()` API had `writeOutput` callbacks for streaming, but `startEffect` didn't.

2. **Type violations**: `JobKind` only allowed `"bash" | "task"`, but `run.ts` used `"run"` and `cmd.ts` used `"bash" as any`. Multiple `as any` casts masked these issues.

3. **Silent catches**: `jobs/index.ts` had two catch blocks with no logging (`catch (_) { /* best-effort */ }` and `.catch(() => {})`). `cross-spawn-spawner.ts` also had a silent catch on `proc.kill`.

## Changes

### Phase 1: Streaming Output (`jobs/index.ts`, `bash.ts`, `cmd.ts`, `run.ts`)

**`jobs/index.ts`:**
- `startEffect` signature changed: `run` parameter is now `(writeOutput: (chunk: string) => void) => Effect<string, Error>` — receives a callback for incremental output
- `writeOutput` callback strips the initial `[started]` prefix on first real chunk, then appends subsequent chunks
- Added standalone `Jobs.write()` method for external streaming into a running job
- Final result deduplication: if `writeOutput` was already used, the final tap won't duplicate output

**`bash.ts`, `cmd.ts`, `run.ts`:**
- `run()` function accepts optional `onOutput?: (chunk: string) => void` parameter
- `onChunk` handler calls `onOutput?.(chunk)` alongside existing `ctx.metadata()` calls
- Background mode passes `writeOutput` as `onOutput` to `run()`
- Result: every chunk written to stdout/stderr now appears in `job_output` in real-time

**`task.ts`:**
- Updated to new `startEffect` signature: `run: (_writeOutput) => Effect.gen(...)`

### Phase 2: Type Fixes

**`jobs/index.ts`:**
- `JobKind` extended: `"bash" | "task" | "run" | "cmd"`

**`bash.ts`:**
- Removed `as any` from background return (line 916)
- Added `jobID: undefined` to foreground metadata for type compatibility

**`cmd.ts`:**
- `kind: "bash" as any` → `kind: "cmd"`
- Removed `as any` from background return

**`run.ts`:**
- `kind: "run"` now properly typed (added to `JobKind`)
- Removed `(jobs.value as any)` cast — uses properly typed `jobs.value`
- Fixed `run_in_background` check: `if (params.run_in_background)` → `if (params.run_in_background !== false)` (consistent with bash/cmd)

**`job_output.ts`, `job_kill.ts`:**
- `params.job_id as any` → `Jobs.JobID.make(params.job_id)`

### Phase 3: Silent Catch Fixes

**`jobs/index.ts`:**
- Line 244: `catch (_) { /* best-effort */ }` → `catch (e) { log.debug("stall persist failed", { error: String(e) }) }`
- Line 277: `.catch(() => {})` → `.catch((e) => { log.debug("jobs publish failed", { error: String(e) }) })`
- All `persistUpdate`/`publishJobs` calls in `startEffect` wrapped in try/catch with `log.debug`

**`packages/core/src/cross-spawn-spawner.ts`:**
- Line 302-303: `catch { /* comment */ }` → `catch (e) { log.debug("proc.kill SIGTERM failed", { error: String(e) }) }`
- Added `import * as Log from "@opencode-ai/core/util/log"` with `const log = Log.create(...)`

## Files Changed (10 files, +126/-73)

| File | Changes |
|------|---------|
| `packages/core/src/cross-spawn-spawner.ts` | +5/-2 — log import + silent catch fix |
| `packages/opencode/src/jobs/index.ts` | +52/-18 — streaming API, types, silent catches |
| `packages/opencode/src/tool/bash.ts` | +5/-3 — streaming, type fix |
| `packages/opencode/src/tool/cmd.ts` | +7/-3 — streaming, kind fix, type fix |
| `packages/opencode/src/tool/run.ts` | +9/-5 — streaming, kind fix, type fix |
| `packages/opencode/src/tool/task.ts` | +41/-41 — API update, reformat |
| `packages/opencode/src/tool/job_output.ts` | +2/-2 — type cast fix |
| `packages/opencode/src/tool/job_kill.ts` | +2/-2 — type cast fix |
| `packages/opencode/test/jobs/jobs.test.ts` | +4/-4 — test API update |
| `packages/opencode/test/shell_tests/windows/native_commands.test.ts` | +1/-1 — pre-existing type fix |

## Verification

- **Typecheck**: `bun typecheck` — ✅ clean (0 errors)
- **Jobs tests**: 6/6 pass
- **Job-workflow tests**: 8/8 pass
- **Regression tests**: 8/11 pass (3 pre-existing failures unrelated to our changes — "exceeding timeout" string never implemented in codebase)

## Design Decisions

1. **Arrow function `(writeOutput) => Effect`** vs plain `Effect` in `startEffect`: allows caller to inject streaming without changing the Effect's internal structure. Backward-compatible for callers that don't need streaming (just ignore the parameter).

2. **`[started]` prefix stripping on first chunk**: preserves the immediate `[started]` marker for `job_output` (tested in tests), but replaces it with real output on the first write.

3. **Deduplication in tap**: if `writeOutput` already added the final text, the `Effect.tap` won't append it again. Prevents double-output.

4. **`jobID: undefined` in foreground metadata**: minimal change to make both code paths type-compatible without `as any`.

## Tooling Issues (Separate Report)

1. **Background typecheck hangs**: `bun typecheck` run as background job produces zero incremental output (exactly the bug we're fixing!) and gets detected as stalled after 15s. Workaround: use `run_in_background: false` for short commands.

2. **codegraph CLI `ETIMEDOUT`**: `spawnSync cmd.exe` timing out on codegraph queries — Windows-specific issue with tree-sitter process spawning.

3. **Git CRLF warnings**: many files show `LF will be replaced by CRLF` warnings on Windows. Pre-existing `.gitattributes` issue.
