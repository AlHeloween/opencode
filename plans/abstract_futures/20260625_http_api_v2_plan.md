---
status: execution
owner: codex
created: 2026-06-25
updated: 2026-06-28
reproduce:
  - cd packages/opencode
  - bun typecheck
  - bun run src/server/server.ts --test-endpoints
---

# HTTP API v2 Restructure Plan

## Goal

Complete the migration from legacy Hono routes to the Effect HttpApi system, eliminate code duplication between the two parallel implementations, and add URL-path API versioning for forward compatibility.

## Abstract Definition

The server previously maintained **two complete API implementations** using identical URL paths. The `OPENCODE_EXPERIMENTAL_HTTPAPI` flag has been removed, the legacy Hono route files have been deleted, and `src/server/routes/instance/index.ts` now proxies all instance endpoints through `ExperimentalHttpApiServer.webHandler().handler`. The Effect HttpApi layer is the sole runtime implementation.

Remaining Phase 1 work: audit HttpApi endpoint coverage, add missing endpoints, add integration tests, verify schema parity, and regenerate the SDK from the HttpApi OpenAPI spec.

Phase 2 (API versioning) is blocked by the SDK generator — see [BLOCKED] 2.1.

## Formalization

```
Let H = { set of Hono route handlers }
Let E = { set of Effect HttpApi handlers }

Current state: Both H and E are registered simultaneously (not mutually exclusive).
               The flag gates only workspace routes in server.ts; instance route gating
               is in index.ts. Majority of routes are dual-registered. No URL versioning exists.

Target state (Phase 1): H is removed. E is the sole implementation.
Target state (Phase 2): /v2/ prefix added to all routes (or E replaces root-level routes).
                        Legacy /v1/ routes preserved via proxy to E (if needed for backward compat).
```

## Structural Diagram

```
Current Architecture (after Phase 1 partial completion):
  request → Hono App
    ├── `InstanceRoutes()` in index.ts — thin proxy routing 50+ endpoint paths through
    │   `ExperimentalHttpApiServer.webHandler().handler`, via individual `app.get/post()`
    │   registrations. HttpApi is the runtime implementation.
    ├── 8 standalone endpoints (/instance/dispose, /path, /vcs, /vcs/diff, /command,
    │   /agent, /skill, /lsp, /formatter) — direct Hono+Effect handlers in index.ts:142-372
    │   using `hono-openapi` + `describeRoute`.
    └── Legacy Hono route files: deleted (only index.ts, middleware.ts, trace.ts, tui.ts remain)

Target Architecture (Phase 2 — versioning):
  request → Hono App
    ├── /v1/*  → (optional) legacy proxy → E
    └── /v2/*  → Effect HttpApi (all routes under version prefix)
        SDK regenerated from /v2/* OpenAPI spec
```

## Phase 1 Tasks: Remove Legacy Route Duplication

- [x] 1.1 Audit HttpApi coverage: identify any endpoints handled by `InstanceRoutes()` that lack HttpApi equivalents — inspect `InstancePaths`, `SessionPaths`, `McpPaths`, etc. in `index.ts:26-141` vs `httpapi/*.ts` files
  - **Result**: 109 paths proxied, 109 HttpApi endpoints → **0 gaps. Full coverage.**
  - **Bug found**: 9 InstancePaths (lines 65-73) are **dual-registered** with standalone handlers (lines 142-372). See task 1.12.
  - **Orphan**: ControlApi (3 endpoints) and GlobalApi (5 endpoints) defined in `httpapi/*.ts` but **unwired in server.ts**. See task 1.13.
- [x] 1.2 Implement missing endpoints in HttpApi (if any found)
  - **Result**: None needed — coverage is complete.
- [ ] 1.3 Add HttpApi integration tests for all endpoints
- [ ] 1.4 Verify request/response schema parity between old `describeRoute` OpenAPI output and HttpApi-generated OpenAPI spec
- [x] 1.5 Run the full SDK regeneration pipeline against HttpApi OpenAPI output
  - **Result**: Generator ran successfully, both v1 and v2 SDK regenerated. However, consumer code (acp/agent.ts, cli/cmd, tui components, plugins) has 160+ TS errors due to API restructuring (instance→group methods). This is the Phase 2 blocker — consumer migration needed.
