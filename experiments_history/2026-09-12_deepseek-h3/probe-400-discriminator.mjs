// Discriminator: why did probe #2's tool-replay get 200 while the bisect's
// identical-looking body got 400 "reasoning_content must be passed back"?
//
// The bisect proved the failing shape is NOT determined by system message,
// thinking flag, reasoning_effort, prompt_cache_key, or content:null/"".
// Remaining candidates: max_tokens (32 vs 256) and synthetic-vs-real tool_call.
//
// D0 = replay a REAL captured tool_call, max_tokens 256  (probe #2 shape, 200)
// D1 = D0 with max_tokens 32                             (bisect budget)
// D2 = D0 with a SYNTHETIC tool_call id/arguments        (bisect tool shape)
// D3 = D0 with content:null
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-400-discriminator.mjs

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

const MODEL = process.argv[2] ?? "deepseek-flash"
const URL = "https://api.deepseek.com/chat/completions"
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Return the current UTC time",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
]

async function call(name, body) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-400-discriminator",
    },
    body: JSON.stringify({ model: MODEL, ...body }),
  })
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  console.log(
    JSON.stringify({
      name,
      status: res.status,
      prompt_tokens: parsed?.usage?.prompt_tokens,
      error: res.ok ? undefined : (parsed?.error?.message ?? text).slice(0, 140),
    }),
  )
  return parsed
}

console.log(`\n=== model: ${MODEL} — 400 discriminator ===`)

// Capture a real tool call (no reasoning echoed in the replay below).
const step1 = await call("step1 capture real tool call", {
  tools: TOOLS,
  messages: [{ role: "user", content: "Call get_time and tell me the time." }],
  max_tokens: 1024,
})
const assistant = step1?.choices?.[0]?.message
const realToolCall = assistant?.tool_calls?.[0]
if (!realToolCall) {
  console.log(JSON.stringify({ name: "abort", note: "no tool call captured" }))
  process.exit(1)
}
console.log(
  JSON.stringify({
    name: "captured",
    id_head: String(realToolCall.id).slice(0, 12),
    args: realToolCall.function?.arguments,
    content: JSON.stringify(assistant.content),
  }),
)

const userMsg = { role: "user", content: "Call get_time and tell me the time." }
const toolMsg = { role: "tool", tool_call_id: realToolCall.id, content: '{"utc":"2026-09-12T03:49:25Z"}' }

const synthetic = {
  id: "call_probe_1",
  type: "function",
  function: { name: "get_time", arguments: "{}" },
}

const variants = [
  {
    name: "D0 real tool_call + content:\"\" + max_tokens 256 (probe #2 shape)",
    assistant: { role: "assistant", content: assistant.content ?? "", tool_calls: [realToolCall] },
    max_tokens: 256,
  },
  {
    name: "D1 = D0 with max_tokens 32 (bisect budget)",
    assistant: { role: "assistant", content: assistant.content ?? "", tool_calls: [realToolCall] },
    max_tokens: 32,
  },
  {
    name: "D2 = D0 with SYNTHETIC tool_call id/args",
    assistant: { role: "assistant", content: assistant.content ?? "", tool_calls: [synthetic] },
    max_tokens: 256,
  },
  {
    name: "D3 = D0 with content:null",
    assistant: { role: "assistant", content: null, tool_calls: [realToolCall] },
    max_tokens: 256,
  },
]

for (const v of variants) {
  const toolCallForMsg = v.assistant.tool_calls[0]
  await call(v.name, {
    tools: TOOLS,
    max_tokens: v.max_tokens,
    messages: [
      userMsg,
      v.assistant,
      { role: "tool", tool_call_id: toolCallForMsg.id, content: '{"utc":"2026-09-12T03:49:25Z"}' },
    ],
  })
}

console.log("\n=== done ===")
