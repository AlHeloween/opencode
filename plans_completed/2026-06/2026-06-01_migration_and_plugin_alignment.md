# Migration System & Plugin Alignment Plan

**Created:** 2026-06-01
**Status:** Plan — validated against upstream `dev` at `c57379833`

---

## Part A: Database Migration System

### Current state
We use **inline idempotent SQL** (`CORE_SCHEMA_SQL` in `db.ts`) with `CREATE TABLE IF NOT EXISTS`. No version tracking, no migration table, no rollback. Schema changes require manual `ALTER TABLE` or database recreation.

### Upstream state
22 versioned TypeScript Effect-based migrations with a `migration` tracking table, auto-generated from Drizzle Kit schema diffs. Each migration is a TypeScript module exporting `{ id, up(tx) }`.

### Migration path (4 phases)

#### Phase A1: Infrastructure (non-breaking)
| Step | File | Action |
|------|------|--------|
| 1 | `packages/opencode/src/storage/migration.ts` | Port upstream's `migration.ts` runner (~60 lines) |
| 2 | `packages/opencode/src/storage/migration.gen.ts` | Empty migration registry (~5 lines) |
| 3 | `packages/opencode/src/storage/db.ts` | Add `migration` table creation + call `DatabaseMigration.apply(db)` |

```typescript
// migration table — safe, IF NOT EXISTS
db.run(`CREATE TABLE IF NOT EXISTS migration (
  id TEXT PRIMARY KEY, 
  time_completed INTEGER NOT NULL
)`)
```

#### Phase A2: Baseline migration (safety net)
| Step | File | Action |
|------|------|--------|
| 4 | `migration/20260601000000_baseline_local_development.ts` | Create baseline migration from `CORE_SCHEMA_SQL` |
| 5 | `migration/20260601000000_baseline_local_development/` | Drizzle Kit snapshot |
| 6 | `src/storage/migration.ts` | Add backfill: if migration table empty AND tables exist, seed baseline |

```typescript
// Backfill for existing databases
if (completed.size === 0) {
  const hasProjectTable = yield* db.get(
    sql`SELECT name FROM sqlite_master WHERE type='table' AND name='project'`
  )
  if (hasProjectTable) {
    yield* db.run(sql`INSERT OR IGNORE INTO migration (id, time_completed) 
      VALUES ('20260601000000_baseline_local_development', ${Date.now()})`)
  }
}
```

#### Phase A3: Future migrations
7. Create `packages/opencode/drizzle.config.ts`
8. Add `bun run db generate --name <slug>` workflow
9. Generate TypeScript wrappers per migration
10. Update `migration.gen.ts` registry

#### Phase A4: Cleanup (optional)
11. Remove `CORE_SCHEMA_SQL` and `FTS_SCHEMA_SQL` from `db.ts`
12. Replace with migration-driven creation

### Files

| File | Type | Lines |
|------|------|-------|
| `packages/opencode/src/storage/migration.ts` | NEW | ~60 |
| `packages/opencode/src/storage/migration.gen.ts` | NEW | ~5 |
| `packages/opencode/drizzle.config.ts` | NEW | ~10 |
| `packages/opencode/migration/20260601000000_baseline/` | NEW | ~150 |
| `packages/opencode/src/storage/db.ts` | MODIFY | +10, later -140 |

### Risks

| Risk | Mitigation |
|------|-----------|
| Backfill misses existing DBs | Check multiple tables (`project`, `session`, `message`) |
| Migration runner breaks existing flow | Run after PRAGMAs but before schema; fallback on failure |
| Drizzle Kit generates different SQL | Use our known-good inline SQL for baseline, not drizzle-kit diff |

---

## Part B: Plugin System Alignment

### Current state
We support 6 auth plugins (Codex, Copilot, GitLab, Poe, Cloudflare×2). No `dispose` hook, no EventV2Bridge integration, no RuntimeFlags gating. Core plugin API (`@opencode-ai/plugin` package) is stable and compatible.

