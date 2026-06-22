# Multi-Provider Balance Support

**Created:** 2025-06-21
**Status:** Research Complete — Ready for Approval
**Experiment:** `experiments/20250621_balance_smoke_test/` — all APIs tested live
**SV:** `[["balance","provider","registry","tui","OpenRouter","DeepSeek","OpenCode"], [0.28,0.22,0.18,0.12,0.09,0.07,0.04]]`

---

## Abstract Definition

The current balance system is hardcoded to DeepSeek only. When a user selects any other provider (OpenRouter, OpenCode Zen, OpenCode Go, etc.), no balance information is displayed in the TUI sidebar. This plan refactors the balance module to support multiple providers via a registry pattern, adds OpenRouter balance support (primary target), and shows "No Balance" for providers without a registered handler.

## Math Formalization

```
BalanceModule(providerID: ProviderID, apiKey: string) → BalanceResult

BalanceResult =
  | { type: "available", currency, totalBalance, isAvailable, sourceDescription }
  | { type: "unavailable", reason: "no_handler" | "no_api_key" | "api_error" }

BalanceFetcher(apiKey: string): Promise<BalanceInfo>

Registry: Map<ProviderID, BalanceFetcher>
  ─ deepseek → fetchDeepSeekBalance
  ─ openrouter → fetchOpenRouterBalance
  ─ zenmux → null (no handler yet — returns "unavailable")
  ─ (other) → null (no handler — returns "unavailable")
```

OpenRouter credits conversion (from official docs):
```
GET /api/v1/credits → { data: { total_credits, total_usage } }
balance = total_credits - total_usage
is_available = balance > 0
```
NOT `/key`'s `limit_remaining` — that's a per-key budget cap, not account balance.

## Structural Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     balance.ts (refactored)                    │
│                                                                │
│  BalanceFetcher interface                                      │
│  fetcherRegistry: Map<ProviderID, BalanceFetcher>             │
│  checkBalance(providerID, sessionID, messageID?)              │
│    → looks up fetcher in registry                             │
│    → if found: calls fetcher, returns BalanceSnapshot        │
│    → if not found: returns { type: "unavailable" }            │
│    → if no API key: returns { type: "unavailable" }           │
│                                                                │
│  fetchDeepSeekBalance(apiKey) → [EXISTING, UNCHANGED]        │
│  fetchOpenRouterBalance(apiKey) → [NEW]                       │
│    GET https://openrouter.ai/api/v1/key                       │
│    returns { totalBalance: limit_remaining, currency: "USD" } │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│              processor.ts (updated)                            │
│                                                                │
│  checkAndSnapshotBalance() — remove "deepseek" gate           │
│  Publish BalanceUpdated for ANY provider with handler         │
│  Publish BalanceUnavailable event for no-handler providers    │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│           Event: session.balance_updated (UPDATED)            │
│                                                                │
│  + source: "available" | "unavailable"                       │
│  + unavailableReason?: "no_handler" | "no_api_key" | "error" │
│  + providerLabel?: string (display name)                     │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│         context.tsx — TUI Sidebar (updated)                   │
│                                                                │
│  Subscribe to balance_updated for ALL providers               │
│  Show per-active-model balance:                               │
│    - Available: "✓ ${balance} ${currency} (ProviderName)"     │
│    - Unavailable: "No Balance" (gray/muted)                   │
│    - Loading: skeleton or nothing                             │
│  Balance updates when model changes                           │
└──────────────────────────────────────────────────────────────┘
```

## Provider Balance API Summary

| Provider | Endpoint | Auth | Status | Response | Key Field |
|----------|----------|------|--------|----------|-----------|
| DeepSeek | `GET /user/balance` | Regular API key | **Verified** | `{ balance_infos: [...] }` | `total_balance` (USD preferred: `find("USD") ?? [0]` at balance.ts:139) |
| OpenRouter | `GET /api/v1/credits` | Regular API key | **Verified: $4.01 USD** | `{ data: { total_credits, total_usage } }` | `total_credits - total_usage` |
| OpenRouter (alt) | `GET /api/v1/key` | Regular API key | Verified: limit $1.00 | `{ data: { limit, limit_remaining } }` | `limit_remaining` (per-key budget cap, NOT account balance) |
| OpenCode Zen | `GET /zen/v1/balance` | Zen API key | **404 — NOT DEPLOYED** | GitHub issue #10448 open | — |
| OpenCode Go | `GET /zen/v1/balance` | Go API key | **404 — NOT DEPLOYED** | Same endpoint as Zen | — |
| OpenAI | N/A | N/A | No balance API | — | — |
| Anthropic | N/A | N/A | No balance API | — | — |

**OpenRouter design decision:** Use `GET /api/v1/credits` — returns `total_credits` and `total_usage` which represent the **actual account balance** ($20.00 - $15.99 = $4.01). The `/key` endpoint's `limit_remaining` is a per-key **budget cap** ($0.36 of $1.00), not the account balance. Docs say "management key required" but tests show it works with regular API keys. Fall back to "No Balance" on 403.

**DeepSeek currency handling (grounded):** Code at `balance.ts:139-140` uses `find(b => b.currency === "USD") ?? balanceInfos[0]` — correctly prefers USD. No bug here.

**OpenCode Zen/Go:** The proposed endpoint `GET https://opencode.ai/zen/v1/balance` returns **404** — not deployed yet (GitHub issue #10448 open). Show "No Balance" until the endpoint is available.

