// REFERENCE ONLY — does not run in this repo.
//
// Target: oh-my-pi (imports @oh-my-pi/pi-ai, @oh-my-pi/pi-catalog/build).
// Kept here because the oh-my-pi checkout it was written for is being reset
// from upstream. It conforms to the wire-probe standard in ../README.md, so
// it can be dropped back into that repo unchanged once its workspace builds
// (bun install && bun --cwd=packages/natives run build).
//
/**
 * PROBE 01 - what oh-my-pi actually puts on the Anthropic wire. [offline, no key]
 *
 * Standardised counterpart of
 *   opencode/experiments/2026-09-12_anthropic-cache/01_wire_shape.mts
 * Same sections, same columns, so the two numbers are directly comparable.
 *
 * Drives the real provider through its public entry (streamSimple) with a stub
 * fetch and a canned SSE envelope copied from packages/ai/test/
 * anthropic-cache-refresh.test.ts, then reads the captured request body.
 *
 * Answers:
 *   - how many cache_control breakpoints reach the wire (Anthropic cap is 4)
 *   - WHERE they land (system[] vs messages[], block index, role)
 *   - how much of the static prefix (tools + system) each one anchors
 *
 * Run from the repo root:
 *   bun run experiments/2026-09-12_anthropic-cache/01_wire_shape.mts
 */
import path from "path"
import { streamSimple } from "@oh-my-pi/pi-ai"
import type { Context, Model } from "@oh-my-pi/pi-ai/types"
import { buildModel } from "@oh-my-pi/pi-catalog/build"

const REPO = path.resolve(import.meta.dir, "../..")
const estTokens = (s: string) => Math.ceil(s.length / 4)

function table(rows: Record<string, string | number>[]) {
  if (rows.length === 0) return "(empty)"
  const cols = Object.keys(rows[0]!)
  const width = Object.fromEntries(
    cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length))]),
  )
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(width[cols[i]!]!)).join("  ")
  return [
    line(cols),
    line(cols.map((c) => "-".repeat(width[c]!))),
    ...rows.map((r) => line(cols.map((c) => String(r[c] ?? "")))),
  ].join("\n")
}

// ── fixture: real repo artifacts, so the printed sizes are production sizes ──
const instructions = await Bun.file(path.join(REPO, "AGENTS.md")).text()
const slots: { name: string; text: string }[] = [
  { name: "env", text: "<env>\nplatform: win32\ncwd: D:/zPython/oh-my-pi\n</env>" },
  { name: "agent-identity", text: "You are a coding agent.\n" + "identity line kept stable across turns\n".repeat(200) },
  { name: "rules", text: "# Rules\n" + "- rule line kept stable across turns\n".repeat(120) },
  { name: "instructions(AGENTS.md)", text: instructions },
  { name: "mutable-tail", text: "# Session\nmode: build\n" + "capsule line\n".repeat(40) },
]

const model: Model<"anthropic-messages"> = buildModel({
  id: "claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: false,
  input: ["text"],
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  contextWindow: 200_000,
  maxTokens: 8_192,
})

