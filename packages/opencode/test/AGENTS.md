intent:
AGENTS.md — project-specific conventions and instructions.
Read by the AI for context. See opencode_prompts_kernel.py for canonical governance.

state:
source: opencode_prompts_kernel.py (canonical governance)

scope:
- project-specific conventions
- coding standards
- build and test instructions

constraints:
- All governance rules defined in opencode_prompts_kernel.py
- This file supplements, not replaces, the kernel

invariants:
- Kernel definitions take precedence over this file
- This file must not contradict the kernel

forbidden_actions:
- Contradicting opencode_prompts_kernel.py governance

acceptance_tests:
- Contents consistent with kernel governance


# Test Fixtures Guide

## Temporary Directory Fixture

The `tmpdir` function in `fixture/fixture.ts` creates temporary directories for tests with automatic cleanup.

### Basic Usage

```typescript
import { tmpdir } from "./fixture/fixture"

test("example", async () => {
  await using tmp = await tmpdir()
  // tmp.path is the temp directory path
  // automatically cleaned up when test ends
})
```

### Options

- `git?: boolean` - Initialize a git repo with a root commit
- `config?: Partial<Config.Info>` - Write an `opencode.json` config file
- `init?: (dir: string) => Promise<T>` - Custom setup function, returns value accessible as `tmp.extra`
- `dispose?: (dir: string) => Promise<T>` - Custom cleanup function

### Examples

**Git repository:**

```typescript
await using tmp = await tmpdir({ git: true })
```

**With config file:**

```typescript
await using tmp = await tmpdir({
  config: { model: "test/model", username: "testuser" },
})
```

**Custom initialization (returns extra data):**

```typescript
await using tmp = await tmpdir<string>({
  init: async (dir) => {
    await Bun.write(path.join(dir, "file.txt"), "content")
    return "extra data"
  },
})
// Access extra data via tmp.extra
console.log(tmp.extra) // "extra data"
```

**With cleanup:**

```typescript
await using tmp = await tmpdir({
  init: async (dir) => {
    const specialDir = path.join(dir, "special")
    await fs.mkdir(specialDir)
    return specialDir
  },
  dispose: async (dir) => {
    // Custom cleanup logic
    await fs.rm(path.join(dir, "special"), { recursive: true })
  },
})
```

### Returned Object

- `path: string` - Absolute path to the temp directory (realpath resolved)
- `extra: T` - Value returned by the `init` function
- `[Symbol.asyncDispose]` - Enables automatic cleanup via `await using`

### Notes

- Directories are created in the system temp folder with prefix `opencode-test-`
- Use `await using` for automatic cleanup when the variable goes out of scope
- Paths are sanitized to strip null bytes (defensive fix for CI environments)

## Testing With Effects

Use `testEffect(...)` from `test/lib/effect.ts` for tests that exercise Effect services or Effect-based workflows.

### Core Pattern

```typescript
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(MyService.defaultLayer))

describe("my service", () => {
  it.live("does the thing", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const svc = yield* MyService.Service
        const out = yield* svc.run()
        expect(out).toEqual("ok")
      }),
    ),
  )
})
```

### `it.effect` vs `it.live`

- Use `it.effect(...)` when the test should run with `TestClock` and `TestConsole`.
- Use `it.live(...)` when the test depends on real time, filesystem mtimes, child processes, git, locks, or other live OS behavior.
- Most integration-style tests in this package use `it.live(...)`.

### Effect Fixtures

Prefer the Effect-aware helpers from `fixture/fixture.ts` instead of building a manual runtime in each test.

- `tmpdirScoped(options?)` creates a scoped temp directory and cleans it up when the Effect scope closes.
- `provideInstance(dir)(effect)` is the low-level helper. It does not create a directory; it just runs an Effect with `Instance.current` bound to `dir`.
- `provideTmpdirInstance((dir) => effect, options?)` is the convenience helper. It creates a temp directory, binds it as the active instance, and disposes the instance on cleanup.
- `provideTmpdirServer((input) => effect, options?)` does the same, but also provides the test LLM server.

Use `provideTmpdirInstance(...)` by default when a test only needs one temp instance. Use `tmpdirScoped()` plus `provideInstance(...)` when a test needs multiple directories, custom setup before binding, or needs to switch instance context within one test.

### Style

- Define `const it = testEffect(...)` near the top of the file.
- Keep the test body inside `Effect.gen(function* () { ... })`.
- Yield services directly with `yield* MyService.Service` or `yield* MyTool`.
- Avoid custom `ManagedRuntime`, `attach(...)`, or ad hoc `run(...)` wrappers when `testEffect(...)` already provides the runtime.
- When a test needs instance-local state, prefer `provideTmpdirInstance(...)` or `provideInstance(...)` over manual `Instance.provide(...)` inside Promise-style tests.

# Home Purity Guard (portability contract)

Doctrine (Local_Development): the real user home (`os.homedir()`) is **NEVER**
written by opencode or its tests. Portability is the founding contract:

- exe dropped into a project root → **closed loop** (config next to the exe, data in the worktree)
- exe in a PATH folder → **automatically global** (config = exe dir)
- exe run from a flash drive / foreign machine → **zero leakage**: nothing is
  written to the host's home, everything stays inside the worktree

- `Global.Path.home` = worktree (never `os.homedir()`); `Global.Path.config` = executable dir (jsonc only)
- All databases, state, logs, caches live in the worktree: `{worktree}/.opencode/data`
- The harness (`test/preload.ts`) redirects XDG and `OPENCODE_TEST_*` env vars into `{worktree}/.temp/test/...`

## The guard — strong architectural indicator, not a run-killer

- `test/aa-home-purity.test.ts` — runs **first** (alphabetical discovery); snapshots the real home.
- `test/zz-home-purity.test.ts` — runs **last**; diffs the snapshot.
  - HARD FAIL: opencode's own standard home paths (sentinels — `~/.opencode`,
    `~/.config/opencode`, `~/.local/share/opencode`, ...) appeared during the run.
  - LOUD INDICATOR (non-fatal): any other new entry in home — prominent
    console.error so the signal cannot be missed, but the run stays usable.
- Scanner + skip list (third-party churn roots like AppData/caches): `test/lib/home-purity.ts`.
- Limitation: the guard assumes this worktree is NOT located under `os.homedir()` (true for this repo).

## Rules for tests

- Never write to `os.homedir()` — and never read real user data from it (no real `auth.json`, no real configs).
- All fixtures write into the worktree temp (`tmpdir()` → `.temp/test` or the system temp).
- A full-stack `it.live` test must declare an explicit generous timeout
  (e.g. `it.live("...", () => ..., 30_000)`); the bun default is 5000ms and
  full Effect stacks routinely exceed it on a loaded machine.
- Before claiming the portability contract holds, run the full suite
  (`bun test` from `packages/opencode`) and require the purity guard green.