- [x] 1.6 Remove `OPENCODE_EXPERIMENTAL_HTTPAPI` flag gating — flag removed from codebase (confirmed: zero grep hits)
- [x] 1.7 Delete legacy Hono route files — 14 legacy files deleted. Only `index.ts` (rewritten proxy), `middleware.ts`, `trace.ts`, `tui.ts` remain
- [x] 1.8 Trim legacy index.ts — `index.ts` now routes 50+ paths through `ExperimentalHttpApiServer.webHandler().handler`. Only 8 standalone endpoints retain direct handlers
- [x] 1.9 Verify standalone endpoints have HttpApi equivalents — confirmed standalone endpoints use `InstancePaths` constants pointing to HttpApi.
  - **Audit found dual registration bug**: 9 InstancePaths registered BOTH as HttpApi proxy (lines 65-73) AND as standalone handlers (lines 142-372). See task 1.12.
- [x] 1.10 Update `server.ts` — flag removed, `InstanceRoutes()` used unconditionally, routes through HttpApi handler
- [x] 1.11 Run typecheck — passes (zero errors)
- [x] 1.12 Fix dual registration of 9 InstancePaths in `index.ts` (lines 65-73 proxy + lines 142-372 standalone). Only ONE registration should exist. Two options:
  - **Option A (preferred)**: Remove proxy lines 65-73 (keep standalone handlers), since standalone handlers already proxy through Effect via `jsonRequest` helpers. Add `describeRoute` annotations directly.
  - **Option B**: Remove standalone handlers (lines 142-372), keep proxy only. Would lose `describeRoute` OpenAPI metadata for these 9 endpoints — must verify HttpApi generates equivalent OpenAPI for them.
  - **Decision**: Applied Option A — removed 9 proxy lines + unused `InstancePaths` import. Typecheck clean.
- [x] 1.13 Wire orphan HttpApi groups (ControlApi, GlobalApi) in server.ts, or delete them if unused. Currently defined in `public.ts` but `HttpApiBuilder.layer(...)` is never called for them in server.ts.
  - **Done**: `GlobalApi` wired with `health` and `dispose` endpoints implemented. `event` (SSE), `configGet`, `configUpdate` return 501. `ControlApi` remains unwired (separate scope — auth/log endpoints).
- [ ] 1.14 Reconcile EventApi — currently uses raw `HttpRouter.add` instead of `HttpApiBuilder.layer`. Migrate to standard `HttpApiBuilder.layer`.

## Phase 2 Tasks: Add API Versioning

- [BLOCKED] 2.1 Prefix all HttpApi routes with `/v2` — SDK generator restructures OpencodeClient on prefix change. Needs separate generator config plan before prefix can be applied. See: `packages/sdk/js/script/build.ts` generator restructures client API (instance→group methods) causing 160+ TS errors.
- [ ] 2.2 Add OpenAPI version field: `info.version = "2.0.0"` in spec generation
- [ ] 2.3 Add `/v1` proxy group that forwards to `/v2` for backward compatibility (if needed)
- [ ] 2.4 Regenerate SDK from `/v2` OpenAPI spec
- [ ] 2.5 Update SDK `client.ts` to use `/v2` base path
- [ ] 2.6 Update all internal consumers (web UI, desktop, CLI) to use `/v2` paths
- [ ] 2.7 Add deprecation headers to `/v1` proxy responses (`Sunset`, `Deprecation`)
- [ ] 2.8 Document migration path for external SDK consumers
- [ ] 2.9 Run typecheck + full test suite + end-to-end TUI test

## Input/Output Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| Input: `src/server/routes/instance/httpapi/*.ts` (17 files) | TS | Effect HttpApi endpoint definitions |
| Input: `src/server/routes/instance/*.ts` (14 Hono files) | TS | Legacy Hono route definitions |
| Input: `src/server/server.ts` | TS | Server composition + flag gating |
| Input: `packages/sdk/openapi.json` | JSON | OpenAPI 3.1.1 spec (13,354 lines) |
| Input: `packages/sdk/js/src/v2/` | TS | Auto-generated SDK client |
| Output: Deleted legacy Hono files | — | 14 files removed |
| Output: Updated `server.ts` | TS | Flag removed, HttpApi is default |
| Output: Versioned routes | — | All under `/v2/` prefix |
| Output: Updated SDK | TS | Base path `/v2`, no `/v1` dependency |

## Brief Implementation

### Phase 1 — Endpoint Audit

```bash
# List all legacy Hono route registrations
rg "app\.(get|post|put|delete|patch)\(|route\(" src/server/routes/instance/index.ts

# List all HttpApi endpoint registrations  
rg "HttpApiBuilder\.(get|post|put|delete|patch)\(|HttpApiGroup\." src/server/routes/instance/httpapi/ -l
```

Map each legacy endpoint to its HttpApi equivalent. Flag any gaps.

