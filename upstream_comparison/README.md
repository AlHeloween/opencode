# Upstream Comparison Tracker

**Created:** 2026-05-18
**Purpose:** Track divergence between `Local_Development` (our branch) and upstream `dev` (anomalyco/opencode)

---

## Fork Point

| Field | Value |
|-------|-------|
| Common ancestor | `aa07f38b0708f306a25d55db8d2123498958f578` |
| Date | 2026-04-28 19:37:40 +0800 |
| Upstream HEAD (at comparison) | `71b27a1b0` |
| Local HEAD (at comparison) | `3a1651963` |
| Upstream commits since fork | **1094** |
| Local commits since fork | **91** |

---

## Key Architectural Divergence

Our branch differs from upstream in these fundamental ways — direct file copies are rarely applicable:

- **Worktree-relative paths** — runtime data under `.opencode/data/`, not XDG directories
- **Effect-based service layer** — extensive migration to Effect.ts for DI, runtime, services
- **Per-project databases** — separate SQLite per project instead of single global DB
- **V2 API** — session entry/event system, HTTP API surface
- **LSP auto-enable** — default-on instead of opt-in
- **DB effects sync-only** — narrowed type to prevent fire-and-forget async
- **h2 backpressure** — stream limit enforcement
- **Bus `Payload` typing** — typed wildcard subscriptions
- **Silent catch elimination** — every catch logs
- **Security hardening** — Vite host lock, Electron updater, CLI graceful exit

---

## Comparison Status

| Date | Compared up to commit | Scope | Status |
|------|----------------------|-------|--------|
| 2026-05-18 | `71b27a1b0` (HEAD) | `packages/opencode/src/session/`, `provider/`, `tool/`, `config/`, `packages/core/` | Phase 1 planned (6 items) — see `plans/20260518_upstream_adoption_plan.md` |


---

## Adoptable Patterns (2026-05-18)

### HIGH PRIORITY — Low Effort

| Pattern | File | What to adopt |
|---------|------|---------------|
| **JSON Schema generator** | `packages/opencode/src/tool/json-schema.ts` (new) | Effect Schema → JSON Schema 7 conversion. WeakMap cache, `$ref` inlining, null stripping, `allOf` flattening. Drop-in utility. |
| **Compaction v2 events** | `packages/opencode/src/session/compaction.ts` | Dual-write `SessionEvent.Compaction.Started/Ended` via `EventV2Bridge`. Guarded by `flags.experimentalEventSystem`. Additive only. |
| **Overflow `outputTokenMax`** | `packages/opencode/src/session/overflow.ts` | `usable()`/`isOverflow()` accept optional `outputTokenMax` param — accounts for runtime overrides from `RuntimeFlags`. 3-line signature change. |
| **Attachment config** | `packages/opencode/src/config/attachment.ts` (new) | User-controllable image processing: `auto_resize`, `max_width/height`, `max_base64_bytes`. |
| **Reference config** | `packages/opencode/src/config/reference.ts` (new) | Config-driven external directory access: `@alias` → git repo clone or local path. `Reference.Service` handles resolution. |
| **Session event schema** | `packages/core/src/session-event.ts` (new) | Canonical v2 event taxonomy: `Step`, `Reasoning`, `Tool.Input/Called/Success`, `Compaction`, `Message.*`, `Error`. |

### MEDIUM PRIORITY

| Pattern | File | What to adopt |
|---------|------|---------------|
| **Image normalization** | `packages/opencode/src/session/processor.ts` | Auto-resize tool result images before storage. Graceful degradation if resizer unavailable. |
| **Catalog service** | `packages/core/src/catalog.ts` (new) | Centralized provider/model store with Immer-based immutable updates, typed errors, plugin hooks. |
| **Auth V2** | `packages/core/src/auth.ts` (new) | Multi-account credential management with OAuth refresh, V1 migration, env var injection. |
| **AISDK service** | `packages/core/src/aisdk.ts` (new) | AI SDK provider integration with chunk timeout, signal composition, model caching. |
| **Zod removal from config** | `packages/opencode/src/config/*` | Pure Effect `Schema.decodeUnknownExit()` validation, eliminating Zod dependency. |
| **Reference bypass in tools** | `packages/opencode/src/tool/glob.ts`, `grep.ts` | `Reference.Service` allows bypassing `assertExternalDirectoryEffect` for configured references. |

### Patterns Worth Adopting (Cross-Cutting)

| Pattern | Description |
|---------|-------------|
| **`RuntimeFlags.Service`** | Feature flag service — gates experimental features (`experimentalEventSystem`, `outputTokenMax`, etc.) |
| **`EventV2Bridge` dual-write** | Publishes to legacy bus + new v2 event system simultaneously during migration |
| **Effect-only config validation** | `Schema.decodeUnknownExit()` + `Cause.pretty()` replaces Zod everywhere |
| **`containsPath()` extraction** | Standalone function extracted from `Instance` singleton — enables testability |
| **`Effect.orDie` on fatal errors** | Fail-fast for missing models, stale references — no silent corruption |
| **`Effect.forEach` + `Effect.exit`** | Graceful partial failure: process items individually, capture failures, continue |

### Adoption Order

1. **Immediate (low effort, high value):** JSON Schema generator, `outputTokenMax` overflow param, compaction v2 events, attachment config, session event schema
2. **Short-term (medium effort):** Image normalization, reference system, processor v2 events, Zod removal
3. **Long-term (architectural):** Catalog service, Auth V2, Instance → InstanceState migration

### NOT Adoptable

| Pattern | Reason |
|---------|--------|
| Instance singleton removal → `InstanceState.context` | We already use `InstanceState.context` extensively |
| Per-session DB queries rewritten | We already have per-project DBs |
| Self-reexport patterns | Already applied |
| Effect migration patterns | We already have Effect layer |

---

## Implementation Tracker

**Plan:** `plans/20260518_upstream_adoption_plan.md`

| # | Pattern | Status | Applied Date |
|---|---------|--------|-------------|
| 1 | JSON Schema generator | [x] Done | 2026-05-18 |
| 2 | OutputTokenMax overflow | [x] Done | 2026-05-18 |
| 3 | Attachment config | [x] Done | 2026-05-18 |
| 4 | Reference config | [x] Done | 2026-05-18 |
| 5 | EventV2 infrastructure (4 files) | [!] Blocked | — |
| 6 | Compaction v2 events | [!] Blocked | — |

**Blocked reason:** Items 5/6 depend on 12+ missing core modules (`location.ts`, `model.ts`, `session.ts`, `session-prompt.ts`, `tool-output.ts`, `v2-schema.ts`, `catalog.ts`, `schema.ts`, `config-service.ts`, `instance-store.ts`, `instance-ref.ts`). These need to be ported individually as a dependency chain.

### Comparison Checkpoints

Prevents re-comparing the same commit range:

| Date | Upstream commit | Scope | Action |
|------|----------------|-------|--------|
| 2026-05-18 | `71b27a1b0` | All packages | Patterns identified, plan created |
| _next_ | `new HEAD` | Changed files only | Diff from `71b27a1b0..new HEAD`, append findings |
