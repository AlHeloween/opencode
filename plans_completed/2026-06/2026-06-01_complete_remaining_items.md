# Complete Remaining Items Plan

**Created:** 2026-06-01
**Updated:** 2026-06-23 — 4 items resolved (1.4 REJECTED, 2.1 DONE, 2.3 DONE, 2.7 DONE)
**Status:** Active — 11 open items remain across Parts 1-3; Part 4 is deferred scoping

---

## Part 1: Quick Wins (Low Effort, High Value)

### 1.1 [ ] `drizzle.config.ts` — Enable future migrations

**File:** `packages/opencode/drizzle.config.ts` (NEW)
**Effort:** 5 min
**What:** Standard Drizzle Kit config pointing to our schema files
**Why:** Enables `bun run db generate --name <slug>` for future schema changes

```ts
import { defineConfig } from "drizzle-kit"
export default defineConfig({
  schema: "./src/**/*.sql.ts",
  out: "./migration",
  dialect: "sqlite",
})
```

### 1.2 [ ] `isOrphanedInterruptedTool()` guard

**File:** `packages/opencode/src/session/prompt.ts` (MODIFY)
**Effort:** 15 min
**What:** Filter out tool parts with `state.status === "error" && state.metadata?.interrupted === true` from assistant prefill logic
**Why:** Prevents interrupted tools from appearing in model context

### 1.3 [ ] Summary diff lazy compute

**File:** `packages/opencode/src/session/summary.ts` (MODIFY)
**Effort:** 15 min
**What:** Skip expensive diff computation when `config.snapshot === false`. Read diffs from stored message summary instead of recomputing.
**Why:** Performance — diffs are expensive and often unused

### 1.4 [x] `yield* db.transaction()` pattern — REJECTED

**File:** `packages/opencode/src/session/todo.ts` (MODIFY)
**Effort:** 10 min
**What:** Replace `Effect.sync(() => Database.transaction(...))` with `yield* db.transaction((tx) => Effect.gen(...))`
**Why:** Cleaner effect code, better type safety
**Status:** REJECTED — `Database.transaction()` is synchronous; `Effect.sync(() => tx(...))` is the correct pattern

### 1.5 [x] Orphan reasoning delta guard

**File:** `packages/opencode/src/session/processor.ts` (MODIFY)
**Effort:** 10 min
**What:** Silently drop `reasoning-delta` events without preceding `reasoning-start`
**Why:** Bug fix — malformed event streams can crash the processor

---

## Part 2: Medium Effort

### 2.1 [x] EventV2Bridge → plugin layer

**Files:** `packages/opencode/src/plugin/index.ts` (MODIFY)
**Effort:** 15 min
**What:** Replace `bus.subscribeAll()` with `events.all()` from `EventV2Bridge.Service` (injected outside InstanceState.make closure, same pattern as bus)
**Depends on:** EventV2Bridge.Service already exists in our codebase
**Done:** 2026-06-23 — `eventsBus.all()` replaces `bus.subscribeAll()` in plugin event subscription

### 2.2 [ ] RuntimeFlags + Codex WebSocket flags

**Files:** `packages/opencode/src/plugin/index.ts` (MODIFY)
**Effort:** 30 min
**What:** Add `RuntimeFlags.defaultLayer` to plugin layer. Gate `experimentalWebSockets` behind flag in Codex plugin.
**Depends on:** RuntimeFlags already exists in our codebase

### 2.3 [x] Processor extractions

**Files:** `packages/opencode/src/session/processor.ts` (MODIFY)
**Effort:** 1h
**What:** Extract three functions from inline logic:
- `ensureToolCall()` — consolidates tool creation **[x] already done (line 282)**
- `finishReasoning()` — flushes pending reasoning on step-finish **[x] already done (line 307)**
- `toolResultOutput()` — normalizes both structured and raw tool result output **[x] no-op: AI SDK event structure already provides normalized output shape `{ title, metadata, output, attachments }`**

### 2.4 [ ] Session usage tracking migration

**Files:** New migration file (NEW)
**Effort:** 30 min
**What:** Port upstream's `20260510033149_session_usage` migration — adds token tracking columns to session table
**Note:** Adapt for our DB schema

### 2.5 [ ] Tool resolution consolidation

**Files:** `packages/opencode/src/session/tools.ts` (NEW)
**Effort:** 1.5h
**What:** Extract tool resolution logic from `prompt.ts` into dedicated module. Handles registry tools + MCP tools with context, permissions, plugin hooks.
**Depends on:** Our existing tool registry and MCP integration