## Implementation Tasks

### Task 1: Refactor balance.ts — Provider Registry

**File:** `packages/opencode/src/provider/balance.ts`

**Abstract:** Convert the single-provider `checkBalance()` function into a registry-based dispatch that supports multiple providers with pluggable balance fetchers.

**Changes:**
1. Define `BalanceFetcher` type: `(apiKey: string) => Promise<BalanceInfo>`
2. Create `balanceFetcherRegistry: Record<string, BalanceFetcher>` 
3. Register existing DeepSeek fetcher
4. Modify `checkBalance()` to:
   - Look up `balanceFetcherRegistry[providerID]`
   - Return `{ type: "unavailable", reason: "no_handler" }` if no fetcher
   - Return `{ type: "unavailable", reason: "no_api_key" }` if no API key found
   - Call fetcher and return `BalanceSnapshot` on success
5. Make `getProviderApiKey(providerID)` generic (not DeepSeek-specific)
6. Add `ProviderLabel` mapping: `{ deepseek: "DeepSeek", openrouter: "OpenRouter", ... }`

**Types to add/modify:**
```typescript
// New: result discriminator
export type BalanceSource = "available" | "unavailable"
export type UnavailableReason = "no_handler" | "no_api_key" | "api_error"

// Updated BalanceSnapshot — add source tracking
export interface BalanceSnapshot {
  // ... existing fields ...
  source: BalanceSource
  unavailableReason?: UnavailableReason
  providerLabel?: string
}

// New: per-provider API key getter
async function getProviderApiKey(providerID: string): Promise<string | undefined>
```

**Test cases:**
- [ ] `checkBalance("deepseek", ...)` still works as before (backward compat)
- [ ] `checkBalance("openrouter", ...)` calls OpenRouter fetcher when registered
- [ ] `checkBalance("unknown_provider", ...)` returns `{ source: "unavailable", reason: "no_handler" }`
- [ ] `checkBalance("openrouter", ...)` with no API key returns `{ source: "unavailable", reason: "no_api_key" }`

---

### Task 2: Add OpenRouter Balance Fetcher

**File:** `packages/opencode/src/provider/balance.ts`

**Abstract:** Implement `fetchOpenRouterBalance()` using `GET https://openrouter.ai/api/v1/credits`.

**Implementation:**
```typescript
async function fetchOpenRouterBalance(apiKey: string): Promise<BalanceInfo> {
  const response = await fetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!response.ok) {
    throw new Error(`OpenRouter credits check failed: ${response.status}`)
  }
  const json = await response.json()
  // Official docs: data.total_credits - data.total_usage = account balance
  const totalCredits = json.data?.total_credits ?? 0
  const totalUsage = json.data?.total_usage ?? 0
  const remaining = totalCredits - totalUsage
  return {
    currency: "USD",
    totalBalance: String(remaining),
    grantedBalance: "0",
    toppedUpBalance: String(totalCredits),
  }
}
```

**Error handling:**
- 401 → invalid API key
- 403 → lacks permissions (rare, docs say management key but tested OK with regular)
- 404 → endpoint not found
- Network errors → "balance check failed"

