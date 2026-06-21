# Multi-Provider Balance — Complete Research Report
## 2025-06-21 — All Data Grounded in Raw API Responses + Source Code

---

## Provider Balance Summary

| # | Provider | Balance | Source | API Status |
|---|----------|---------|--------|------------|
| 1 | **DeepSeek** | $14.59 USD | `GET api.deepseek.com/user/balance` → `balance_infos[1].total_balance` | Working |
| 2 | **OpenRouter** | $4.01 USD | `GET openrouter.ai/api/v1/credits` → `total_credits - total_usage` | Working |
| 3 | **OpenCode Zen** | ~$9.00 USD | `GET opencode.ai/zen/v1/balance` → **404** | Not deployed |
| 4 | **OpenCode Go** | Not subscribed | `GET opencode.ai/zen/go/v1/balance` → **404** | Not deployed |
| 5 | **OpenAI (API key)** | No endpoint | `credit_grants` needs browser session token | No public API |
| 6 | **OpenAI Codex** | Credits + Limits | `GET {base}/api/codex/usage` → `credits.balance` + `rate_limit` windows | Auth required |

---

## 1. DeepSeek — $14.59 USD (GROUNDED)

**Raw API Response:**
```json
GET https://api.deepseek.com/user/balance
Authorization: Bearer sk-...

{
  "is_available": true,
  "balance_infos": [
    { "currency": "CNY", "total_balance": "-0.04", "granted_balance": "0.00", "topped_up_balance": "-0.04" },
    { "currency": "USD", "total_balance": "14.59",  "granted_balance": "0.00", "topped_up_balance": "14.59"  }
  ]
}
```

**Current code** (`balance.ts:139-140`): `find(b => b.currency === "USD") ?? balanceInfos[0]` — correctly picks **$14.59 USD**.

---

## 2. OpenRouter — $4.01 USD (GROUNDED)

**Raw API Response:**
```json
GET https://openrouter.ai/api/v1/credits
Authorization: Bearer sk-or-...

{
  "data": {
    "total_credits": 20,
    "total_usage": 15.989331752
  }
}
```

Balance = `$20.00 - $15.99` = **$4.01 USD**.

**Decision**: Use `/credits` (account balance), NOT `/key` (per-key budget cap of $0.36).

---

## 3. OpenCode Zen — ~$9.00 USD (USER CONFIRMED, NO API)

- Endpoint `GET https://opencode.ai/zen/v1/balance` returns **404**.
- GitHub issue [#10448](https://github.com/anomalyco/opencode/issues/10448) open since Jan 2026.
- Console balance exists (SolidStart `/_server?id=...` RPC) but requires browser `auth` cookie.
- **No API-key-authenticated endpoint available.**

**Display**: "No Balance — Zen endpoint not deployed"

---

## 4. OpenCode Go — Not Subscribed (USER CONFIRMED)

- Same 404 as Zen.
- Go is subscription-based ($10/mo): 5h limit $12, weekly $30, monthly $60.
- User is not subscribed.

**Display**: "Go — Not subscribed"

---

## 5. OpenAI (API Key) — No Balance API (GROUNDED)

OpenAI does not expose a credit balance endpoint for API keys:
- `/dashboard/billing/credit_grants` requires **browser session token** (`sess-...`), rejects API keys with `"must be made with a session key"`.
- `/v1/usage` undocumented, same auth restriction.
- No official billing API exists.

**Display**: "No Balance — check platform.openai.com"

---

## 6. OpenAI Codex — Credits + Limits (GROUNDED via codex-rs source)

Codex CLI at `d:\zPython\codex\codex-rs\` calls:

**Endpoint**: `GET {base_url}/api/codex/usage` (or `/wham/usage` for ChatGPT path style)

**Auth**: OAuth bearer token via `SharedAuthProvider` (NOT API key)

**Response model** (from `codex-backend-openapi-models/src/models/`):

```rust
RateLimitStatusPayload {
    plan_type: PlanType,              // Free, Plus, Pro, Edu, Enterprise, etc.
    credits: Option<CreditStatusDetails>,
    rate_limit: Option<RateLimitStatusDetails>,
    additional_rate_limits: Vec<AdditionalRateLimitDetails>,
}

CreditStatusDetails {
    has_credits: bool,                // Account has credit tracking enabled
    unlimited: bool,                  // Unlimited credits
    balance: Option<String>,          // e.g. "9.99" (in credits)
}

RateLimitWindowSnapshot {
    used_percent: f32,                // 0-100
    limit_window_seconds: i32,        // Window duration (e.g. 18000 = 5h)
    reset_at: i32,                    // Unix timestamp when window resets
}
```

**Display logic** (from `tui/src/status/rate_limits.rs`):
- If `has_credits == false` → hide credits line
- If `unlimited == true` → show "Unlimited"
- If `balance == "0"` → hide credits line
- Otherwise → show `"${rounded_balance} credits"` (e.g. "13 credits")

**Rate limit headers** also available in every response:
- `x-codex-primary-used-percent`
- `x-codex-secondary-used-percent`

**For opencode integration**: The Codex auth token would need to be accessible. Since Codex CLI is installed and working locally, the token could potentially be read from the Codex config/session storage.

---

## Implementation Recommendations

| Provider | Action |
|----------|--------|
| DeepSeek | No changes needed (already works, USD preferred correctly) |
| OpenRouter | Implement `fetchOpenRouterBalance()` → `GET /api/v1/credits` |
| OpenCode Zen | Show "No Balance" until `/zen/v1/balance` is deployed |
| OpenCode Go | Show "Not subscribed" or "No Balance" |
| OpenAI API | Show "No Balance — no public endpoint" |
| OpenAI Codex | Call `GET /api/codex/usage` with Codex auth token → show credits + rate limits |
| Other providers | Show "No Balance" (no handler registered) |
