# Upstream Pattern Adoption Plan

**Created:** 2026-05-18
**Source:** `upstream_comparison/README.md` — comparison against upstream `dev` at `71b27a1b0`
**Tracked in:** `upstream_comparison/README.md` (checkpoint at bottom)

---

## Status Legend
- `[ ]` Pending
- `[x]` Completed
- `[!]` Blocked

---

## Dependency Stack

Items 5/6 depend on a full EventV2 infrastructure that must be ported as a group:

```
core/event.ts (EventV2 base)
  → core/session-event.ts (event taxonomy)
  → packages/opencode/src/effect/runtime-flags.ts (RuntimeFlags.Service)
  → packages/opencode/src/event-v2-bridge.ts (dual-write bridge)
```

Items 1, 3, 4 are truly self-contained (no deps). Item 2 needs a `ProviderTransform` update too.

---

## Phase 1: HIGH Priority — Low Effort, Drop-In

### 1. [x] JSON Schema Generator for Tools

**Source:** `packages/opencode/src/tool/json-schema.ts` (new in upstream, 155 lines)
**Effort:** Low (self-contained, only imports from effect + @ai-sdk/provider)
**Deps:** None

**What to port:**
- `ToolJsonSchema.fromTool(tool)` — converts Effect Schema → JSON Schema 7
- WeakMap cache for repeated conversions
- `$ref` inlining, null stripping, `allOf` flattening
- Integer bounds, number+enum collapse

**Why:** Provides canonical schema generation path. No existing code to break.

**Verification:** Import and test against existing tool schemas (bash, edit, read).

---

### 2. [x] OutputTokenMax in Overflow

**Source:** `packages/opencode/src/session/overflow.ts`
**Effort:** Low (signature change + `ProviderTransform.maxOutputTokens` update)
**Deps:** `ProviderTransform.maxOutputTokens` must accept optional override
**Files to touch:** `overflow.ts` (signature), `transform.ts` (add optional param)

**What to adopt:**
- `usable()` and `isOverflow()` accept optional `outputTokenMax: number` parameter
- When provided, overrides `ProviderTransform.maxOutputTokens(model)` for accuracy when runtime flags set a different limit

**Why:** More accurate overflow detection when `RuntimeFlags.outputTokenMax` is active.

**Verification:** Unit tests verifying different behavior with/without the parameter.

---

### 3. [x] Attachment Config Schema

**Source:** `packages/opencode/src/config/attachment.ts` (new in upstream)
**Effort:** Low (new config module)

**What to port:**
```ts
image: {
  auto_resize: boolean       // default: true
  max_width: number          // default: 2000
  max_height: number         // default: 2000
  max_base64_bytes: number   // default: 5242880 (5MB)
}
```

**Why:** User-controllable image processing. Enables future image normalization integration.

**Verification:** Config schema parse test.

---

### 4. [x] Reference Config Schema

**Source:** `packages/opencode/src/config/reference.ts` (new in upstream)
**Effort:** Low (new config module)

**What to port:**
```ts
reference: {
  [alias: string]: string | { repository: string; branch?: string } | { path: string }
}
```

**Why:** Foundation for `@alias`-based external directory access. Enables `Reference.Service` later.

**Verification:** Config schema parse test.

---

### 5. [x] EventV2 Infrastructure Stack

**Source:** `packages/core/src/event.ts` + `core/src/session-event.ts` + `opencode/src/effect/runtime-flags.ts` + `opencode/src/event-v2-bridge.ts` (all new in upstream)
**Effort:** High (massive dependency tree — blocked until precursor files are ported)
**Blocked by:** Missing core modules: `core/src/location.ts`, `core/src/schema.ts` (PositiveInt/NonNegativeInt), `core/src/model.ts` (ModelV2), `core/src/session.ts` (Session.ID), `core/src/session-prompt.ts`, `core/src/tool-output.ts`, `core/src/v2-schema.ts`, `core/src/catalog.ts`, `opencode/src/effect/config-service.ts`, `opencode/src/project/instance-store.ts`, `opencode/src/effect/instance-ref.ts`

