# Remove Protocol Overrides — Single Source of Truth

## Goal

Eliminate all protocol configuration surfaces except `opencode.jsonc` → `model.options.protocol`. Currently protocol is set/read at **10 surfaces**, creating conflicts (e.g. config says H2, but adaptive learning disabled H2 after 19 failures, and the config unconditionally overrides the learning).

After this change, `model.options.protocol` in `opencode.jsonc` is the **only** place protocol is configured. The gateway adjustments store retains its non-protocol functions (health scoring, policy adaptation, circuit breaker, retry budget, streaming preference, confidence decay).

## Files to Modify

### 1. `packages/opencode/src/provider/gateway/config-manager.ts`

**Remove `protocol` field from config schema:**

| Action | Lines | Detail |
|--------|-------|--------|
| Remove | 32 | `protocol?: "h2" \| "http/1.1"` from `GatewayProviderConfig` |
| Remove | 46 | `gateway.protocol` from `GatewayModelConfig.gateway` |
| Remove | 130 | `preferH2` heuristic (`provider.id === "openai" \|\| provider.npm === "@ai-sdk/openai"`) |
| Remove | 143 | `preferH2 ? "h2" : "http/1.1"` default in provider config generation |
| Remove | 188-190 | Doc comment about `providers.<name>.protocol` |
| Remove | 200-201 | Doc comment about `models.<model>.gateway.protocol` |
| Remove | 210-218 | Example comment showing protocol override |
| Remove | 264 | `protocol: provider.protocol ?? existing.protocol` from merge |
| Remove | 280-281 | Legacy `preferH2` cleanup from gateway section |
| Remove | 342 | `preferH2` in `buildDefaultConfig()` |
| Remove | 353 | `preferH2 ? "h2" : "http/1.1"` in model default generation |
| Remove | 411 | `preferH2` in `ensureModelConfig()` |
| Remove | 437 | Protocol default in `ensureModelConfig()` auto-generation |
| Remove | 465 | Protocol default in local config sync |
| Remove | 519-531 | `getModelProtocol()` function entirely |
| Edit | 1-5 | Update auto-generated gateway.jsonc header comment to reflect protocol is no longer a gateway setting |

### 2. `packages/opencode/src/provider/provider.ts`

**Remove hardcoded OpenAI default:**

| Action | Lines | Detail |
|--------|-------|--------|
| Edit | 1491 | `gatewayProtocol: model.options?.protocol ?? (model.providerID === "openai" ? "h2" : undefined)` → `gatewayProtocol: model.options?.protocol` |

### 3. `packages/opencode/src/provider/gateway/adjustment-store.ts`

**Remove all protocol-related types and functions:**

| Action | Lines | Detail |
|--------|-------|--------|
| Remove | 40-44 | `ProtocolInfo` interface |
| Remove | 64-72 | `ProtocolPreference` interface |
| Remove | 74-84 | `defaultProtocolPreference()` |
| Remove | 86-89 | `H2_FALLBACK_THRESHOLD`, `H1_REUPGRADE_THRESHOLD`, `H2_PROBE_COOLDOWN_MS`, `FALLBACK_COOLDOWN_MS` |
| Remove | 91-109 | `recordH2Failure()` |
| Remove | 111-133 | `recordH1Success()` |
| Remove | 135-150 | `recordH2Success()` |
| Remove | 152-154 | `getEffectiveProtocol()` |
| Edit | 194-195 | `RouteAdjustment` — remove `protocol: ProtocolInfo` and `protocolPreference: ProtocolPreference` fields |
| Edit | 234-239 | `getOrCreateRoute()` — remove `protocol` and `protocolPreference` initializers |

### 4. `packages/opencode/src/provider/gateway/store.ts`

**Remove protocol-related functions and imports:**

| Action | Lines | Detail |
|--------|-------|--------|
| Edit | 7-17 | Imports from `adjustment-store` — remove: `recordH2Failure as adjustH2Failure` (line 12), `recordH1Success as adjustH1Success` (line 13), `recordH2Success as adjustH2Success` (line 14), `getEffectiveProtocol` (line 15), `defaultProtocolPreference` (line 16). Keep: `initialStore`, `getOrCreateRoute`, `updateStreamingPreference`, `defaultStreamingPreference`, `adaptPolicy as adaptPolicyFn`, `enforcePolicyFloors` |
| Remove | 174-176 | `load()` — remove `protocolPreference` normalization block (lines 171-173 are `streamingPreference` and must stay) |
| Edit | 170 | Update `load()` comment to remove mention of `protocolPreference` |
| Remove | 306-309 | `adjustProtocol()` function |
| Remove | 498-521 | `recordH2Failure()` function |
| Remove | 523-533 | `recordProtocolSuccess()` function |
| Remove | 535-538 | `getProtocolPreference()` function |
| Remove | 540-547 | `shouldProbeH2()` function |

### 5. `packages/opencode/src/provider/gateway/route-key.ts`

