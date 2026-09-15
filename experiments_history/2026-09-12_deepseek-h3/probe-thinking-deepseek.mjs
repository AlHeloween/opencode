// DeepSeek thinking-mode wire probe (rewrite of the novita h3 session probes
// shape, but for the DeepSeek thinking contract).
//
// Docs under test (https://api-docs.deepseek.com/guides/thinking_mode):
//   T1 OpenAI format: {"thinking":{"type":"enabled"|"disabled"}} toggle works;
//      with thinking disabled reasoning_tokens == 0.
//   T2 reasoning_effort: low|high|max accepted; unknown/default values are
//      silently mapped (minimal->low, medium->high, xhigh->high, ultra->max).
//   T3 Anthropic format: {"reasoning":{"effort":"none"}} disables thinking.
//   T4 reasoning_content MUST be passed back on tool turns — omitting it is a
//      400 ("The reasoning_content in the thinking mode must be passed back").
//   T5 temperature/top_p are ignored in thinking mode (top_p floored at 0.95).
//
// Each case is a SEPARATE cold conversation (distinct prefix) so caches do not
// blur the signal. Only status codes, token counts and field PRESENCE are
// printed — never key material, never full bodies.
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-thinking-deepseek.mjs

import { readFileSync } from "node:fs"
import { join } from "node:path"

function loadKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim()
  try {
    const auth = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "bin", "auth.json"), "utf8"))
    if (auth["deepseek"]?.key) return auth["deepseek"].key
  } catch {
    // explicit failure below
  }
  return undefined
}

const KEY = loadKey()
if (!KEY) {
  console.error("no deepseek key: set DEEPSEEK_API_KEY")
  process.exit(1)
}
console.log(`deepseek key: present (len=${KEY.length})`)

const URL = "https://api.deepseek.com/chat/completions"
// Model names: `deepseek-flash` is the current (V4.1-Flash) name; the legacy
// `deepseek-v4-flash` is still routed to the same backend.
const MODEL = process.argv[2] ?? "deepseek-flash"

const TOOL = [
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Return the current UTC time",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
]

async function call(name, body, { stream = false } = {}) {
  const t0 = performance.now()
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-thinking-probe",
    },
    body: JSON.stringify({ model: MODEL, stream, ...body }),
  })
  const ms = Math.round(performance.now() - t0)
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const usage = parsed?.usage
  const msg = parsed?.choices?.[0]?.message
  const summary = {
    name,
    status: res.status,
    ms,
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens,
    has_reasoning_content: msg ? Object.prototype.hasOwnProperty.call(msg, "reasoning_content") : undefined,
    reasoning_content_len: typeof msg?.reasoning_content === "string" ? msg.reasoning_content.length : undefined,
    tool_calls: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : undefined,
    error: res.ok ? undefined : (parsed?.error?.message ?? text).slice(0, 180),
  }
  console.log(JSON.stringify(summary))
  return parsed
}

console.log(`\n=== model: ${MODEL} ===`)

// ── T1a: thinking enabled (default) ──
await call("T1a think-default", {
  messages: [{ role: "user", content: "What is 17*23? Reply with the number only." }],
  max_tokens: 256,
})

// ── T1b: thinking disabled via OpenAI form ──
await call("T1b think-disabled", {
  thinking: { type: "disabled" },
  messages: [{ role: "user", content: "What is 17*23? Reply with the number only." }],
  max_tokens: 256,
})

// ── T2: effort values (documented + mapped-away aliases) ──
for (const effort of ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]) {
  await call(`T2 effort=${effort}`, {
    reasoning_effort: effort,
    messages: [{ role: "user", content: "Name the capital of France. One word." }],
    max_tokens: 256,
  })
}

// ── T3: Anthropic-format effort none (documented off switch) ──
await call("T3 anthropic-effort-none", {
  reasoning: { effort: "none" },
  messages: [{ role: "user", content: "Name the capital of France. One word." }],
  max_tokens: 256,
})

// ── T4: tool turn WITHOUT reasoning_content echoed back (expect 400) ──
// Step 1: get a real assistant tool-call turn.
const first = await call("T4 step1 (tool call, thinking on)", {
  tools: TOOL,
  messages: [{ role: "user", content: "Call get_time, then tell me the time." }],
  max_tokens: 512,
})
const assistant = first?.choices?.[0]?.message
const toolCall = assistant?.tool_calls?.[0]
if (toolCall) {
  const baseMessages = [
    { role: "user", content: "Call get_time, then tell me the time." },
    // Reasoning field DELIBERATELY omitted here — this is the 400 probe.
    { role: "assistant", content: "", tool_calls: [toolCall] },
    { role: "tool", tool_call_id: toolCall.id, content: '{"utc":"2026-09-12T03:49:25Z"}' },
  ]
  await call("T4a tool-replay WITHOUT reasoning_content (expect 400)", {
    tools: TOOL,
    messages: baseMessages,
    max_tokens: 256,
  })
  // Control: same conversation WITH the field present (empty string allowed).
  await call("T4b tool-replay WITH empty reasoning_content (expect 200)", {
    tools: TOOL,
    messages: [
      { role: "user", content: "Call get_time, then tell me the time." },
      { role: "assistant", content: "", reasoning_content: "", tool_calls: [toolCall] },
      { role: "tool", tool_call_id: toolCall.id, content: '{"utc":"2026-09-12T03:49:25Z"}' },
    ],
    max_tokens: 256,
  })
} else {
  console.log(JSON.stringify({ name: "T4 skipped", note: "no tool_call in step1 response" }))
}

console.log("\n=== done ===")
