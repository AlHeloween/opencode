---
status: planned
owner: codex
created: 2026-06-25
reproduce:
  - cd packages/opencode
  - bun test test/provider/catalog.test.ts
  - bun typecheck
---

# Catalog Service Implementation Plan

## Goal

Create a centralized `Catalog` service (`packages/core/src/catalog.ts`) that unifies provider resolution, model listing, and tokenizer selection with immutable state updates (Immer-based), typed errors, and plugin hook extension points. This eliminates the current scatter of separate registries and enables the `catalog.transform` plugin hook rename.

## Abstract Definition

Currently, provider/model resolution is spread across multiple independent registries:

| Registry | File | Purpose |
|----------|------|---------|
| Tool Registry | `src/tool/registry.ts` | 24+ built-in + custom tools |
| Attachment Registry | `src/attachment/registry.ts` | 14 attachment kind handlers |
| Tokenizer Registry | `src/tokenizers/registry.ts` | Model ID → tokenizer config mapping |
| Provider Balance | `src/provider/balance.ts` | Per-provider status fetchers |
| Plugin Hooks | `packages/plugin/src/index.ts` | `provider` hook (soon `catalog`) |

The Catalog service consolidates the **provider/model/tokenizer** concerns (items 3 and 5 above + the plugin hook) into a single source of truth with:
- **Immutable state**: Immer-based updates prevent accidental mutation
- **Plugin extensibility**: `catalog.transform` hook lets plugins inject custom providers/models
- **Typed errors**: `CatalogError` tagged union for missing provider, invalid model, etc.
- **Lazy resolution**: Providers resolved on-demand, cached via Effect's caching layer

## Formalization

```
Catalog = {
  state: CatalogState { providers: Map<ProviderID, ProviderDef>, models: Map<ModelID, ModelDef> }
  
  operations:
    registerProvider(def: ProviderDef): Effect<never, CatalogError, void>
    registerModel(def: ModelDef): Effect<never, CatalogError, void>
    resolveProvider(id: ProviderID): Effect<never, CatalogError, ProviderDef>
    resolveModel(id: ModelID): Effect<never, CatalogError, ModelDef>
    listProviders(): Effect<never, never, ProviderDef[]>
    listModels(filter?: ModelFilter): Effect<never, never, ModelDef[]>
    tokenizerFor(modelID: ModelID): Effect<never, never, TokenizerConfig | undefined>
  
  hooks:
    catalog.transform(models: ModelDef[]): MaybePromise<ModelDef[]>  // plugin extension point
  
  state transitions:
    init → built-in providers registered → plugin hooks fire → state frozen
    mutation → produce(nextState) via Immer → state updated atomically
}

ProviderDef = {
  id: ProviderID
  label: string
  models: ModelDef[]
  authMethods: AuthMethod[]
  capabilities: ProviderCapability[]
  rateLimit?: RateLimitConfig
}

ModelDef = {
  id: ModelID
  provider: ProviderID
  label: string
  contextWindow: number
  maxOutputTokens: number
  capabilities: ModelCapability[]  // text, image-input, audio-output, etc.
  pricing?: PricingConfig
  tokenizer?: TokenizerConfig
}
```

## Structural Diagram

```
Before (scattered registries):
  Plugin Hook "provider.models" ──→ injected into tool registry's provider list
  TokenizerRegistry.resolve()   ──→ called separately at tokenization time
  Provider balance fetchers     ──→ separate Record<string, StatusFetcher>
  config.ts provider resolution ──→ reads config.json for user-configured providers

After (unified Catalog):
  config.json user providers ──┐
  built-in providers ──────────┤
  plugin catalog.transform ────┤
                                v
                         CatalogService
                      (Immer immutable state)
                                │
                    ┌───────────┼───────────┐
                    v           v           v
               provider      model       tokenizer
               resolution   listing      resolution
                    
  Plugin Hook: catalog.transform(ModelDef[]) → ModelDef[]
  (processed at registration time, not at resolution time)
```

## Tasks

### Sub-Goal 1: Core Catalog Types and State

