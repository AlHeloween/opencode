/**
 * Smoke Test Results: Multi-Provider Balance APIs
 * Date: 2025-06-21
 * 
 * Verified by live API calls against all available provider keys.
 */

export const BALANCE_API_RESULTS = {
  deepseek: {
    endpoint: "https://api.deepseek.com/user/balance",
    status: "OK",
    balance: "-0.04 CNY",
    isAvailable: true,
    notes: "Negative balance but API reports is_available:true. Response has 2 currencies (CNY, USD).",
  },
  openrouter_key: {
    endpoint: "https://openrouter.ai/api/v1/key",
    status: "OK",
    balance: "$0.358235564 USD (limit_remaining)",
    isAvailable: true,
    notes: "Works with regular API key. Returns per-key limit/usage. Preferred endpoint.",
  },
  openrouter_credits: {
    endpoint: "https://openrouter.ai/api/v1/credits",
    status: "OK",
    balance: "$4.010668248 USD (total_credits - total_usage)",
    isAvailable: true,
    notes: "Works with management key. Returns account-level credits. May 403 for regular keys.",
  },
  opencode_zen: {
    endpoint: "https://opencode.ai/zen/v1/balance",
    status: "404 NOT FOUND",
    balance: null,
    notes: "Endpoint proposed in GitHub issue #10448 but NOT YET IMPLEMENTED.",
  },
  opencode_go: {
    endpoint: "https://opencode.ai/zen/v1/balance",
    status: "404 NOT FOUND",
    balance: null,
    notes: "No dedicated Go balance endpoint. Would use Zen balance endpoint.",
  },
} as const;

// SUMMARY:
// - DeepSeek:    WORKS — already implemented in codebase
// - OpenRouter:  WORKS — /api/v1/key is reliable, works with regular keys
// - OpenCodeZen: BLOCKED — endpoint doesn't exist yet (GitHub #10448 open)
// - OpenCodeGo:  BLOCKED — endpoint doesn't exist yet
// - Others:      NO API — OpenAI/Anthropic don't expose balance endpoints
