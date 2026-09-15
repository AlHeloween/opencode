// DeepSeek thinking-mode probe #2 — decisive follow-ups after probe #1.
//
// Probe #1 findings that need isolating:
//   P1  `reasoning_effort: "ultra"` -> 400 with enum
//       none|minimal|low|medium|high|xhigh|max  (docs list ultra; WIRE REJECTS IT)
//   P2  `{"reasoning":{"effort":"none"}}` on /chat/completions did NOT disable
//       thinking (40 reasoning tokens) -> the Anthropic-format field appears
//       IGNORED on the OpenAI-format endpoint
//   P3  dropping an EMPTY reasoning_content on a tool turn -> 200, NOT 400.
//       The docs promise 400. Probe #1 only covered the EMPTY case, so the
//       real rule (non-empty CoT dropped) is still undecided.
//
// This probe isolates:
//   A1 reasoning_effort:"none"            -> does thinking actually turn off?
//   A2 thinking:{type:"disabled"} + tools -> 400 or 200?
//   A3 tool turn with a NON-EMPTY CoT, replay WITHOUT reasoning_content
//      -> the documented 400, or silently accepted?
//   A4 same replay WITH the CoT -> 200 control
//
// Usage: bun experiments/2026-09-12_deepseek-h3/probe-thinking-deepseek2.mjs

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

async function call(name, body) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      "user-agent": "opencode-thinking-probe",
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
  const usage = parsed?.usage
  const msg = parsed?.choices?.[0]?.message
  console.log(
    JSON.stringify({
      name,
      status: res.status,
      reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens,
      prompt_tokens: usage?.prompt_tokens,
      reasoning_content_len: typeof msg?.reasoning_content === "string" ? msg.reasoning_content.length : undefined,
      tool_calls: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : undefined,
      error: res.ok ? undefined : (parsed?.error?.message ?? text).slice(0, 200),
    }),
  )
  return parsed
}

console.log(`\n=== model: ${MODEL} ===`)

// ── A1: reasoning_effort "none" (the only off-value the wire accepts) ──
await call("A1 effort=none", {
  reasoning_effort: "none",
  messages: [{ role: "user", content: "Which is greater, 9.11 or 9.8? Think it through." }],
  max_tokens: 512,
})

// ── A2: thinking disabled + tools present ──
await call("A2 thinking=disabled +tools", {
  thinking: { type: "disabled" },
  tools: TOOL,
  messages: [{ role: "user", content: "Call get_time." }],
  max_tokens: 256,
})

// ── A3/A4: force a NON-EMPTY CoT on the tool turn ──
const step1 = await call("A3 step1 hard question +tool (want non-empty CoT)", {
  tools: TOOL,
  messages: [
    {
      role: "user",
      content:
        "Think step by step about which is greater, 9.11 or 9.8, then call get_time and report both the comparison and the time.",
    },
  ],
  max_tokens: 1024,
})
const assistant = step1?.choices?.[0]?.message
const toolCall = assistant?.tool_calls?.[0]
const cot = typeof assistant?.reasoning_content === "string" ? assistant.reasoning_content : undefined
console.log(
  JSON.stringify({ name: "A3 step1 captured", cot_len: cot?.length ?? 0, has_tool_call: Boolean(toolCall) }),
)

if (toolCall && cot && cot.length > 0) {
  const head = [
    { role: "user", content: "Think step by step about which is greater, 9.11 or 9.8, then call get_time." },
    {
      role: "assistant",
      content: assistant.content ?? "",
      tool_calls: [toolCall],
      // reasoning_content added/omitted per case below
    },
    { role: "tool", tool_call_id: toolCall.id, content: '{"utc":"2026-09-12T03:49:25Z"}' },
  ]
  await call("A3 replay WITHOUT reasoning_content (docs: expect 400)", {
    tools: TOOL,
    messages: head,
    max_tokens: 256,
  })
  await call("A4 replay WITH reasoning_content (control, expect 200)", {
    tools: TOOL,
    messages: head.map((m, i) => (i === 1 ? { ...m, reasoning_content: cot } : m)),
    max_tokens: 256,
  })
} else {
  console.log(
    JSON.stringify({
      name: "A3/A4 skipped",
      note: "step1 produced an empty CoT or no tool call - 400-rule still undecided",
      cot_len: cot?.length ?? 0,
      has_tool_call: Boolean(toolCall),
    }),
  )
}

console.log("\n=== done ===")