**Registration:**
```typescript
const balanceFetcherRegistry: Record<string, BalanceFetcher> = {
  deepseek: fetchDeepSeekBalance,
  openrouter: fetchOpenRouterBalance,
}
```

**Test cases:**
- [ ] Parses valid OpenRouter `/credits` response: `total_credits:20, total_usage:15.99` → balance $4.01
- [ ] Handles `total_credits === 0` (zero balance)
- [ ] Handles `total_usage > total_credits` (negative balance)
- [ ] Handles 401/403 error responses
- [ ] Handles network failure gracefully

---

### Task 3: Update Session Processor — Remove DeepSeek Gate

**File:** `packages/opencode/src/session/processor.ts`

**Abstract:** Remove the hardcoded `providerID !== "deepseek"` gate in `checkAndSnapshotBalance()` so any provider with a registered fetcher gets balance checking.

**Changes (lines 96-129):**
1. Remove line: `if (providerID !== "deepseek") return null`
2. Allow `Balance.checkBalance()` to handle the dispatch
3. The `Balance.checkBalance()` call already returns `null` for unsupported providers (from Task 1)
4. Publish `BalanceUpdated` event only when `source === "available"`
5. Optionally publish a `BalanceUnavailable` event for unavailable providers (so TUI can show "No Balance")

**Test cases:**
- [ ] DeepSeek balance still checked and published
- [ ] OpenRouter balance checked and published when OpenRouter model is active
- [ ] Unsupported providers do not trigger balance API calls
- [ ] Balance throttle (5 min, $0.01 min cost) still applies per-provider independently

---

### Task 4: Update TUI Sidebar — Per-Model Balance Display

**File:** `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx`

**Abstract:** Update the balance display to show balance for the currently active model's provider, or "No Balance" when unavailable.

**Changes:**
1. **Remove DeepSeek-only filter** (line 33: `if (props.providerID !== "deepseek") return`)
2. **Track balance per provider** using a `Record<string, BalanceInfo>` signal
3. **Show balance for active provider** by reading `local.currentModel()?.providerID`
4. **Three display states:**
   - **Balance available:** Show `✓ ${amount} ${currency}` with provider label
   - **Balance unavailable:** Show `No Balance` in muted/gray text
   - **No event received yet:** Show nothing (or a subtle loading indicator)
5. **Update on model change:** When `currentModel` changes, show the stored balance for that provider, or "No Balance" if none stored

**UI mockup:**
```
Balance                            Balance
───────                            ───────
DeepSeek                           OpenRouter
✓ available                        ✓ $45.23 USD
$12.50 USD                         
                                   Balance
Balance                            ───────
───────                            OpenAI
OpenCode Zen                       No Balance
No Balance (console-managed)
```

**Implementation approach:**
```tsx
const [providerBalances, setProviderBalances] = createSignal<Record<string, BalanceInfo>>({})
const currentModel = local.currentModel  // from local context
const activeProviderID = () => currentModel()?.providerID

// Subscribe to ALL balance updates
const unsub = (props.api.event as any).on("session.balance_updated", (evt: any) => {
  const props = evt.properties ?? evt
  setProviderBalances(prev => ({
    ...prev,
    [props.providerID]: {
      totalBalance: props.totalBalance,
      currency: props.currency,
      isAvailable: props.isAvailable,
      source: props.source, // "available" | "unavailable"
      timestamp: Date.now(),
    }
  }))
})

// Display logic
const activeBalance = () => {
  const pid = activeProviderID()
  if (!pid) return null
  return providerBalances()[pid] ?? null
}
```

**Test cases:**
- [ ] Switching from DeepSeek to OpenRouter updates balance display
- [ ] Switching to provider with no handler shows "No Balance"
- [ ] Balance event for inactive provider is stored but not displayed
- [ ] "No Balance" text is muted/gray, not red (distinguishes from "insufficient")

---

### Task 5: Update Bus Event Schema

**File:** `packages/opencode/src/session/session.ts` (lines 328-341)

**Abstract:** Add `source` and `unavailableReason` fields to the `BalanceUpdated` event.

