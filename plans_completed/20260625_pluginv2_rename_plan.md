---
status: planned
owner: codex
created: 2026-06-25
depends_on: 20260625_catalog_service_plan
reproduce:
  - cd packages/opencode
  - bun typecheck
  - bun test test/plugin/
---

# PluginV2 Hook Rename Plan (`provider.update` → `catalog.transform`)

## Goal

Rename the `provider` hook on the `Hooks` interface to `catalog` and its sub-hook `provider.models` to `catalog.transform`, aligning the plugin system with the Catalog service architecture. This is a type-level rename with no behavioral changes.

## Abstract Definition

The `Hooks` interface in `packages/plugin/src/index.ts` currently defines:

```typescript
provider?: ProviderHook  // { id: string; models?: () => ... }
```

The rename target is:

```typescript
catalog?: CatalogHook   // { id: string; transform?: () => ... }
```

**Key insight**: "PluginV2" does not exist in this codebase — it is an upstream type name (`core/src/plugin.PluginV2`). This fork uses `@opencode-ai/plugin` with its own `Plugin`, `Hooks`, and `ProviderHook` types. The rename is purely about the hook name, not the Plugin type.

## Formalization

```
RENAME: Hooks.provider → Hooks.catalog
RENAME: ProviderHook → CatalogHook
RENAME: provider.update semantics → catalog.transform semantics
DELETE: All "PluginV2" mentions in documentation (7 refs in 5 files, all in plans/upstream docs)

Invariant: All consumers of Hooks.provider must be updated simultaneously.
  Consumers:
    - packages/plugin/src/index.ts           (Hooks interface definition)
    - packages/opencode/src/plugin/index.ts  (hook dispatch)
    - packages/opencode/src/provider/auth.ts (provider hook dispatch)
    - packages/opencode/src/config/config.ts or provider resolution (if applicable)
```

## Structural Diagram

```
Before:
  Hooks {
    event, config, tool, auth,
    provider: {               ← rename target
      id: string
      models?(): ModelDef[]
    },
    chat.message, chat.params, chat.headers,
    permission.ask, ...
  }

After:
  Hooks {
    event, config, tool, auth,
    catalog: {                ← renamed
      id: string
      transform?(): ModelDef[]  ← renamed from models()
    },
    chat.message, chat.params, chat.headers,
    permission.ask, ...
  }
```

## Tasks

- [ ] 1. Rename `ProviderHook` → `CatalogHook` in `packages/plugin/src/index.ts`
- [ ] 2. Rename `provider` → `catalog` field in `Hooks` interface
- [ ] 3. Rename `models()` → `transform()` method on the hook
- [ ] 4. Update all hook consumers in `packages/opencode/src/plugin/index.ts` (hook dispatch)
- [ ] 5. Update `packages/opencode/src/provider/auth.ts` if it references `provider` hook
- [ ] 6. Update plugin implementations (codex, copilot, cloudflare, azure, digitalocean, xai, gemini) if they implement `provider` hook
- [ ] 7. Update test files referencing ProviderHook
- [ ] 8. Clean up "PluginV2" mentions in documentation (replace with accurate descriptions)
- [ ] 9. Run typecheck — must pass with zero errors
- [ ] 10. Run plugin test suite

## Input/Output Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| Input: `packages/plugin/src/index.ts` | TS | Hooks interface + ProviderHook type |
| Input: `packages/opencode/src/plugin/index.ts` | TS | Server-side plugin runtime (hook dispatch) |
| Input: `packages/opencode/src/provider/auth.ts` | TS | Provider auth hook consumers |
| Input: Plugin implementation files | TS | 7 built-in auth plugins |
| Input: Documentation files | MD | 5 files with "PluginV2" references |
| Output: Renamed types | TS | CatalogHook, catalog, transform() |
| Output: Updated docs | MD | Accurate descriptions, no "PluginV2" |

## Brief Implementation

### Step 1-3: Type rename in plugin package

```typescript
// packages/plugin/src/index.ts

// OLD
export type ProviderHook = {
  id: string
  models?(): MaybePromise<ModelDef[]>
}
export interface Hooks {
  provider?: ProviderHook
  // ...
}

// NEW
export type CatalogHook = {
  id: string
  transform?(): MaybePromise<ModelDef[]>
}
export interface Hooks {
  catalog?: CatalogHook
  // ...
}
```

### Step 4: Hook dispatch update

In `packages/opencode/src/plugin/index.ts`, update any code that iterates `hooks.provider` to iterate `hooks.catalog`.

### Step 5-6: Plugin implementations

Check each of the 7 built-in plugins (codex.ts, copilot.ts, cloudflare.ts, azure.ts, digitalocean.ts, xai.ts, gemini.ts) for `provider` key in their hook exports. Rename to `catalog`. Only plugins that actually implement this hook need updating — many only implement `auth`.

### Step 8: Documentation cleanup

Replace "PluginV2" references in:
- `upstream_comparison/README.md:133`
- `plans_completed/20260601_upstream_adoption_phase2.md:31`
- `plans_completed/20260601_migration_and_plugin_alignment.md:89,137`
- `plans_completed/20260601_complete_remaining_items.md:174`
- `plans_completed/20260623_remaining_items.md:165,243`

Replace with: "Upstream plugin type (PluginV2)" → "Upstream plugin type" or remove references that no longer apply after Catalog service adoption.

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | Plugin with `catalog.transform` exports models correctly | Models appear in provider resolution |
| 2 | Plugin with old `provider.models` is NOT picked up (breaking change) | No models, warning logged |
| 3 | `CatalogHook` type exports correctly from `@opencode-ai/plugin` | TypeScript consumers see new name |
| 4 | All built-in plugins compile (if they implement the hook) | No type errors |
| 5 | `Hooks` interface has `catalog` not `provider` | grep confirms zero `provider` on Hooks |
| 6 | Typecheck passes with zero errors | `bun typecheck` clean |

## Risk Assessment

- **BREAKING**: External plugins that implement `provider` hook will break. Mitigation: add a deprecation shim that maps `provider` → `catalog` with a warning log during one release cycle, then remove in the next.
- **Blocked by**: Catalog service adoption (Item 4.4). The rename from `provider.update` to `catalog.transform` semantically implies a Catalog service exists as the consumer. Without Catalog, the rename is cosmetic only.
