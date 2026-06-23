# Remaining Items Plan

**Created:** 2026-06-23 — carried forward from `20260601_complete_remaining_items.md` (now in `plans_completed/`)
**Status:** Active — audited 2026-06-23. This is no longer a greenfield checklist; several items already exist in code and the remaining work is mostly validation, stabilization, or deferred architecture.

Audit summary (2026-06-23):
- `packages/opencode/drizzle.config.ts` already exists and matches the planned Drizzle Kit shape.
- `packages/opencode/src/session/summary.ts` already skips diff computation when `config.snapshot === false`.
- `RuntimeFlags.defaultLayer` is already provided to the plugin layer; WebSocket flag usage still needs a focused code audit.
- `packages/opencode/src/session/tools.ts` already exists; future work should verify behavior/tests rather than create the module.
- Attachment metadata handlers and required packages already exist for audio, image, archive, sensor, and video; remaining work is fixture coverage and runtime validation.
- Session-level usage/cost columns already exist in schema and are accumulated in `processor.ts`; migration/backfill state still needs verification.

Resolved in prior plan (2026-06-23):
- 1.4 REJECTED — `Effect.sync(() => tx(...))` is correct for sync `Database.transaction()`
- 1.5 [x] Orphan reasoning delta guard
- 2.1 REVERTED — `eventsBus.all()` is invalid in this fork until legacy Bus producers migrate to EventV2; plugin hooks remain on `bus.subscribeAll()`
- 2.3 [x] `ensureToolCall()` and `finishReasoning()` already extracted; `toolResultOutput()` no-op (AI SDK normalizes)
- 2.7 [x] Git service abstraction — already exists at `packages/opencode/src/git/index.ts` (260 lines)

---

## Part 1: Quick Wins (Low Effort, High Value)

### 1.1 [x] `drizzle.config.ts` — Enable future migrations

**File:** `packages/opencode/drizzle.config.ts` (NEW)
**Effort:** 5 min
**What:** Standard Drizzle Kit config pointing to our schema files
**Why:** Enables `bun run db generate --name <slug>` for future schema changes

**Audit:** Implemented at `packages/opencode/drizzle.config.ts`.

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

### 1.3 [x] Summary diff lazy compute

**File:** `packages/opencode/src/session/summary.ts` (MODIFY)
**Effort:** 15 min
**What:** Skip expensive diff computation when `config.snapshot === false`. Read diffs from stored message summary instead of recomputing.
**Why:** Performance — diffs are expensive and often unused

**Audit:** Implemented in `packages/opencode/src/session/summary.ts`; when `cfg?.snapshot === false`, summary counters are set without calling `computeDiff()`.

---

## Part 2: Medium Effort

### 2.2 [ ] RuntimeFlags + Codex WebSocket flags — audit remaining gate

**Files:** `packages/opencode/src/plugin/index.ts` (MODIFY)
**Effort:** 30 min
**What:** Add `RuntimeFlags.defaultLayer` to plugin layer. Gate `experimentalWebSockets` behind flag in Codex plugin.
**Depends on:** RuntimeFlags already exists in our codebase

**Audit:** `RuntimeFlags.defaultLayer` is already provided in `packages/opencode/src/plugin/index.ts`. Remaining work is to verify whether the Codex plugin actually gates `experimentalWebSockets` on `RuntimeFlags.experimentalWebSockets`.

### 2.4 [ ] Session usage tracking migration — verify/backfill only

**Files:** New migration file (NEW)
**Effort:** 30 min
**What:** Verify migration/backfill behavior for existing databases that predate the session usage columns.
**Audit:** `packages/opencode/src/session/session.sql.ts` already contains cost/token columns, and `packages/opencode/src/session/processor.ts` already accumulates session-level usage. Do not blindly port upstream as a new greenfield migration without checking local migration history.

### 2.5 [x] Tool resolution consolidation

**Files:** `packages/opencode/src/session/tools.ts` (NEW)
**Effort:** 1.5h
**What:** Extract tool resolution logic from `prompt.ts` into dedicated module. Handles registry tools + MCP tools with context, permissions, plugin hooks.
**Depends on:** Our existing tool registry and MCP integration

**Audit:** `packages/opencode/src/session/tools.ts` already exists. Future work should be limited to behavior gaps or tests found by code review.

### 2.6 [ ] LLM request preparation — DEFERRED

**Files:** `packages/opencode/src/session/llm/request.ts` (NEW)
**Effort:** 2h
**What:** Consolidate system prompt assembly, message formatting, tool resolution, header construction, and provider-specific options into `LLMRequestPrep.prepare()`.
**Note:** Adapted from upstream for our architecture
**Status:** DEFERRED — 383-line `LLM.run()` works correctly; refactor is cleanliness-only, no bug to fix

---

## Part 3: External Package Dependencies — verification backlog

Audit: the dependencies and handler files are already present. Treat this section as a fixture/test/runtime-validation backlog, not as new package-selection work.

### 3.1 [ ] Audio metadata extraction — verify fixtures

**Package:** `music-metadata`
**File:** `packages/opencode/src/attachment/handlers/audio.ts` (MODIFY)
**Effort:** 30 min
**What:** Parse WAV/MP3/OGG headers to extract duration, sample rate, channels, codec

### 3.2 [ ] Video metadata extraction — verify fixtures

**Package:** `fluent-ffmpeg` or metadata-only
**File:** `packages/opencode/src/attachment/handlers/video.ts` (MODIFY)
**Effort:** 45 min
**What:** Extract duration, dimensions, fps from container headers (no full decode needed)

### 3.3 [ ] HDF5 sensor reader — verify fixtures

**Package:** `h5wasm`
**File:** `packages/opencode/src/attachment/handlers/sensor.ts` (MODIFY)
**Effort:** 1h
**What:** Parse HDF5 files to extract dataset names, shapes, dtypes, attributes

### 3.4 [ ] Image resizing — verify fixtures

**Package:** `sharp` or `jimp`
**File:** `packages/opencode/src/attachment/handlers/image.ts` (MODIFY)
**Effort:** 1h
**What:** Resize images per `ConfigAttachment.image.max_width/max_height` before storage

### 3.5 [ ] Archive file listing — verify fixtures

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
Plan audit/cleanup → focused remaining quick win → capability/media verification
     │                     │                    │
     ▼                     ▼                    ▼
  30-45 min             30-90 min           2-4 hours
```

Do not run Part 3 as dependency installation; packages already exist. Add focused fixtures and run handler tests instead.

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
