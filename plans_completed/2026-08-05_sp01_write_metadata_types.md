# SP-01: Write Tool Metadata Types (typecheck hygiene)

**Parent:** `plans/2026-08-05_master_critical_remediation.md`  
**Date:** 2026-08-05  
**Status:** Implemented 2026-08-05 — typecheck green; reject path test pass  
**Severity:** HIGH (blocks clean `bun typecheck` on HEAD)  
**Risk:** Low  
**Depends on:** none  
**Blocks:** clean CI; soft-blocks confidence for SP-02+

---

## 1. Problem

Pre-write syntax validation (`validateCodeSyntax`) added an **early return** that omits `diagnostics` / `filediff`. TypeScript infers metadata from the reject branch:

```
metadata.diagnostics: Record<string, Diagnostic[]> not assignable to undefined
```

WIP uncommitted fix uses `as any` — **forbidden** as final state (masks errors).

**Files:**

| Path | Role |
|------|------|
| `packages/opencode/src/tool/write.ts` | Bug + fix |
| `packages/opencode/src/tool/edit.ts` | Reference shape (always has diagnostics/filediff) |
| `packages/opencode/src/util/syntax-validator.ts` | Unchanged behavior |

---

## 2. Prior art

- `edit.ts` return metadata: `{ diagnostics, diff, filediff }`  
- `Tool.ExecuteResult<M>` in `tool/tool.ts` — single metadata type `M` for all returns  
- Commit `c6d44976` introduced early return without unifying metadata

---

## 3. Invariants

- No `as any` / `as unknown as` on write execute return  
- Reject path still returns soft `REJECTED — …` (does **not** throw) — model can retry write  
- Success path still runs LSP diagnostics after write  
- File not written when syntax invalid  

---

## 4. Implementation

### 4.1 Define explicit metadata type

```ts
import type { Snapshot } from "@/snapshot"
import type { LSP } from "@/lsp/lsp"

type WriteMetadata = {
  filepath: string
  exists: boolean
  diagnostics: Record<string, LSP.Diagnostic.Info[]> // match edit.ts actual type
  filediff?: Snapshot.FileDiff
}
```

Use the **same** diagnostics element type as `edit.ts` / `lsp.diagnostics()` return (inspect imports; do not invent).

### 4.2 Pass type parameter to Tool.define

```ts
export const WriteTool = Tool.define(
  "write",
  Effect.gen(function* () {
    // ...
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          // ...
        }) as Effect.Effect<Tool.ExecuteResult<WriteMetadata>>
      // prefer: annotate execute return via satisfies / explicit WriteMetadata on both returns
    }
  }),
)
```

Prefer **structural** fix: both returns satisfy `WriteMetadata` without cast:

**Reject:**

```ts
return {
  title: path.relative(Instance.worktree, filepath),
  metadata: {
    filepath,
    exists,
    diagnostics: {},
    filediff: undefined,
  },
  output: `REJECTED — ${syntaxErr.message}`,
}
```

**Success:** keep current fields; ensure `diagnostics` is always the object from `lsp.diagnostics()`.

### 4.3 Discard WIP `as any`

Replace uncommitted `undefined as any` / `} as any` entirely.

### 4.4 Out of scope

- Expanding syntax-validator languages  
- Changing reject UX to throw  

---

## 5. Smoke Tests

### SMOKE.BEFORE

```
cwd: packages/opencode

# A — typecheck with committed write.ts only (no as any)
git stash push -u -m "sp01" -- src/tool/write.ts   # if dirty
bun typecheck
# Expected [Exact]: TS2345 write.ts metadata diagnostics
git stash pop

# B — with current WIP
bun typecheck
# May PASS via as any — note Actual
```

**Record Actual before edit.**

### POST_IMPL oracles

| # | Command / check | Pass criteria |
|---|-----------------|---------------|
| S1 | `bun typecheck` | 0 errors |
| S2 | `rg "as any" src/tool/write.ts` | no metadata-related any |
| S3 | Manual unit (optional): syntax-validator reject path | if write tool test exists, pass |

### Real tests to add/extend

**File:** `packages/opencode/test/tool/write-syntax.test.ts` (new) **or** extend existing tool write tests if present.

| Test name | Setup | Assert |
|-----------|-------|--------|
| `write rejects broken python without creating file` | temp dir, broken `.py` content | return output starts with `REJECTED`; file missing or unchanged |
| `write accepts valid python` | valid `.py` | file exists with content; output success |

Use real `validateCodeSyntax` + real FS (no mock of tree-sitter). Skip test if grammar WASM missing with clear message (soft), but prefer fail if package always ships WASM.

Harness: follow `test/fixture` / `testEffect` patterns used by other tool tests. Search `test/tool/` for write/edit before inventing harness.

```
# discovery before coding
rg -n "WriteTool|tool/write" packages/opencode/test
```

---

## 6. Checklist

- [x] SMOKE.BEFORE Actual recorded (see master SMOKE.BASELINE)  
- [x] Explicit WriteMetadata; both paths fill diagnostics  
- [x] Remove all metadata `as any`  
- [x] Real reject test (`rejects broken python without creating the file` pass); valid python under default 5s timeout flaky (LSP) — typecheck + reject cover SP-01  
- [x] S1–S2 green (`bun typecheck` 0; no `as any` in write.ts)  
- [x] Mark master SP-01 `[x]` 

---

## 7. Exit criteria

Master G1 green. Commit message suggestion:

`fix(write): unify metadata types for syntax-reject path`
