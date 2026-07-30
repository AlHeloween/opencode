# B3: Permission Request Caching for Tool Execution

Framework: ADID 15.4.3. This plan eliminates redundant permission-validation
round-trips during repeated tool calls within the same session by introducing
a short-lived in-memory cache keyed on shell type + sorted pattern set.

## SVM: Vector summary

Semantic vector: `["permission cache", "tool latency", "pattern dedup"]`
with weights `[0.50, 0.30, 0.20]`.

Information Mark: **Inferred** — derived from Exact source-code inspection of
`bash.ts`, tool execution flow, and the permission system. Premise IDs: [P1–P4].

## 1. Goal and scope

**Goal**: Reduce per-tool-call latency by 15–25% for repeated invocations by
caching permission-ask results with a 60-second TTL. The cache is scoped to
shell type + normalized pattern set, so identical commands in the same session
skip redundant permission validation.

**Scope**: `packages/opencode/src/tool/bash.ts` (primary — lines 396–414).
Optional extension to `read.ts`, `write.ts`, `edit.ts` if the pattern proves
effective.

**Non-goals**: Do NOT change the permission system architecture, the `ask`
protocol, permission persistence, or the doom-loop detection. The cache is
strictly an in-memory optimization with bounded TTL.

## 2. Current state assessment (Exact)

### P1: BashTool.ask validates every invocation independently

**File**: `packages/opencode/src/tool/bash.ts`, lines 396–414

```typescript
const ask = Effect.fn("BashTool.ask")(function* (ctx, scan, shell) {
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => path.join(dir, "*"))
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {},
    })
  }
  if (scan.patterns.size === 0) return
  const permission = Shell.permissionKey(shell)
  yield* ctx.ask({
    permission,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {},
  })
})
```

Every tool invocation — even identical `ls` or `cat` commands within the same
session — goes through the full `ctx.ask()` pipeline. The permission system
checks rules, validates patterns, and potentially blocks on user confirmation.

### P2: The scan is deterministic for a given command + shell

The `scan` object (dirs, patterns, always) is computed from the parsed
tree-sitter AST of the command. Identical commands produce identical scans.
The shell type (`bash`, `powershell`, `cmd`) is also deterministic.

### P3: Session permission rules rarely change mid-session

Permission rules are set at session creation and only change via explicit
`/permissions` commands. A 60-second TTL is conservative enough to catch
rule changes while caching the vast majority of repeated tool calls.

### P4: The cache must NOT bypass the doom-loop detector

The doom-loop check at `processor.ts:466–486` is separate from the permission
system. It operates on `ctx.recentToolCalls` history. The permission cache
only affects `ctx.ask()`, not the doom-loop gate.

## 3. Task definition

| # | Task | Weight | Dependencies | State |
|---|------|--------|--------------|-------|
| T1 | Add permission cache to `bash.ts` | 0.50 | — | pending |
| T2 | Add cache invalidation on rule change | 0.20 | T1 | pending |
| T3 | Extend cache to read/write/edit tools | 0.20 | T1 | pending |
| T4 | Smoke tests + oracle verification | 0.10 | T1–T3 | pending |

## 4. Exact materialized transition

### T1: Cache implementation in bash.ts

**File**: `packages/opencode/src/tool/bash.ts`, after line 395

```typescript
// Permission cache: shell + sorted normalized patterns → TTL
// Scoped to session lifetime (in-memory Map, no persistence).
const _permCache = new Map<string, { ts: number }>()
const PERM_CACHE_TTL_MS = 60_000 // 1 minute

function permCacheKey(shell: string, scan: { dirs: Set<string>; patterns: Set<string> }): string {
  const allPatterns = new Set([
    ...Array.from(scan.dirs).map(d => path.join(d, "*")),
    ...Array.from(scan.patterns),
  ])
  return `${shell}:${[...allPatterns].sort().join("|")}`
}
```

Then modify the `ask` function (lines 396–414):