- [ ] 1.1 Define `ProviderID`, `ModelID` branded types
- [ ] 1.2 Define `ProviderDef`, `ModelDef`, `TokenizerConfig`, `AuthMethod`, `ProviderCapability`, `ModelCapability` schemas
- [ ] 1.3 Define `CatalogState` with Immer `Draft<CatalogState>` for updates
- [ ] 1.4 Define `CatalogError` tagged errors (ProviderNotFound, ModelNotFound, DuplicateProvider, InvalidConfig)
- [ ] 1.5 Create `Catalog` service interface with `resolveProvider`, `resolveModel`, `listProviders`, `listModels`, `tokenizerFor`
- [ ] 1.6 Implement `Catalog.layer` with Effect service
- [ ] 1.7 Add `Catalog` to `packages/core/src/` (new module)

### Sub-Goal 2: Plugin Hook Integration

- [ ] 2.1 Define `CatalogHook = { id: string; transform?: (models: ModelDef[]) => MaybePromise<ModelDef[]> }`
- [ ] 2.2 Implement `catalog.transform` hook dispatch in Catalog initialization
- [ ] 2.3 Update `packages/plugin/src/index.ts` `Hooks` interface: `provider` → `catalog` (with deprecation shim)
- [ ] 2.4 Update built-in plugin implementations to use `catalog.transform`

### Sub-Goal 3: Tokenizer Registry Migration

- [ ] 3.1 Port `BUILTIN_TOKENIZERS` from `src/tokenizers/registry.ts` into Catalog state
- [ ] 3.2 Implement `tokenizerFor(modelID)` using Catalog's immutable model list
- [ ] 3.3 Add wildcard pattern matching (exact match first, then regex) — preserve existing behavior
- [ ] 3.4 Deprecate standalone `src/tokenizers/registry.ts` (keep as re-export shim for one release)

### Sub-Goal 4: Provider Resolution Migration

- [ ] 4.1 Map existing provider resolution in `src/provider/` to Catalog
- [ ] 4.2 Port built-in providers (Anthropic, OpenAI, Google, xAI, DeepSeek, etc.) to Catalog registration
- [ ] 4.3 Port user-configured providers from `config.ts` to Catalog registration
- [ ] 4.4 Port provider auth methods from `src/provider/auth.ts` to Catalog's `ProviderDef.authMethods`
- [ ] 4.5 Port provider capabilities (streaming, vision, tools, etc.) to `ProviderDef.capabilities`

### Sub-Goal 5: Testing and Integration

- [ ] 5.1 Unit tests: Catalog CRUD (register, resolve, list, tokenizer lookup)
- [ ] 5.2 Unit tests: CatalogError variants for all failure paths
- [ ] 5.3 Unit tests: Plugin hook integration (transform fires, results merged)
- [ ] 5.4 Integration tests: Provider resolution via Catalog matches existing behavior
- [ ] 5.5 Integration tests: Tokenizer resolution via Catalog matches existing behavior
- [ ] 5.6 Run typecheck
- [ ] 5.7 Run full test suite

## Input/Output Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| Input: `src/tokenizers/registry.ts` | TS | Tokenizer configs to port |
| Input: `src/provider/*.ts` | TS | Provider implementations to register |
| Input: `packages/plugin/src/index.ts` | TS | Hooks interface to update |
| Input: `src/config/config.ts` | TS | User-configured provider parsing |
| Output: `packages/core/src/catalog.ts` | TS | New Catalog service (est. 300-400 lines) |
| Output: Updated `packages/plugin/src/index.ts` | TS | `catalog` hook replaces `provider` |
| Output: Updated `src/provider/*.ts` | TS | Register via Catalog instead of scatter |
| Output: Deprecated `src/tokenizers/registry.ts` | TS | Re-exports Catalog.tokenizerFor |

## Brief Implementation

### Catalog State (Immer-based)

```typescript
import { produce, type Draft } from "immer"

interface CatalogState {
  providers: Map<ProviderID, ProviderDef>
  models: Map<ModelID, ModelDef>
  tokenizers: Map<string, TokenizerConfig>  // pattern → config
}

class CatalogService extends Context.Service<CatalogService, CatalogInterface>()("@opencode/Catalog") {
  private state: CatalogState

  update(recipe: (draft: Draft<CatalogState>) => void) {
    this.state = produce(this.state, recipe)
  }

  registerProvider(def: ProviderDef) {
    this.update((draft) => {
      draft.providers.set(def.id, def)
      for (const model of def.models) {
        draft.models.set(model.id, model)
      }
    })
  }
}
```

### CatalogEffectLayer

