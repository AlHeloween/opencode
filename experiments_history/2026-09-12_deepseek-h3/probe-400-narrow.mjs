// Narrow the discriminator further: D2 (synthetic tool_call) -> 400 while
// D0/D1/D3 (server-issued tool_call) -> 200. Candidates:
//   (a) the id STRING is validated by prefix ("call_00_...")
//   (b) the server remembers the id it issued (session record), prefix is a proxy
//   (c) the tool_call ARGUMENTS differ (real "{}" vs synthetic "{}" — equal, so no)
//
// E0 = server-issued id + mutated arguments   -> tests (c)/(b)
// E1 = fabricated id with the "call_00_" prefix -> tests (a) vs (b)
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-400-narrow.mjs

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
      "user-agent": "opencode-400-narrow",
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
      error: res.ok ? undefined : (parsed?.error?.message ?? text).slice(0, 120),
    }),
  )
  return parsed
}

console.log(`\n=== model: ${MODEL} — narrow the 400 discriminator ===`)

const step1 = await call("step1 capture", {
  tools: TOOLS,
  messages: [{ role: "user", content: "Call get_time and tell me the time." }],
  max_tokens: 512,
})
const assistant = step1?.choices?.[0]?.message
const real = assistant?.tool_calls?.[0]
if (!real) {
  console.log(JSON.stringify({ name: "abort", note: "no tool call" }))
  process.exit(1)
}
console.log(
  JSON.stringify({ name: "captured", id: real.id, keys: Object.keys(real), fnKeys: Object.keys(real.function ?? {}) }),
)

const userMsg = { role: "user", content: "Call get_time and tell me the time." }
const toolMsg = { role: "tool", tool_call_id: real.id, content: '{"utc":"2026-09-12T03:49:25Z"}' }
const content = assistant.content ?? ""

// E0: real id, mutated arguments
await call("E0 server-issued id + MUTATED arguments", {
  tools: TOOLS,
  max_tokens: 256,
  messages: [
    userMsg,
    { role: "assistant", content, tool_calls: [{ ...real, function: { ...real.function, arguments: '{"zone":"utc"}' } }] },
    toolMsg,
  ],
})

// E1: fabricated id carrying the server prefix
await call("E1 fabricated id with call_00_ prefix", {
  tools: TOOLS,
  max_tokens: 256,
  messages: [
    userMsg,
    { role: "assistant", content, tool_calls: [{ ...real, id: "call_00_ZZZZZZZZZZZZZZZZZZZZ" }] },
    { role: "tool", tool_call_id: "call_00_ZZZZZZZZZZZZZZZZZZZZ", content: '{"utc":"2026-09-12T03:49:25Z"}' },
  ],
})

// E2: fabricated id, no prefix (control for E1 = expect 400 like D2)
await call("E2 fabricated id without prefix (control)", {
  tools: TOOLS,
  max_tokens: 256,
  messages: [
    userMsg,
    { role: "assistant", content, tool_calls: [{ ...real, id: "zzz_fake_id" }] },
    { role: "tool", tool_call_id: "zzz_fake_id", content: '{"utc":"2026-09-12T03:49:25Z"}' },
  ],
})

console.log("\n=== done ===")