### Phase 1 — Remove Duplication

In `server.ts`, the current gating:

```typescript
if (process.env.OPENCODE_EXPERIMENTAL_HTTPAPI) {
  app.route("/", webHandler())
} else {
  app.route("/", InstanceRoutes())
}
```

Becomes:

```typescript
app.route("/", webHandler())
```

Delete:
- `src/server/routes/instance/session.ts` (1181 lines, non-httpapi version)
- `src/server/routes/instance/config.ts` (non-httpapi)
- `src/server/routes/instance/project.ts` (non-httpapi)
- `src/server/routes/instance/provider.ts` (non-httpapi)
- `src/server/routes/instance/file.ts` (non-httpapi)
- `src/server/routes/instance/pty.ts` (non-httpapi)
- `src/server/routes/instance/mcp.ts` (non-httpapi)
- `src/server/routes/instance/sync.ts` (non-httpapi)
- `src/server/routes/instance/question.ts` (non-httpapi)
- `src/server/routes/instance/permission.ts` (non-httpapi)
- `src/server/routes/instance/experimental.ts` (non-httpapi)
- `src/server/routes/instance/tui.ts` (non-httpapi)
- `src/server/routes/instance/event.ts` (non-httpapi)
- `src/server/routes/instance/index.ts` (non-httpapi) — or trim to remove Hono registration, keep only utility exports
- `src/server/routes/instance/middleware.ts` — if HttpApi has equivalent (check `httpapi/auth.ts`)

### Phase 2 — Version Prefix

```typescript
// packages/opencode/src/server/routes/instance/httpapi/public.ts
export const PublicApi = HttpApi.make("opencode")
  .prefix("/v2")  // ← single-line change
  .addHttpApi(GlobalApi)
  .addHttpApi(ConfigApi)
  // ... all other APIs
```

SDK regeneration:

```bash
cd packages/opencode
bun run src/server/server.ts openapi --prefix /v2 > ../sdk/openapi.json
cd ../sdk/js
bun run script/build.ts
```

### Phase 2 — Backward Compat Proxy (if needed)

```typescript
// Optional: proxy /v1/* to /v2/* during transition
app.use("/v1/*", async (c) => {
  const v2Url = c.req.url.replace("/v1/", "/v2/")
  const response = await fetch(v2Url, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== "GET" ? await c.req.raw.text() : undefined,
  })
  return new Response(response.body, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      "Deprecation": "true",
      "Sunset": "Sat, 01 Aug 2026 00:00:00 GMT",
      "Link": `</v2${new URL(c.req.url).pathname}>; rel="successor-version"`,
    },
  })
})
```

## Test Cases

| # | Description | Oracle |
|---|-------------|--------|
| P1.1 | All HttpApi endpoints return correct status codes | HTTP 200/201 for valid requests |
| P1.2 | All HttpApi endpoints reject invalid requests with proper error codes | HTTP 400/404/422 with error body |
| P1.3 | SDK regeneration against HttpApi OpenAPI produces valid client | `build.ts` exits 0, typecheck passes |
| P1.4 | Legacy route files deleted, no import errors | `bun typecheck` clean |
| P1.5 | Server starts without OPENCODE_EXPERIMENTAL_HTTPAPI flag | All endpoints accessible |
| P2.1 | All endpoints accessible under `/v2/` prefix | HTTP 200 for `/v2/session` etc. |
| P2.2 | SDK client uses `/v2/` base path | Generated client hits correct URLs |
| P2.3 | `/v1/` proxy forwards correctly (if implemented) | `/v1/session` → `/v2/session` |
| P2.4 | Deprecation headers present on `/v1/` responses | `Deprecation: true`, `Sunset:` header |
| P2.5 | Web UI / desktop clients work with `/v2/` paths | End-to-end session creation succeeds |

## Risk Assessment

- **HIGH**: Deleting legacy Hono routes before HttpApi has full parity. Mitigation: Phase 1.1 audit must be exhaustive. Any gap found = blocker.
- **MEDIUM**: SDK regeneration may produce subtly different types from HttpApi vs Hono. Mitigation: compare generated `openapi.json` before/after.
- **LOW**: External consumers using `/v1/` paths without version prefix. Mitigation: proxy in Phase 2.3 maintains backward compat.
- **LOW**: `hono-openapi` decorators on legacy routes may be the source of truth for the OpenAPI spec. If HttpApi doesn't generate equivalent OpenAPI metadata, the spec regresses. Mitigation: verify HttpApi's OpenAPI generation (Effect's `HttpApi` has `OpenApi` integration via `@effect/platform`).