```typescript
export const layer = Layer.effect(CatalogService, Effect.gen(function* () {
  const plugin = yield* Plugin.Service
  
  const catalog = new CatalogService()
  
  // 1. Register built-in providers
  for (const def of BUILTIN_PROVIDERS) {
    catalog.registerProvider(def)
  }
  
  // 2. Register user-configured providers from config
  const config = yield* Config.Service
  for (const [id, cfg] of Object.entries(config.providers ?? {})) {
    catalog.registerProvider(userProviderDef(id, cfg))
  }
  
  // 3. Fire plugin hooks
  const hooks = yield* plugin.hooks()
  for (const hook of hooks.catalog ?? []) {
    if (hook.transform) {
      const transformed = await hook.transform([...catalog.listModels()])
      catalog.setModels(transformed)
    }
  }
  
  // 4. Register tokenizer patterns
  for (const [pattern, config] of Object.entries(BUILTIN_TOKENIZERS)) {
    catalog.registerTokenizer(pattern, config)
  }
  
  return catalog
}))
```

### Plugin Hook Rename (parallel change)

```typescript
// packages/plugin/src/index.ts
export interface Hooks {
  // OLD (deprecated, shimmed):
  // provider?: ProviderHook
  // NEW:
  catalog?: CatalogHook
  // ...
}

export type CatalogHook = {
  id: string
  transform?(): MaybePromise<ModelDef[]>
}

// Deprecation shim:
if (hooks.provider && !hooks.catalog) {
  console.warn("Plugin uses deprecated 'provider' hook; migrate to 'catalog'. " + 
    "Support for 'provider' will be removed in a future release.")
  hooks.catalog = {
    id: hooks.provider.id,
    transform: hooks.provider.models,
  }
}
```

### Tokenizer Resolution (preserving existing behavior)

```typescript
tokenizerFor(modelID: ModelID): TokenizerConfig | undefined {
  // Exact match first
  const exact = this.state.tokenizers.get(modelID)
  if (exact) return exact
  
  // Wildcard pattern match
  for (const [pattern, config] of this.state.tokenizers) {
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace("*", ".*") + "$")
      if (regex.test(modelID)) return config
    }
  }
  
  // Fall back to model's own tokenizer config
  return this.state.models.get(modelID)?.tokenizer
}
```

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| 1 | Register provider → `resolveProvider` returns it | ProviderDef matches |
| 2 | Register provider with models → models appear in `listModels` | Model count matches |
| 3 | `resolveModel` for non-existent model → `ModelNotFound` error | Tagged error |
| 4 | `resolveProvider` for non-existent provider → `ProviderNotFound` error | Tagged error |
| 5 | Plugin `catalog.transform` adds models → `listModels` includes them | Transformed models present |
| 6 | Multiple plugins transform models → results merged correctly | All plugin models present |
| 7 | Plugin transform throws → error propagated, state unchanged | Immer state rolled back |
| 8 | Tokenizer exact match (e.g., `gpt-4o`) → returns correct config | Tokenizer config matches |
| 9 | Tokenizer wildcard match (e.g., `gpt-4*`) → returns gpt-4 config for `gpt-4o-mini` | Pattern matches |
| 10 | Immer immutability: concurrent reads see consistent state | No partial updates visible |
| 11 | Deprecation shim: old `provider` hook still works with warning | Models appear, warning logged |
| 12 | Existing provider resolution returns same results after Catalog migration | Integration test pass |

## Effort Estimate

| Sub-Goal | Effort | Dependencies |
|----------|--------|-------------|
| 1. Core Types + State | 2-3 days | None |
| 2. Plugin Hook Integration | 1-2 days | Sub-Goal 1 |
| 3. Tokenizer Migration | 1 day | Sub-Goal 1 |
| 4. Provider Migration | 2-3 days | Sub-Goal 1 |
| 5. Testing | 2-3 days | Sub-Goals 1-4 |

**Total**: ~8-12 days. This is the largest remaining architectural item.

## Open Questions

1. Should Catalog live in `packages/core/` (shared) or `packages/opencode/src/` (app-specific)? Recommendation: `packages/core/src/catalog.ts` for reuse by SDK/CLI/Desktop.
2. Should Catalog be the source of truth for provider auth methods, or continue using `Auth` service separately? Recommendation: Auth stays separate (credentials ≠ provider definitions); Catalog stores auth method *descriptions* only.
3. Should the `Immer` dependency be added explicitly or use existing Effect patterns? Recommendation: Immer is the upstream pattern (documented in `upstream_comparison/README.md:66`). Add as a dependency.
