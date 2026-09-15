// DeepSeek 400-rule bisect: the docs promise HTTP 400 when `reasoning_content`
// is missing on a tool turn, but probes #1/#2 on deepseek-flash AND v4-pro both
// returned 200. The 2026-08-28 dialect probe DID record a 400 with a slightly
// different body shape. This script bisects the candidate discriminators.
//
// Baseline (B0) = the exact 2026-08-28 shape: explicit thinking + reasoning_effort,
// system padding, prompt_cache_key, assistant content:null, synthetic tool_call.
// Then each variant flips ONE thing toward my 200-producing shape.
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-400-bisect.mjs

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
const COT = "The user asks about weather in Paris. I should call get_weather for Paris tomorrow and report the result."
const FILLER = "You are a deterministic probe. Context padding: " + "deepseek dialect experiment. ".repeat(20)
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get weather for a location and date.",
      parameters: {
        type: "object",
        properties: { location: { type: "string" }, date: { type: "string" } },
        required: ["location", "date"],
      },
    },
  },
]
const TOOL_CALLS = [
  {
    id: "call_probe_1",
    type: "function",
    function: { name: "get_weather", arguments: '{"location": "Paris", "date": "tomorrow"}' },
  },
]

async function call(name, body) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-400-bisect",
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
  const err = res.ok ? undefined : (parsed?.error?.message ?? text).slice(0, 150)
  console.log(
    JSON.stringify({ name, status: res.status, prompt_tokens: parsed?.usage?.prompt_tokens, error: err }),
  )
}

function body({ variant, cacheKey, system, assistantContent, thinking, effort }) {
  const assistant = { role: "assistant", content: assistantContent, tool_calls: TOOL_CALLS }
  const messages = []
  if (system) messages.push({ role: "system", content: FILLER })
  messages.push(
    { role: "user", content: "Weather in Paris tomorrow?" },
    assistant,
    { role: "tool", tool_call_id: "call_probe_1", content: "Paris tomorrow: +15C, cloudy" },
  )
  return {
    model: MODEL,
    messages,
    tools: TOOLS,
    max_tokens: 32,
    stream: false,
    ...(thinking ? { thinking: { type: "enabled" } } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
    _variant: variant,
  }
}

const stamp = Date.now()
console.log(`\n=== model: ${MODEL} — bisect of the documented tool-turn 400 ===`)
console.log("B0 = 2026-08-28 shape (expect the recorded 400)...\n")

// B0: exact historic shape
await call("B0 historic shape (content:null, thinking, effort, system, pck)", {
  ...body({ variant: "B0", cacheKey: `bisect-B0-${stamp}`, system: true, assistantContent: null, thinking: true, effort: "low" }),
})

// B1: drop thinking
await call("B1 = B0 minus thinking", {
  ...body({ variant: "B1", cacheKey: `bisect-B1-${stamp}`, system: true, assistantContent: null, thinking: false, effort: "low" }),
})

// B2: drop reasoning_effort
await call("B2 = B0 minus reasoning_effort", {
  ...body({ variant: "B2", cacheKey: `bisect-B2-${stamp}`, system: true, assistantContent: null, thinking: true, effort: undefined }),
})

// B3: drop prompt_cache_key
await call("B3 = B0 minus prompt_cache_key", {
  ...body({ variant: "B3", cacheKey: undefined, system: true, assistantContent: null, thinking: true, effort: "low" }),
})

// B4: drop system message
await call("B4 = B0 minus system", {
  ...body({ variant: "B4", cacheKey: `bisect-B4-${stamp}`, system: false, assistantContent: null, thinking: true, effort: "low" }),
})

// B5: content "" instead of null
await call("B5 = B0 with content:\"\" instead of null", {
  ...body({ variant: "B5", cacheKey: `bisect-B5-${stamp}`, system: true, assistantContent: "", thinking: true, effort: "low" }),
})

// B6: bare minimal - the fully stripped shape
await call("B6 bare (no system/thinking/effort/pck, content:null)", { tools: TOOLS, max_tokens: 32, messages: [
  { role: "user", content: "Weather in Paris tomorrow?" },
  { role: "assistant", content: null, tool_calls: TOOL_CALLS },
  { role: "tool", tool_call_id: "call_probe_1", content: "Paris tomorrow: +15C, cloudy" },
] })

console.log("\n=== done ===")
