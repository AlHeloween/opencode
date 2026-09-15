/**
 * PROBE 04 — pin the @ai-sdk/anthropic cache contract. [offline, no key]
 *
 * Everything opencode's applyCaching() assumes about the SDK, asserted against
 * the installed package instead of against documentation:
 *
 *   C1  message-level cacheControl lands on the LAST content block, per role
 *       (system / user / assistant / tool-result).
 *   C2  the breakpoint cap is 4.
 *   C3  the 5th breakpoint is dropped SILENTLY on the wire — surfaced only as a
 *       call warning, which opencode never reads.
 *   C4  the static anthropic-beta header opencode sets in provider.ts:167 is
 *       MERGED with the betas the SDK adds per request, not clobbered by them.
 *
 * If a future SDK bump breaks any of these, this probe fails and the caching
 * layout in transform.ts must be re-derived.
 *
 * Run:  bun run experiments/2026-09-12_anthropic-cache/04_sdk_contract.mts
 */
import { createAnthropic } from "../../packages/opencode/node_modules/@ai-sdk/anthropic/dist/index.js"
import { table } from "./lib/fixture.mts"

const CANNED = JSON.stringify({
  id: "msg_probe", type: "message", role: "assistant", model: "claude-opus-5",
  content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
})

let captured: any
let capturedHeaders: Record<string, string> = {}
const capture = (async (_i: any, init: any) => {
  captured = JSON.parse(String(init?.body))
  capturedHeaders =
    init?.headers instanceof Headers ? Object.fromEntries(init.headers) : { ...(init?.headers ?? {}) }
  return new Response(CANNED, { status: 200, headers: { "content-type": "application/json" } })
}) as any
const sdk = createAnthropic({ apiKey: "probe-not-a-real-key", fetch: capture })

const MARK = { anthropic: { cacheControl: { type: "ephemeral" } } }
const run = (prompt: any[]) => sdk("claude-opus-5").doGenerate({ prompt, maxOutputTokens: 64 })

const results: Record<string, string>[] = []
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ check: name, result: pass ? "PASS" : "FAIL", detail })
  return pass
}

// ── C1: message-level marker → last block, per role ─────────────────────────
await run([
  { role: "system", content: "sys", providerOptions: MARK },
  {
    role: "user",
    content: [{ type: "text", text: "a" }, { type: "text", text: "b" }],
    providerOptions: MARK,
  },
  {
    role: "assistant",
    content: [
      { type: "text", text: "thinking out loud" },
      { type: "tool-call", toolCallId: "c1", toolName: "read", input: { filePath: "x" } },
    ],
    providerOptions: MARK,
  },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "c1", toolName: "read", output: { type: "text", value: "r" } }],
    providerOptions: MARK,
  },
])

const sys = captured.system ?? []
check("C1 system → block", Boolean(sys[sys.length - 1]?.cache_control), `system blocks=${sys.length}`)

const findRole = (role: string) => captured.messages.filter((m: any) => m.role === role)
const userMsg = findRole("user")[0]
check(
  "C1 user → LAST block only",
  Boolean(userMsg.content[userMsg.content.length - 1]?.cache_control) && !userMsg.content[0]?.cache_control,
  `blocks=${userMsg.content.map((b: any) => `${b.type}${b.cache_control ? "*" : ""}`).join(",")}`,
)
const asst = findRole("assistant")[0]
check(
  "C1 assistant → LAST block (tool_use)",
  Boolean(asst.content[asst.content.length - 1]?.cache_control),
  `blocks=${asst.content.map((b: any) => `${b.type}${b.cache_control ? "*" : ""}`).join(",")}`,
)
const toolMsg = findRole("user").find((m: any) => m.content.some((b: any) => b.type === "tool_result"))
check(
  "C1 tool_result → block",
  Boolean(toolMsg?.content.find((b: any) => b.type === "tool_result")?.cache_control),
  `tool_result merges into a user message`,
)

// ── C2 / C3: cap and silent drop ────────────────────────────────────────────
const many = (n: number) => {
  const prompt: any[] = [{ role: "system", content: "sys", providerOptions: MARK }]
  for (let i = 0; i < n - 1; i++) {
    prompt.push({ role: "user", content: [{ type: "text", text: `u${i}` }], providerOptions: MARK })
    prompt.push({ role: "assistant", content: [{ type: "text", text: `a${i}` }] })
  }
  return prompt
}
const countWire = () => {
  let n = 0
  for (const block of captured.system ?? []) if (block.cache_control) n++
  for (const msg of captured.messages ?? []) for (const block of msg.content ?? []) if (block.cache_control) n++
  return n
}

await run(many(4))
const at4 = countWire()
const r5 = await run(many(5))
const at5 = countWire()

check("C2 cap is 4", at4 === 4 && at5 === 4, `requested 4 → ${at4} on wire; requested 5 → ${at5} on wire`)
const warned = (r5.warnings ?? []).some((w: any) => String(w.feature ?? "").includes("breakpoint"))
check("C3 5th drop is warning-only", warned, `warnings=${JSON.stringify(r5.warnings ?? [])}`)

// ── C4: our static beta header survives the SDK's own betas ─────────────────
// A second system message mid-conversation makes the SDK add
// "mid-conversation-system-2026-04-07" on its own; both must reach the wire.
const OPENCODE_BETAS = "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
const withHeaders = createAnthropic({
  apiKey: "probe-not-a-real-key",
  fetch: capture,
  headers: { "anthropic-beta": OPENCODE_BETAS },
})
await withHeaders("claude-opus-5").doGenerate({
  prompt: [
    { role: "system", content: "sys" },
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "system", content: "operator note" },
  ],
  maxOutputTokens: 32,
})
const betaHeader = capturedHeaders["anthropic-beta"] ?? ""
check(
  "C4 static beta header merged",
  OPENCODE_BETAS.split(",").every((beta) => betaHeader.includes(beta)) && betaHeader.includes("mid-conversation"),
  `anthropic-beta: ${betaHeader || "(absent)"}`,
)

console.log("\n=== @ai-sdk/anthropic cache contract ===")
console.log(table(results))
process.exitCode = results.some((r) => r.result === "FAIL") ? 1 : 0
