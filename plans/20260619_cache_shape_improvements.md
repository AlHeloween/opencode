# Plan: Cache Shape Improvements (Reasonix-Inspired)

**Created**: 2026-06-19
**Source**: Reasonix `cache_shape.go` analysis — adopt prefix-level component hashing + tool schema normalization into our existing `cache-control.ts`.

---

## State

Our `requestFingerprint(system[], msgs[], meta)` hashes the system prompt as one blob (`system.join("\n")`). Tool schemas are embedded in the system prompt text. Any tool reordering (skill file change, MCP server restart, config filter toggle) changes the blob hash → full provider KV cache miss — even when semantic content is identical.

Reasonix normalizes tool schema order before hashing and tracks system/tools/prefix as separate components for actionable cache-break diagnosis.

We already have: message-level fingerprinting, plugin-aware dual-snapshot, model message cache, and diff logging. We need: tool order invariance and component-level blame.

---

## Goal 1: Add `PrefixShape` Component Hashing

**Abstract**: Extend `requestFingerprint()` to accept optional `ToolSchema[]`. If provided, compute separate hashes for system (without tools), tools (normalized), and full prefix. Store these in `RequestFingerprint` as additional fields. The existing `systemMd5`, `fullMd5`, and message arrays remain unchanged — this is additive.

**Math**:
```
PrefixShape = {
  systemOnlyMd5:  MD5(system_without_tools),
  toolsMd5:       MD5(normalize(toolSchemas)),
  toolsOrderHash: MD5(sorted(toolSchemaNames)),
  toolsTokenEst:  sum(len(schema) / 4),
  prefixMd5:      MD5(systemOnlyMd5 + toolsMd5),
}
```

**Structural diagram**:
```
prompt.ts                          cache-control.ts
  │                                    │
  ├─ system[] (from Instruction)       ├─ requestFingerprint()
  ├─ toolSchemas[] (from ToolRegistry) │   ├─ systemMd5 (unchanged blob hash)
  │                                    │   ├─ toolsMd5    (NEW — normalized)
  │                                    │   ├─ prefixMd5   (NEW — system + tools)
  │                                    │   └─ fullMd5     (unchanged)
  │                                    │
  └─ fingerprint stored ──────────────→└─ storePrevFingerprint()
```

**Files**:
| [ ] | File | Change |
|-----|------|--------|
| [ ] | `cache-control.ts` | Add `ToolSchema` interface, `PrefixShape` type, normalize function, extend `requestFingerprint()` |

**Input**: Current `requestFingerprint(system, msgs, meta)` signature.
**Output**: `requestFingerprint(system, msgs, meta, toolSchemas?)` — toolSchemas optional for backward compat.

**Test**: Existing self-test still passes. New test: identical tools in different order → same `toolsMd5`.

---

## Goal 2: Add Component-Level Blame to `auditCache()`

**Abstract**: When `PrefixShape` data is available, `auditCache()` reports *which component* broke the cache. Extends the existing message-level divergence tracking — does not replace it.

**Change diagnosis priority**:
```
1. systemOnlyMd5 changed? → "system prompt content changed (not tools)"
2. toolsMd5 changed?       → "tool schemas changed"
3. toolsOrderHash changed? → "tool order changed (content identical)"
4. fallback to message-level scan (existing behavior)
```

**Structural diagram**:
```
auditCache(prev, next, caller)
  │
  ├─ prev.prefix && next.prefix ?
  │   ├─ systemOnlyMd5 changed  → changeDescription = "system prompt changed (non-tool)"
  │   ├─ toolsMd5 changed       → changeDescription = "tool schemas changed (count or content)"
  │   ├─ toolsOrderHash changed → changeDescription = "tool order changed only"
  │   └─ prefixMd5 stable       → fast path: skip message scan
  │
  └─ no prefix data → existing message-by-message scan (unchanged)
```

**Files**:
| [ ] | File | Change |
|-----|------|--------|
| [ ] | `cache-control.ts` | Extend `auditCache()` with component-level blame |

**Test**: Self-test cases: system change, tool content change, tool order change — each reports correct blame.

---

## Goal 3: Wire Tool Schemas Into the Hash Chain

**Abstract**: In `prompt.ts`, pass tool schemas (from `ToolRegistry`/`SessionTools`) to `requestFingerprint()` at both capture points (before and after plugin transforms). The tool schemas are already available in the `tools` variable used for the LLM call — we pass them alongside `system[]` and `msgs[]`.

**Files**:
| [ ] | File | Change |
|-----|------|--------|
| [ ] | `prompt.ts` | Pass tool schemas to `requestFingerprint()` (lines 1538, 1578) |
| [ ] | `processor.ts` | Pass tool schemas to `requestFingerprint()` (line 464 area) |

**Input**: `tools` variable already defined in the prompt loop (AI SDK tool format).
**Output**: Same, but now feeding into fingerprint for component-level cache tracking.

---

## Goal 4: Tool Schema Normalization Function

**Abstract**: `normalizeToolSchemas(schemas: ToolSchema[]): ToolSchema[]` — sorts by name, then description, then JSON length. Returns a new array (non-mutating). Used in `requestFingerprint()` before computing `toolsMd5`.

**Math**:
```
normalize(schemas) = sort by:
  1. schema.name (ascending)
  2. schema.description (ascending)
  3. JSON.stringify(schema.parameters).length (ascending)
```

**Implementation**: standalone pure function in `cache-control.ts`. Zero dependencies on `effect`.

**Test**: `normalizeToolSchemas([{name:"b"}, {name:"a"}]) → [{name:"a"}, {name:"b"}]`

---

## Execution Order

1. **Goal 4** — Tool schema normalization function (pure, no callers)
2. **Goal 1** — Extend `requestFingerprint()` with optional `toolSchemas` param
3. **Goal 2** — Extend `auditCache()` with component-level blame
4. **Goal 3** — Wire into `prompt.ts` and `processor.ts` callers
5. Run self-test + typecheck + existing cache tests

---

## Oracle Verification

| Check | Command |
|-------|---------|
| Typecheck | `cd packages/opencode && bun typecheck` |
| Self-test | `bun run src/session/cache-control.ts` |
| Existing tests | `bun test test/session/` (compaction, llm, processor) |
| Tool normalization | New unit: same tools different order → same hash |

---

## Files Summary

| File | Change |
|------|--------|
| `packages/opencode/src/session/cache-control.ts` | Add `ToolSchema`, `PrefixShape`, `normalizeToolSchemas()`, extend `requestFingerprint()`, extend `auditCache()` |
| `packages/opencode/src/session/prompt.ts` | Pass toolSchemas at lines 1538, 1578 |
| `packages/opencode/src/session/processor.ts` | Pass toolSchemas at fingerprint call |
