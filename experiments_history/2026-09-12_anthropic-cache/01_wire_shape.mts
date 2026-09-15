/**
 * PROBE 01 — what opencode actually puts on the Anthropic wire. [offline, no key]
 *
 * Drives the REAL @ai-sdk/anthropic language model with a stub fetch and dumps
 * the request body. Faithful to production: production applies
 * ProviderTransform.message to the LanguageModelV3 prompt inside a
 * wrapLanguageModel middleware (llm.ts:962), which is exactly the object we
 * hand to doGenerate here.
 *
 * Proves / falsifies:
 *   - how many cache_control breakpoints reach the wire (SDK cap is 4)
 *   - WHERE they land (block index, role, which system slot)
 *   - how much of the static prefix each breakpoint anchors
 *
 * Run from the repo root:  bun run experiments/2026-09-12_anthropic-cache/01_wire_shape.mts
 *
 * The deep relative import is deliberate: the SDK lives in the opencode
 * package's node_modules, and this file must run from the repo root.
 */
import { createAnthropic } from "../../packages/opencode/node_modules/@ai-sdk/anthropic/dist/index.js"
import { ProviderTransform } from "../../packages/opencode/src/provider/transform"
import { agenticTail, anthropicModel, estTokens, systemSlots, table } from "./lib/fixture.mts"

const CANNED = JSON.stringify({
  id: "msg_probe",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
})

let captured: any
const stubFetch = async (_input: any, init: any) => {
  captured = { headers: init?.headers, body: JSON.parse(String(init?.body)) }
  return new Response(CANNED, { status: 200, headers: { "content-type": "application/json" } })
}

const slots = await systemSlots()
const model = anthropicModel()

// Production prompt shape (LanguageModelV3Prompt), mirroring llm.ts:915 +
// the agentic loop history.
const prompt: any[] = [
  ...slots.map((slot) => ({ role: "system", content: slot.text })),
  ...agenticTail(3),
]

const transformed = ProviderTransform.message(prompt as any, model, {}) as any[]

const sdk = createAnthropic({ apiKey: "probe-not-a-real-key", fetch: stubFetch as any })
await sdk("claude-opus-5").doGenerate({
  prompt: transformed,
  maxOutputTokens: 4096,
  tools: [
    { type: "function", name: "read", description: "read a file", inputSchema: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] } },
    { type: "function", name: "edit", description: "edit a file", inputSchema: { type: "object", properties: { filePath: { type: "string" }, old: { type: "string" }, new: { type: "string" } }, required: ["filePath", "old", "new"] } },
  ],
})

// ── 1. marker placement before the wire (message level) ──────────────────────
console.log("\n=== marker placement on the ModelMessage/V3 prompt ===")
console.log(
  table(
    transformed.map((msg, i) => ({
      idx: i,
      role: msg.role,
      slot: msg.role === "system" ? (slots[i]?.name ?? "?") : "-",
      chars: typeof msg.content === "string" ? msg.content.length : JSON.stringify(msg.content).length,
      marker: msg.providerOptions?.anthropic?.cacheControl ? "CACHE" : "",
    })),
  ),
)

// ── 2. what actually reached the wire ───────────────────────────────────────
const body = captured.body
const wire: { where: string; idx: number; chars: number; ttl: string }[] = []
const scan = (blocks: any[], where: string) => {
  blocks?.forEach((block: any, i: number) => {
    if (block?.cache_control) {
      wire.push({ where, idx: i, chars: JSON.stringify(block).length, ttl: block.cache_control.ttl ?? "5m (default)" })
    }
  })
}
scan(body.system, "system[]")
body.messages?.forEach((msg: any, mi: number) => {
  if (Array.isArray(msg.content)) scan(msg.content, `messages[${mi}].${msg.role}`)
})
body.tools?.forEach((tool: any, i: number) => {
  if (tool?.cache_control) wire.push({ where: "tools[]", idx: i, chars: JSON.stringify(tool).length, ttl: tool.cache_control.ttl ?? "5m (default)" })
})

console.log("\n=== cache_control blocks ON THE WIRE ===")
console.log(table(wire.length ? wire : [{ where: "(none)", idx: 0, chars: 0, ttl: "-" }]))
console.log(`\nbreakpoints on the wire: ${wire.length}  (SDK hard cap: 4)`)

// ── 3. how much of the prefix each breakpoint anchors ────────────────────────
// Wire order is tools -> system -> messages; a breakpoint caches everything
// up to and including itself.
const toolsChars = JSON.stringify(body.tools ?? []).length
const systemChars = (body.system ?? []).map((b: any) => (b.text ?? "").length)
const anchored: Record<string, string | number>[] = []
let running = toolsChars
;(body.system ?? []).forEach((block: any, i: number) => {
  running += systemChars[i] ?? 0
  if (block.cache_control) {
    anchored.push({
      breakpoint: `system[${i}] (${slots[i]?.name ?? "?"})`,
      anchoredChars: running,
      estTokens: estTokens("x".repeat(running)),
    })
  }
})
const staticChars = toolsChars + systemChars.reduce((a: number, b: number) => a + b, 0)
console.log("\n=== static prefix anchored by each system breakpoint ===")
console.log(table(anchored.length ? anchored : [{ breakpoint: "(none)", anchoredChars: 0, estTokens: 0 }]))
console.log(`\ntools+system total: ${staticChars} chars (~${estTokens("x".repeat(staticChars))} est tokens)`)
const best = anchored.length ? Number(anchored[anchored.length - 1]!.anchoredChars) : 0
console.log(
  `static prefix left OUTSIDE any static breakpoint: ${staticChars - best} chars ` +
    `(~${estTokens("x".repeat(staticChars - best))} est tokens, ${((1 - best / staticChars) * 100).toFixed(1)}%)`,
)

// ── 4. request headers actually sent ────────────────────────────────────────
console.log("\n=== request headers ===")
const headers = captured.headers instanceof Headers ? Object.fromEntries(captured.headers) : (captured.headers ?? {})
for (const [key, value] of Object.entries(headers)) {
  console.log(`${key}: ${key.toLowerCase().includes("key") || key.toLowerCase() === "authorization" ? "<redacted>" : value}`)
}
