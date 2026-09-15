// Decisive follow-up: WHY does a fabricated tool_call id produce 400 while a
// server-issued one produces 200 (with reasoning_content absent in both)?
//
// Two competing explanations:
//   H1 (id validated)  — the API validates the id string itself (format/signature/
//                        checksum). Any mutation -> 400.
//   H2 (server memory) — the API remembers ids it issued (e.g. via prefix cache);
//                        a never-issued id -> 400.
//
// Cheap discriminator: mutate ONE character of a REAL id.
//   H1 -> 400 (the mutation breaks the validation)
//   H2 -> 200 (the id was issued by the server, mutation is irrelevant)
//
//   G1 real id, 1 char flipped
//   G2 real id, last char truncated
//   G3 real id, uppercased
//   G4 real id verbatim (control, expect 200)
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-400-idmech.mjs

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
const USER = { role: "user", content: "Call get_time and tell me the time." }

async function call(name, body) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-400-idmech",
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
      error: res.ok ? undefined : (parsed?.error?.message ?? text).slice(0, 110),
    }),
  )
}

console.log(`\n=== model: ${MODEL} — id-validation mechanism ===`)
const step1 = await call("step1 capture", {
  tools: TOOLS,
  messages: [USER],
  max_tokens: 512,
})
void step1

// The capture above only logged status; capture again with the body so we have
// the id. (Kept explicit rather than threading state through `call`.)
const cap = await fetch(URL, {
  method: "POST",
  headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, tools: TOOLS, max_tokens: 512, messages: [USER] }),
})
const capJson = await cap.json()
const real = capJson?.choices?.[0]?.message?.tool_calls?.[0]
if (!real) {
  console.log(JSON.stringify({ name: "abort", note: "no tool call captured" }))
  process.exit(1)
}
const content = capJson.choices[0].message.content ?? ""
console.log(JSON.stringify({ name: "captured", id: real.id, idLen: real.id.length }))

const flipIdx = Math.floor(real.id.length / 2)
const flipChar = real.id[flipIdx] === "a" ? "b" : "a"
const flipped = real.id.slice(0, flipIdx) + flipChar + real.id.slice(flipIdx + 1)

const cases = [
  { name: "G1 real id, 1 char flipped", id: flipped },
  { name: "G2 real id, last char truncated", id: real.id.slice(0, -1) },
  { name: "G3 real id, uppercased", id: real.id.toUpperCase() },
  { name: "G4 real id verbatim (control)", id: real.id },
]

for (const c of cases) {
  await call(c.name, {
    tools: TOOLS,
    max_tokens: 256,
    messages: [
      USER,
      { role: "assistant", content, tool_calls: [{ ...real, id: c.id }] },
      { role: "tool", tool_call_id: c.id, content: '{"utc":"2026-09-12T03:49:25Z"}' },
    ],
  })
}

console.log("\n=== done ===")
