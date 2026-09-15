// Confirm the DeepSeek "off switch" and the effective effort aliases with FULL
// usage output (probe #2 printed reasoning_tokens only, so an absent field was
// ambiguous between "disabled" and "not reported").
//
// F1 reasoning_effort:"none"        -> thinking should be OFF (no reasoning)
// F2 reasoning_effort:"minimal"     -> thinking ON, low effort
// F3 no field (default)             -> thinking ON, effort high (vendor default)
// F4 thinking:{type:"disabled"}     -> thinking OFF
//
// Prints the full usage object so the reader can see which keys exist.
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-thinking-off-switch.mjs

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
const QUESTION = "Which is greater, 9.11 or 9.8? Think it through, then answer in one short sentence."

async function call(name, extra) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-off-switch-probe",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: QUESTION }],
      max_tokens: 2048,
      ...extra,
    }),
  })
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const msg = parsed?.choices?.[0]?.message
  console.log(
    JSON.stringify({
      name,
      status: res.status,
      usage: parsed?.usage,
      reasoning_content_len: typeof msg?.reasoning_content === "string" ? msg.reasoning_content.length : "(field absent)",
      error: res.ok ? undefined : (parsed?.error?.message ?? text).slice(0, 140),
    }),
  )
}

console.log(`\n=== model: ${MODEL} — off-switch confirmation ===`)
await call("F1 reasoning_effort:none", { reasoning_effort: "none" })
await call("F2 reasoning_effort:minimal", { reasoning_effort: "minimal" })
await call("F3 no field (vendor default)", {})
await call("F4 thinking:{type:disabled}", { thinking: { type: "disabled" } })
console.log("\n=== done ===")