**Schema update:**
```typescript
BalanceUpdated: BusEvent.define(
  "session.balance_updated",
  Schema.Struct({
    sessionID: Schema.String,
    providerID: Schema.String,
    source: Schema.Literals("available", "unavailable"),  // NEW
    unavailableReason: Schema.optional(Schema.Literals("no_handler", "no_api_key", "api_error")), // NEW
    providerLabel: Schema.optional(Schema.String),  // NEW (e.g. "OpenRouter")
    currency: Schema.String,
    totalBalance: Schema.String,
    grantedBalance: Schema.String,
    toppedUpBalance: Schema.String,
    isAvailable: Schema.Boolean,
    calculatedCostSinceLast: Schema.optional(Schema.Number),
    costValidationDelta: Schema.optional(Schema.Number),
  }),
),
```

**Test cases:**
- [ ] Event with `source: "available"` is published when balance fetch succeeds
- [ ] Event with `source: "unavailable"`, `reason: "no_handler"` is published for unsupported providers
- [ ] Backward compatibility: existing subscribers still work (new fields are optional)

---

### Task 6: Update Tests

**Files:**
- `packages/opencode/test/provider/balance.test.ts` — add OpenRouter + registry tests
- New: `packages/opencode/test/provider/balance-openrouter.test.ts` (optional, separate file)

**New test cases:**
- [ ] `fetchOpenRouterBalance` parses valid response
- [ ] `fetchOpenRouterBalance` handles 401 / 403 / network errors
- [ ] `checkBalance` dispatches to correct fetcher based on providerID
- [ ] `checkBalance` returns `source: "unavailable"` for unknown providers
- [ ] `getProviderApiKey` reads different provider keys from auth.json
- [ ] DeepSeek balance tests still pass (regression check)

---

### Task 7: Regenerate SDK Types

**File:** `packages/sdk/js/src/v2/gen/types.gen.ts`

Run `bun run packages/sdk/js/script/build.ts` to regenerate SDK types from the updated OpenAPI schema (if `BalanceUpdated` event is in the spec).

**Note:** May not be needed if the event is not part of the public OpenAPI spec — verify first.

---

## Follow-Up Tasks (Separate Plans)

| Task | Description | Priority |
|------|-------------|----------|
| Console Zen/Go balance endpoint | Create `GET /zen/v1/balance` on the console that returns workspace balance authenticated by Zen API key | Medium |
| OpenRouter management key support | Add support for OpenRouter management keys in auth, enabling account-level credit checks via `/api/v1/credits` | Low |
| Balance warning thresholds | Show warnings when balance drops below configurable thresholds | Low |
| Balance-based spending caps | Auto-stop sessions when balance is insufficient | Low |

---

## Execution Order

1. **Task 1:** Refactor balance.ts (provider registry) — foundation for everything else
2. **Task 2:** Add OpenRouter balance fetcher — primary new feature
3. **Task 5:** Update Bus Event schema — needed before TUI changes
4. **Task 3:** Update processor — enable multi-provider balance checking
5. **Task 4:** Update TUI sidebar — user-visible changes
6. **Task 6:** Update tests — validate everything
7. **Task 7:** Regenerate SDK types — if needed

## Done %

```
SV for Multi-Provider Balance Support
  SV for Task 1: Refactor balance.ts provider registry
  Done: 0%
  [ ] Define BalanceFetcher type and registry
  [ ] Make getProviderApiKey generic
  [ ] Update checkBalance dispatch logic
  [ ] Add provider label mapping

  SV for Task 2: OpenRouter balance fetcher
  Done: 0%
  [ ] Implement fetchOpenRouterBalance
  [ ] Register in balanceFetcherRegistry
  [ ] Error handling for API failures

  SV for Task 3: Update processor
  Done: 0%
  [ ] Remove DeepSeek-only gate in checkAndSnapshotBalance
  [ ] Allow checkBalance to handle dispatch
  [ ] Publish events for all providers with handlers

  SV for Task 4: Update TUI sidebar
  Done: 0%
  [ ] Remove DeepSeek-only event filter
  [ ] Track balance per provider
  [ ] Show balance for active model's provider
  [ ] Show "No Balance" for unavailable providers
  [ ] Respond to model changes

  SV for Task 5: Update bus event schema
  Done: 0%
  [ ] Add source/unavailableReason fields

  SV for Task 6: Update tests
  Done: 0%
  [ ] Add OpenRouter fetcher tests
  [ ] Add registry dispatch tests
  [ ] Run existing tests (regression)

  SV for Task 7: Regenerate SDK types
  Done: 0%
  [ ] Check if needed, run SDK build
```