const TURNS = 3
const messages: Context["messages"] = []
for (let i = 0; i < TURNS; i++) {
  messages.push({ role: "user", content: `turn ${i}: inspect the cache layout`, timestamp: i * 2 + 1 })
  messages.push({
    role: "assistant",
    content: [{ type: "text", text: `Looking at turn ${i}. ` + "reasoning filler ".repeat(200) }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stopReason: "stop",
    timestamp: i * 2 + 2,
  } as Context["messages"][number])
}
messages.push({ role: "user", content: "now summarise", timestamp: 99 })

const context: Context = {
  systemPrompt: slots.map((slot) => slot.text),
  messages,
  tools: [
    {
      name: "read",
      description: "read a file",
      parameters: { type: "object", properties: { filePath: { type: "string" } }, required: ["filePath"] },
    },
    {
      name: "edit",
      description: "edit a file",
      parameters: {
        type: "object",
        properties: { filePath: { type: "string" }, old: { type: "string" }, new: { type: "string" } },
        required: ["filePath", "old", "new"],
      },
    },
  ] as Context["tools"],
}

// ── stub transport ──────────────────────────────────────────────────────────
let captured: any
let capturedHeaders: Record<string, string> = {}

function sseResponse() {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_probe",
        usage: {
          input_tokens: 0,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ]
  const body = `${events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}`).join("\n\n")}\n\n`
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "request-id": "req_probe" },
  })
}

const stubFetch = (async (input: any, init: any) => {
  const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined)
  captured = JSON.parse(String(raw))
  const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined)
  capturedHeaders = headers instanceof Headers ? Object.fromEntries(headers) : { ...(headers ?? {}) }
  return sseResponse()
}) as any

const stream = streamSimple(model, context, { fetch: stubFetch, apiKey: "probe-not-a-real-key" })
for await (const _event of stream) {
  // drain
}
await stream.result()

if (!captured) {
  console.error("probe failed: no request body captured")
  process.exit(1)
}

// ── 1. marker placement, by slot ────────────────────────────────────────────
const systemBlocks: any[] = Array.isArray(captured.system) ? captured.system : []
console.log("\n=== marker placement on the system blocks ===")
console.log(
  table(
    systemBlocks.map((block, i) => ({
      idx: i,
      slot: slots[i]?.name ?? "(provider-injected)",
      chars: String(block.text ?? "").length,
      marker: block.cache_control ? "CACHE" : "",
    })),
  ),
)

// ── 2. what actually reached the wire ───────────────────────────────────────
const wire: Record<string, string | number>[] = []
systemBlocks.forEach((block, i) => {
  if (block.cache_control) {
    wire.push({ where: "system[]", idx: i, chars: JSON.stringify(block).length, ttl: block.cache_control.ttl ?? "5m (default)" })
  }
})
;(captured.messages ?? []).forEach((msg: any, mi: number) => {
  const blocks = Array.isArray(msg.content) ? msg.content : []
  blocks.forEach((block: any, bi: number) => {
    if (block?.cache_control) {
      wire.push({
        where: `messages[${mi}].${msg.role}`,
        idx: bi,
        chars: JSON.stringify(block).length,
        ttl: block.cache_control.ttl ?? "5m (default)",
      })
    }
  })
})
;(captured.tools ?? []).forEach((tool: any, i: number) => {
  if (tool?.cache_control) wire.push({ where: "tools[]", idx: i, chars: JSON.stringify(tool).length, ttl: tool.cache_control.ttl ?? "5m (default)" })
})

console.log("\n=== cache_control blocks ON THE WIRE ===")
console.log(table(wire.length ? wire : [{ where: "(none)", idx: 0, chars: 0, ttl: "-" }]))
console.log(`\nbreakpoints on the wire: ${wire.length}  (Anthropic hard cap: 4)`)

// ── 3. how much of the static prefix each breakpoint anchors ────────────────
// Wire order is tools -> system -> messages; a breakpoint caches everything up
// to and including itself.
const toolsChars = JSON.stringify(captured.tools ?? []).length
const systemChars = systemBlocks.map((block) => String(block.text ?? "").length)
const anchored: Record<string, string | number>[] = []
let running = toolsChars
systemBlocks.forEach((block, i) => {
  running += systemChars[i] ?? 0
  if (block.cache_control) {
    anchored.push({
      breakpoint: `system[${i}] (${slots[i]?.name ?? "?"})`,
      anchoredChars: running,
      estTokens: estTokens("x".repeat(running)),
    })
  }
})
const staticChars = toolsChars + systemChars.reduce((a, b) => a + b, 0)
console.log("\n=== static prefix anchored by each system breakpoint ===")
console.log(table(anchored.length ? anchored : [{ breakpoint: "(none)", anchoredChars: 0, estTokens: 0 }]))
console.log(`\ntools+system total: ${staticChars} chars (~${estTokens("x".repeat(staticChars))} est tokens)`)
const best = anchored.length ? Number(anchored[anchored.length - 1]!.anchoredChars) : 0
console.log(
  `static prefix left OUTSIDE any static breakpoint: ${staticChars - best} chars ` +
    `(~${estTokens("x".repeat(staticChars - best))} est tokens, ${((1 - best / staticChars) * 100).toFixed(1)}%)`,
)

// ── 4. request headers ──────────────────────────────────────────────────────
console.log("\n=== request headers (secrets redacted) ===")
for (const [key, value] of Object.entries(capturedHeaders)) {
  const lower = key.toLowerCase()
  const secret = lower.includes("key") || lower === "authorization" || lower.includes("token")
  console.log(`${key}: ${secret ? "<redacted>" : value}`)
}