### 2.6 [ ] LLM request preparation — DEFERRED

**Files:** `packages/opencode/src/session/llm/request.ts` (NEW)
**Effort:** 2h
**What:** Consolidate system prompt assembly, message formatting, tool resolution, header construction, and provider-specific options into `LLMRequestPrep.prepare()`.
**Note:** Adapted from upstream for our architecture
**Status:** DEFERRED — 383-line `LLM.run()` works correctly; refactor is cleanliness-only, no bug to fix

### 2.7 [x] Git service abstraction

**Files:** `packages/opencode/src/git/index.ts` (EXISTS)
**Effort:** 1h
**What:** Clone, checkout, branch, status as Effect service
**Why:** Cleaner than ad-hoc git calls
**Done:** Already implemented — 260 lines, Effect service with 10 methods

---

## Part 3: External Package Dependencies

### 3.1 [ ] Audio metadata extraction

**Package:** `music-metadata`
**File:** `packages/opencode/src/attachment/handlers/audio.ts` (MODIFY)
**Effort:** 30 min
**What:** Parse WAV/MP3/OGG headers to extract duration, sample rate, channels, codec

### 3.2 [ ] Video keyframe extraction

**Package:** `fluent-ffmpeg` or metadata-only
**File:** `packages/opencode/src/attachment/handlers/video.ts` (MODIFY)
**Effort:** 45 min
**What:** Extract duration, dimensions, fps from container headers (no full decode needed)

### 3.3 [ ] HDF5 sensor reader

**Package:** `h5wasm`
**File:** `packages/opencode/src/attachment/handlers/sensor.ts` (MODIFY)
**Effort:** 1h
**What:** Parse HDF5 files to extract dataset names, shapes, dtypes, attributes

### 3.4 [ ] Image resizing

**Package:** `sharp` or `jimp`
**File:** `packages/opencode/src/attachment/handlers/image.ts` (MODIFY)
**Effort:** 1h
**What:** Resize images per `ConfigAttachment.image.max_width/max_height` before storage

### 3.5 [ ] Archive file listing

**Package:** `adm-zip`, `tar-stream`
**File:** `packages/opencode/src/attachment/handlers/archive.ts` (MODIFY)
**Effort:** 30 min
**What:** List files, sizes, compression ratio from archive headers

---

## Part 4: Deferred — Scoping Only

These are scoped for awareness; implementation deferred to future sessions.

### 4.1 [ ] ACP module
**Scope:** 12 files, agent client protocol for third-party AI agent control

### 4.2 [ ] HTTP API v2 restructure
**Scope:** Groups/handlers/middleware separation, cursor-based pagination

### 4.3 [ ] MCP OAuth overhaul
**Scope:** Remote MCP server authentication with PKCE

### 4.4 [ ] Catalog service
**Scope:** Centralized provider/model store — tied to architectural decision

### 4.5 [ ] Auth V2 / Account service
**Scope:** Multi-account credential management — tied to architectural decision

### 4.6 [ ] PluginV2 hook rename
**Scope:** `provider.update` → `catalog.transform` — tied to Catalog adoption

### 4.7 [ ] FTS trigger update for `$.kind`
**Scope:** Add `json_extract(new.data, '$.kind')` to FTS triggers

### 4.8 [ ] Remove inline SQL (Phase A4)
**Scope:** Remove CORE_SCHEMA_SQL after migration system verified

---

## Implementation Order

```
Part 1 (Quick Wins) → Part 2 (Medium) → Part 3 (External)
     │                     │                    │
     ▼                     ▼                    ▼
  1-2 hours             5-8 hours           3-4 hours
```

Parts 1 and 2 items can be done in parallel within each group.
Part 3 items need `bun install` for each package first.

---

## Verification

### Per item
- Typecheck after each change
- For processor changes: verify existing session tests don't break
- For migrations: verify on fresh + existing databases

### End-to-end
1. `bun typecheck` — both packages
2. Migration runner creates tracking table on fresh DB
3. Migration runner backfills existing DB
4. All 14 attachment handlers classify correctly
5. Registry.isMedia() matches old behavior
6. ProviderCapabilityMatrix returns correct capabilities
7. Embeddings table created via migration + inline SQL
8. Audio/video handlers extract metadata from test fixtures
9. Image handler resizes test image
