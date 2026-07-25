---
status: done
owner: codex
created: 2026-06-28
completed: 2026-06-28
reproduce:
  - cd packages/opencode && bun test test/provider/model-resolver.test.ts
  - bun typecheck
---

# Sub-Plan 5: Model Route Optimization

## Goal

Split the monolithic `models-snapshot.js` (single 3-line file, ~500KB+ of JSON)
into per-provider lazy-loaded JSON files. Add priority routing for DeepSeek,
OpenCode, sdk-next, and kat-coder-pro-v2 — these resolve directly without
loading the full registry. Everything else stays accessible through general
provider resolution.

## Scope

- **Multiple files created**: `packages/opencode/src/provider/models/*.json` (one per provider, 145 files)
- **One file modified**: `packages/opencode/src/provider/model-resolver.ts`
- **One file modified**: `packages/opencode/src/provider/models.ts`
- **One file modified**: `packages/opencode/script/generate.ts`
- **One test file created**: `packages/opencode/test/provider/model-resolver.test.ts`
- **No deletions**: `models-snapshot.js` stays as fallback during migration

## Implementation

### Split model data

```
models-snapshot.js (current: 1 file, all providers)
         ↓
models/
   anthropic.json       ← lazy-loaded on first Anthropic call
   deepseek.json        ← lazy-loaded on first DeepSeek call
   opencode.json        ← lazy-loaded on first OpenCode call
   google.json          ← lazy-loaded on first Google call
   openai.json          ← lazy-loaded on first OpenAI call
   ... (one file per provider, 145 total)
```

### Priority routing (`model-resolver.ts`)

```typescript
const PRIORITY_PROVIDERS = [
  "deepseek",
  "opencode",
  "sdk-next",
  "kat-coder"
] as const

async function resolveModel(providerID: string, modelID: string): Promise<Model> {
  // Priority path: direct resolve without loading registry
  if (PRIORITY_PROVIDERS.includes(providerID as any)) {
    return resolvePriorityProvider(providerID, modelID)
  }
  // General path: lazy-load provider JSON, then resolve
  return resolveGeneralProvider(providerID, modelID)
}
```

### Lazy loading

Each provider JSON file is loaded only when first needed via dynamic `import()`.
Once loaded, cached in memory using a Map + Promise deduplication pattern.
Concurrent calls share a single load (no thundering herd).

The `models.ts` `get()` function now supports an optional `providerID` parameter:
- `get()` — returns full registry (unchanged behavior)
- `get(providerID)` — returns only that provider, loaded from per-provider JSON

### Files changed

| File | Change |
|------|--------|
| `script/generate.ts` | Split snapshot into per-provider JSON files |
| `src/provider/models.ts` | Added `loadProvider()`, `get(providerID?)` overloads |
| `src/provider/model-resolver.ts` | Added priority routing, extracted `buildResolvedModel` helper |
| `src/provider/models/*.json` | 145 per-provider JSON files (auto-generated) |
| `test/provider/model-resolver.test.ts` | 8 new tests |

## Test Cases

| # | Input | Expected | Status |
|---|-------|----------|--------|
| 1 | Resolve `deepseek/deepseek-chat` | < 100ms, direct priority path | Pass |
| 2 | Resolve `opencode/ring-2.6-1t-free` | < 100ms, direct priority path | Pass |
| 3 | Resolve `anthropic/claude-sonnet-4-20250514` | Lazy-loads anthropic.json, resolves correctly | Pass |
| 4 | Resolve `openai/gpt-4` | Lazy-loads openai.json, resolves correctly | Pass |
| 5 | Resolve `google/gemini-2.5-pro` | Lazy-loads google.json, resolves correctly | Pass |
| 6 | Resolve unknown provider | Returns undefined | Pass |
| 7 | DeepSeek model capabilities | temperature=true, toolcall=true | Pass |
| 8 | OpenCode model capabilities | temperature=true | Pass |

## Verification

```
bun test test/provider/model-resolver.test.ts    # 8/8 pass
bun test test/provider/transform.test.ts          # 158/158 pass, zero regressions
bun typecheck                                     # clean
```

## Risk

- **Missing provider**: `models-snapshot.js` stays as fallback until migration is verified.
- **Model metadata drift**: Split is mechanical — same JSON, different files. Zero data change.
- **Race condition on first load**: Lazy-load uses Promise cache — concurrent calls share single load.

## Ship Criteria

- [x] All 8 tests pass
- [x] 158 transform tests zero regressions
- [x] Typecheck clean
- [x] Cold start time improved (fewer models loaded at startup — only loaded on demand)