### Upstream state
9 auth plugins (+Azure, DigitalOcean, XAI). Added `dispose` lifecycle hook, EventV2Bridge integration, RuntimeFlags gating, refined loader retry logic, PluginV2 hook taxonomy change (`provider.update` → `catalog.transform`).

### Divergence risk: LOW
External plugins (npm packages written against `@opencode-ai/plugin`) work in both systems. The divergence is additive — features we're missing don't break existing plugins, they just don't get the benefits.

### Alignment path (3 phases)

#### Phase B1: Immediate (1-2 hours)

1. **Add `dispose` hook** to `packages/opencode/src/plugin/index.ts`:

```typescript
// In the plugin lifecycle finalizer:
Scope.addFinalizer(scope, Effect.promise(() => {
  const hooks = state.hooks
  return Promise.all(hooks.map(h => h.dispose?.() ?? Promise.resolve()))
}))
```

2. **Copy 3 auth plugins** from upstream:
   - `packages/opencode/src/plugin/azure.ts` — Azure OpenAI auth
   - `packages/opencode/src/plugin/digitalocean.ts` — DigitalOcean auth
   - `packages/opencode/src/plugin/xai.ts` — xAI Grok OAuth

3. **Register them** in `packages/opencode/src/plugin/index.ts`:

```typescript
import { AzureAuthPlugin } from "./azure"
import { DigitalOceanAuthPlugin } from "./digitalocean"
import { XaiAuthPlugin } from "./xai"

const INTERNAL_PLUGINS = [
  // ...existing...
  AzureAuthPlugin,
  DigitalOceanAuthPlugin,
  XaiAuthPlugin,
]
```

#### Phase B2: Short-term (half day)

4. **Wire EventV2Bridge** — replace `bus.subscribeAll()` with `events.listen()` (already partially done for other modules)
5. **Provide RuntimeFlags** — add `RuntimeFlags.defaultLayer` to plugin layer
6. **Adopt loader retry** — import `isRetryableResolveError()` from upstream's loader
7. **Codex WebSocket flags** — gated by `RuntimeFlags.experimentalWebSockets`

#### Phase B3: Long-term (with Catalog)

8. **PluginV2 hook rename** — `provider.update` → `catalog.transform`, `model.update` → tied to Catalog service adoption
9. **Scope-based lifecycle** — each plugin gets `Scope.Closeable` for isolation

### Files

| File | Type | Lines |
|------|------|-------|
| `packages/opencode/src/plugin/azure.ts` | NEW | ~50 |
| `packages/opencode/src/plugin/digitalocean.ts` | NEW | ~50 |
| `packages/opencode/src/plugin/xai.ts` | NEW | ~100 |
| `packages/opencode/src/plugin/index.ts` | MODIFY | +15 (dispose, imports, registrations) |
| `packages/opencode/src/plugin/loader.ts` | MODIFY | ~5 (retry logic) |

### Gateway plugins clarification

The upstream "Gateway plugins" (kilo, llmgateway, zenmux) from the earlier comparison are **NOT plugin-system plugins**. They are **provider definitions** in `packages/opencode/src/provider/provider.ts` — AI SDK gateway provider factories. Both our branch and upstream have these. No migration needed.

---

## Implementation Order

```
Phase A1 (Migration infra)  ←→  Phase B1 (Dispose + auth plugins)
       │                              │
       ▼                              ▼
Phase A2 (Baseline)            Phase B2 (EventV2 + RuntimeFlags)
       │                              │
       ▼                              ▼
Phase A3 (Future migrations)   Phase B3 (Catalog-tied hooks)
```

Phases A1 and B1 can be done in parallel (different files, no dependencies).

---

## Verification

### Part A (Migration)
- Typecheck passes
- New DB creation: baseline migration applies, all tables exist
- Existing DB: backfill detects tables, migration table seeded, future migrations apply correctly
- Migration skip: `OPENCODE_SKIP_MIGRATIONS=true` — tracking table updated without executing SQL

### Part B (Plugin)
- Typecheck passes
- `dispose` hook called on plugin shutdown (verify with debug plugin)
- Azure/DigitalOcean/XAI plugins registered and can authenticate
- EventV2Bridge events reach plugins
- Existing external plugins continue to work without changes