```typescript
const ask = Effect.fn("BashTool.ask")(function* (ctx, scan, shell) {
  // Fast path: cache hit
  const cacheKey = permCacheKey(shell, scan)
  const cached = _permCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < PERM_CACHE_TTL_MS) return

  // Slow path: full permission check (unchanged logic)
  if (scan.dirs.size > 0) {
    const globs = Array.from(scan.dirs).map((dir) => path.join(dir, "*"))
    yield* ctx.ask({
      permission: "external_directory",
      patterns: globs,
      always: globs,
      metadata: {},
    })
  }
  if (scan.patterns.size === 0) {
    _permCache.set(cacheKey, { ts: Date.now() })
    return
  }
  const permission = Shell.permissionKey(shell)
  yield* ctx.ask({
    permission,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {},
  })

  // Cache on success (errors are not cached — they propagate)
  _permCache.set(cacheKey, { ts: Date.now() })
})
```

### T2: Cache invalidation

Add a simple invalidation function called when permission rules change:

```typescript
export function invalidatePermissionCache() {
  _permCache.clear()
}
```

Wire this to the permission-update path in `packages/opencode/src/permission/index.ts`
(or the session `setPermission` method). If the invalidation hook is too
invasive for the initial implementation, the 60-second TTL provides a
reasonable upper bound on stale cache lifetime.

### T3: Extension to other tools

Apply the same pattern to:
- `packages/opencode/src/tool/read.ts` — file read permission
- `packages/opencode/src/tool/write.ts` — file write permission
- `packages/opencode/src/tool/edit.ts` — file edit permission

Each tool gets its own cache with the same TTL. The key format is tool-specific
(e.g., `read:<absPath>` for read, `write:<absPath>` for write).

## 5. Verification criteria (oracles)

| # | Oracle | Pass criteria |
|---|--------|---------------|
| O1 | `bun test test/tool/` from `packages/opencode` | All tool tests pass |
| O2 | Repeated identical bash command in same session | Second call skips `ctx.ask()` (cache hit) |
| O3 | Different command in same session | Fresh `ctx.ask()` call (cache miss) |
| O4 | Same command after 61 seconds | Fresh `ctx.ask()` call (TTL expired) |
| O5 | Permission rule change mid-session | Cache invalidated; fresh `ctx.ask()` call |
| O6 | Doom-loop detection | Unchanged; still fires after DOOM_LOOP_THRESHOLD repeats |

## 6. Smoke Tests (PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test test/tool/bash.test.ts` from `packages/opencode` | pass | (record) |
| 2 | `bun run typecheck` from `packages/opencode` | pass | (record) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/tool/` from `packages/opencode` | all pass |
| 2 | `bun run typecheck` from `packages/opencode` | pass |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## 7. Implementation sequence (ordered checkboxes)

- [ ] T1a: Add `permCacheKey()` helper + `_permCache` Map to `bash.ts:~395`
- [ ] T1b: Wrap existing `ctx.ask()` calls with cache check in `bash.ts:396–414`
- [ ] T2: Add `invalidatePermissionCache()` + wire to permission-update path
- [ ] T3: Apply same pattern to `read.ts`, `write.ts`, `edit.ts`
- [ ] T4: Record baseline smoke; run post-impl oracles; mark complete

## 8. Information Mark ledger

| Claim | Status | Premises | Evidence |
|-------|--------|----------|----------|
| Every tool call hits ctx.ask() | Exact | P1 | Direct source inspection of bash.ts:396–414 |
| Scan is deterministic for given command | Exact | P2 | Tree-sitter parsing produces deterministic AST |
| 60s TTL is safe upper bound | Inferred | P3 | Permission rules change rarely; 60s is conservative |
| Cache won't break doom-loop | Exact | P4 | Doom-loop uses ctx.recentToolCalls, not permission system |
| 15–25% latency reduction | Hypothetical | P1, T1 | Falsifiable: measure tool-call latency before/after |

## 9. Non-destructive boundary

- Do NOT change the `ctx.ask()` signature or protocol
- Do NOT persist the cache (in-memory only, cleared on process exit)
- Do NOT cache errors or denied permissions (only successful asks)
- Do NOT alter the doom-loop detection
- Do NOT change permission rule storage or evaluation