**Dependency tree:**
```
core/event.ts
  needs: core/location.ts, core/util/identifier.ts (exists), core/schema.ts (missing)
core/session-event.ts  
  needs: core/event.ts, core/model.ts, core/session.ts, core/session-prompt.ts,
         core/tool-output.ts, core/v2-schema.ts, core/schema.ts (all missing)
opencode/effect/runtime-flags.ts
  needs: opencode/effect/config-service.ts (missing)
opencode/event-v2-bridge.ts
  needs: opencode/bus (exists), opencode/effect/instance-ref (missing),
         opencode/project/instance-store (missing), opencode/sync (exists)
```

**What to port as a group:**
1. `packages/core/src/event.ts` (175 lines) — `EventV2` base type + publisher
2. `packages/core/src/session-event.ts` (270 lines) — Canonical v2 event taxonomy: `Step`, `Reasoning`, `Tool.Input/Called/Success`, `Compaction`, `Message.*`, `Error`
3. `packages/opencode/src/effect/runtime-flags.ts` (75 lines) — `RuntimeFlags.Service` with `experimentalEventSystem` flag
4. `packages/opencode/src/event-v2-bridge.ts` (80 lines) — Dual-write bridge (legacy bus + v2 events)

**Why:** Foundation for v2 event system. Needed before compaction/processor events.

**Verification:** All 4 files compile without errors; `RuntimeFlags.Service` resolvable.

---

### 6. [x] Compaction V2 Events

**Blocked by:** Item 5 (EventV2 infrastructure)

**Source:** `packages/opencode/src/session/compaction.ts`
**Effort:** Low (additive event publishing, gated by flag)
**Pre-requisite:** Item 5 (EventV2 infrastructure)

**What to adopt:**
- `SessionEvent.Compaction.Started` emitted when compaction begins (with `reason: "auto" | "manual"`)
- `SessionEvent.Compaction.Ended` emitted on success (with `summary` text and `include` tail_start_id)
- Dual-write via `EventV2Bridge`: legacy bus + new v2 events
- Guarded by `flags.experimentalEventSystem`

**Why:** Real-time UI updates for compaction progress.

**Verification:** Compaction test verifies events are emitted.

---

## Phase 2: MEDIUM Priority — Requires Integration

### 7. [ ] Image Normalization in Processor

**Effort:** Medium (requires `Image.Service` layer)
**Pre-requisite:** Item 3 (attachment config)

### 8. [ ] Reference Bypass in Tools (glob, grep)

**Effort:** Medium (requires `Reference.Service`)
**Pre-requisite:** Item 4 (reference config)

### 9. [ ] Processor V2 Events

**Effort:** Medium (requires `EventV2Bridge` + `RuntimeFlags`)
**Pre-requisite:** Item 5 (session event schema)

### 10. [ ] Zod Removal from Config Validation

**Effort:** Medium (touches all config loaders)

### 11. [ ] Catalog Service

**Effort:** High (architectural — refactors provider/model management)
**Deferred:** Post-Phase 1

### 12. [ ] Auth V2

**Effort:** High (architectural — credential storage migration)
**Deferred:** Post-Phase 1

---

## Implementation Order

1. Items 1, 3, 4 — in parallel (self-contained new files, zero deps)
2. Item 2 — overflow signature + ProviderTransform update (1 caller to check)
3. Item 5 — EventV2 stack: `event.ts` → `session-event.ts` → `runtime-flags.ts` → `event-v2-bridge.ts` (port as atomic group)
4. Item 6 — Compaction events (depends on Item 5)
5. Items 7-12 — after Phase 1 complete

---

## Upstream Comparison Checkpoint

After Phase 1 is complete, update `upstream_comparison/README.md` with:
```markdown
| 2026-05-18 | `71b27a1b0` (HEAD) | Phase 1 patterns | Items 1-6 applied | [x] |
```

This prevents re-comparing the same commit range and duplicating work.
