/**
 * RAW API RESPONSES - Provider Balance Endpoints
 * Date: 2025-06-21
 * 
 * All responses captured from live API calls. Used to ground
 * the implementation plan against actual provider behavior.
 */

export const RAW_DEEPSEEK_BALANCE = {
  url: "https://api.deepseek.com/user/balance",
  status: 200,
  body: {
    is_available: true,
    balance_infos: [
      { currency: "CNY", total_balance: "-0.04", granted_balance: "0.00", topped_up_balance: "-0.04" },
      { currency: "USD", total_balance: "14.59",  granted_balance: "0.00", topped_up_balance: "14.59"  }
    ]
  }
};

export const RAW_OPENROUTER_CREDITS = {
  url: "https://openrouter.ai/api/v1/credits",
  status: 200,
  body: {
    data: {
      total_credits: 20,
      total_usage: 15.989331752
    }
  }
};

export const RAW_OPENROUTER_KEY = {
  url: "https://openrouter.ai/api/v1/key",
  status: 200,
  body: {
    data: {
      label: "sk-or-v1-...",
      is_management_key: false,
      is_provisioning_key: false,
      limit: 1,
      limit_reset: null,
      limit_remaining: 0.358235564,
      include_byok_in_limit: false,
      usage: 0.641764436,
      usage_daily: 0.324521736,
      usage_weekly: 0.324521736,
      usage_monthly: 0.632006836,
      is_free_tier: false,
      expires_at: null,
      rate_limit: { requests: -1, interval: "10s" }
    }
  }
};

export const RAW_ZEN_BALANCE = {
  url: "https://opencode.ai/zen/v1/balance",
  status: 404,
  body: "(HTML error page — endpoint not deployed)"
};

export const RAW_GO_BALANCE = {
  url: "https://opencode.ai/zen/go/v1/balance",
  status: 404,
  body: "(HTML error page — endpoint not deployed)"
};

// GROUNDED CONCLUSIONS (from official docs + raw responses):
//
// DeepSeek:     USD balance = $14.59  (from balance_infos[1], code correctly prefers USD)
// OpenRouter:   Account balance = $20.00 - $15.99 = $4.01  (from /credits, NOT /key's limit_remaining)
//               The /key endpoint returns per-key budget cap ($0.36/$1.00), NOT account balance
// Zen:          404 — endpoint does not exist (GitHub issue #10448 open)
// Go:           404 — endpoint does not exist