**Remove `negotiatedProtocol` from route identity:**

| Action | Lines | Detail |
|--------|-------|--------|
| Remove | 6-7 | `NegotiatedProtocolSchema` and `NegotiatedProtocol` type |
| Edit | 9-17 | `RouteKeySchema` — remove `negotiatedProtocol` field |
| Edit | 18 | `RouteKey` type — remove `negotiatedProtocol` |
| Edit | 27 | `toRouteKeyString()` — remove `proto=${key.negotiatedProtocol}` segment |
| Edit | 45 | `parseRouteKeyString()` — remove `negotiatedProtocol` from parsed result object |

### 6. `packages/opencode/src/provider/gateway/capability-probe.ts`

**Delete the file entirely.** ALPN probing no longer needed — protocol handled by config + per-request H2→H1 fallback.

### 7. `packages/opencode/src/provider/gateway/adaptive-client.ts`

**Simplify protocol decision logic and remove call sites:**

| Action | Lines | Detail |
|--------|-------|--------|
| Edit | 242 | `baseRouteKey` — remove `negotiatedProtocol: "unknown"` |
| Edit | 250-266 | Remove `negotiated` normalization and `preferredProtocol` ternary — just set `negotiatedProtocol = modelProtocol ?? "http/1.1"` at the routeKey construction |
| Remove | 268-277 | Async ALPN probe call (`probeRoute(baseUrl)` block) |
| Edit | 438-441 | Replace `useH2` ternary with `useH2 = modelProtocol === "h2"` |
| Edit | 443-465 | Simplify log payload (both sync and async logger blocks) — remove `negotiated` and `stored` |
| Remove | 479 | `Store.recordProtocolSuccess(routeKey, "h2")` call site |
| Remove | 504 | `Store.recordH2Failure(routeKey, ...)` call site |
| Remove | 530 | `Store.recordProtocolSuccess(routeKey, "h2")` call site |
| Remove | 550 | `Store.recordH2Failure(routeKey, ...)` call site |
| Remove | 685 | `Store.recordProtocolSuccess(routeKey, usedProtocol)` call site |
| Remove | 714-718 | `probeRoute()` function |
| Remove | 757-761 | `shouldUseH2()` function |

### 8. `packages/opencode/src/provider/gateway/mod.ts`

**Remove protocol and probe from service interface, display, and implementation:**

| Action | Lines | Detail |
|--------|-------|--------|
| Remove | 15 | `import { probe as probeCapability, type ProbeResult } from "./capability-probe"` — delete entire import line |
| Remove | 26 | `readonly probe: (baseUrl: string) => Effect.Effect<ProbeResult, Error>` from `Service.Interface` |
| Remove | 40 | `protocol: string` from `RouteInfo` interface |
| Remove | 85-89 | `probe()` wrapper function |
| Remove | 98 | `protocol: r.adjustment.protocol.alpnNegotiated` from `getRoutes()` |
| Remove | 141, 149 | Protocol field from `__gatewayRoutes` (both assignments) |
| Remove | 156 | `probe` from `Service.of()` return object |

### 9. `packages/opencode/src/provider/gateway/globals.d.ts`

**Update global type declaration:**

| Action | Lines | Detail |
|--------|-------|--------|
| Edit | 15 | `__gatewayRoutes` type — remove `protocol: string` from `Array<{ provider: string; protocol: string }>` |

## Non-Modifications

- **`shouldFallbackToH1()`** (errors.ts) — per-request H2→H1 fallback is pure error-type logic, independent of config
- **H2/H1 transports** (h2-transport.ts, h1-transport.ts) — transport execution stays unchanged
- **Health, circuit breaker, retry budget, streaming preference, confidence decay** — all non-protocol adjustment functions remain
- Old `gateway-adjustments.json` loads safely — orphaned `protocol`/`protocolPreference` JSON fields are ignored by the new code
- `adaptPolicy()` in adjustment-store.ts does NOT reference protocol fields — no changes needed
- `updateStreamingPreference()` does NOT reference protocol fields — no changes needed

## Verification

1. `bun typecheck` from `packages/opencode` — must pass with zero errors
2. Search for remaining references to removed exports: `negotiatedProtocol`, `ProtocolPreference`, `ProtocolInfo`, `getEffectiveProtocol`, `recordH2Failure`, `recordH1Success`, `recordH2Success`, `getProtocolPreference`, `shouldProbeH2`, `adjustProtocol`, `recordProtocolSuccess`, `preferH2`, `getModelProtocol`, `probeRoute`
3. With `model.options.protocol: "h2"` in opencode.jsonc → gateway log shows `configured: h2, using: h2`
4. Without any protocol config → gateway log shows `configured: undefined, using: http/1.1`
5. No `preferH2`, no gateway.jsonc protocol fields, no hardcoded OpenAI default remain in any file
6. `capability-probe.ts` no longer exists on disk
