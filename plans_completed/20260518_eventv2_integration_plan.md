# EventV2 Infrastructure Integration Plan

**Created:** 2026-05-18
**Source:** Deep investigation of upstream `dev` EventV2 system vs `Local_Development` branch
**Refs:** `upstream_comparison/README.md`, `plans/20260518_upstream_adoption_plan.md`

---

## Status: `[x]` Phase 1 (Core) · `[!]` Phase 2 (Schema) · `[!]` Phase 3 (Bridge) · `[!]` Phase 4 (Wiring)

---

## Phase 1: Core Event Bus (3 → 2 files)

### 1.1 [x] `packages/core/src/schema.ts`
Re-exports `withStatics` + `NonNegativeInt` from `packages/opencode/src/util/schema.ts`.

### 1.2 [x] `packages/core/src/event.ts`
EventV2.Service — PubSub-based typed event bus. Ported from upstream with adaptations:
- `Location.Ref` inlined (no `core/location.ts`)
- `withStatics` from Phase 1.1
- `Identifier.ascending()` from existing `core/util/identifier.ts`

### 1.3 [x] `packages/core/src/util/identifier.ts` — ALREADY EXISTS (48 lines)

---

## Phase 2: Schema Dependencies + Event Taxonomy (6 files)

### 2.4 [x] `packages/core/src/v2-schema.ts`
`DateTimeUtcFromMillis` codec (5 lines, ported from upstream).

### 2.5 [x] `packages/core/src/provider.ts`
`ProviderV2.ID` + well-known provider constants (ported minimal from upstream).

### 2.6 [x] `packages/core/src/model.ts`  
`ModelV2.ID` + `ModelV2.Ref` + `ModelV2.VariantID` — minimal port, skip Info/Cost.

### 2.7 [x] `packages/core/src/tool-output.ts`
`TextContent` + `FileContent` + `Content` (union) + `Structured` — minimal schemas.

### 2.8 [x] `packages/core/src/session.ts`
Re-export `SessionID` from `packages/opencode/src/session/schema.ts` as `Session.ID`.

### 2.9 [x] `packages/core/src/session-event.ts`
Full v2 event taxonomy (~270 lines). Ported from upstream with adaptations.

---

## Phase 3: Bridge + Runtime Flags (3 files)

### 3.10 [x] `packages/opencode/src/effect/config-service.ts`
ConfigService base class for RuntimeFlags.

### 3.11 [x] `packages/opencode/src/effect/runtime-flags.ts`
RuntimeFlags.Service — feature flag service with `experimentalEventSystem`.

### 3.12 [x] `packages/opencode/src/event-v2-bridge.ts`
Dual-write bridge — refactored InstanceStore → `Instance.provide()`.

---

## Phase 4: Bootstrap Wiring (2 files to modify)

### 4.13 [x] Add EventV2 + Bridge layers to `packages/opencode/src/effect/app-runtime.ts`
### 4.14 [x] Add compaction v2 events to `packages/opencode/src/session/compaction.ts`

---

**Total:** 12 new files, 2 modified, ~700 lines.
