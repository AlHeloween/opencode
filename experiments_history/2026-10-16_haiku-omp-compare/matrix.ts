import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

const here = import.meta.dir
const root = "D:/zPython/opencode"
const stand = path.join(here, "matrix-stand")
await fs.mkdir(stand, { recursive: true })
process.env.OPENCODE_TEST_HOME = stand
process.env.OPENCODE_TEST_CONFIG = path.join(stand, "config")
process.env.OPENCODE_GATEWAY_LOG_DIR = path.join(stand, "gateway")
const { Global } = await import("../../packages/core/src/global")
Global.initFromWorktree(stand)
const gateway = await import("../../packages/opencode/src/provider/gateway/adaptive-client")
const h2 = await import("../../packages/opencode/src/provider/gateway/h2-transport")
gateway.configureLogging(true)
gateway.setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")

class SSE {
  decoder = new TextDecoder()
  carry = ""
  events: any[] = []
  push(bytes: Uint8Array, final = false) {
    this.carry += this.decoder.decode(bytes, { stream: !final })
    const frames = this.carry.split(/\r?\n\r?\n/)
    this.carry = frames.pop()!
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n")
      if (data) this.events.push(JSON.parse(data))
    }
  }
}
const fixture = new TextEncoder().encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"α_OK"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n')
const check = new SSE()
for (const byte of fixture) check.push(Uint8Array.of(byte))
assert.equal(check.events[0].delta.text, "α_OK")
assert.equal(check.events.at(-1).type, "message_stop")
const cut = new SSE()
cut.push(fixture.slice(0, fixture.length - 60))
assert.equal(cut.events.some(e => e.type === "message_stop"), false)
const errorFixture = new SSE()
errorFixture.push(new TextEncoder().encode('event: error\ndata: {"type":"error","error":{"type":"fixture_error"}}\n\n'))
assert.equal(errorFixture.events[0].type, "error")

const originalPath = root + "/.opencode/data/gateway/raw-wire/2026-10-15T20-08-27-758Z-986ff181-2093-4d2c-b892-c60f3bf34a90-attempt1.json"
const originalCapture = JSON.parse(await fs.readFile(originalPath, "utf8"))
const original = JSON.parse(originalCapture.body)
const omp = JSON.parse(await fs.readFile(path.join(here, "omp-current-payload.private.json"), "utf8"))
const A = { ...original, max_tokens: 8192 }
const B = { ...omp.payload, max_tokens: 8192 }
const C = { ...A, tools: B.tools }
const D = { ...A, messages: B.messages }
assert.equal(hash({ ...C, tools: A.tools }), hash(A))
assert.equal(hash({ ...D, messages: A.messages }), hash(A))
const arms = { A, B, C, D }
const auth = JSON.parse(await fs.readFile(root + "/bin/auth.json", "utf8"))
assert.equal(auth.anthropic.type, "api")
const headers = {
  "content-type": "application/json", "anthropic-version": "2023-06-01",
  "x-api-key": auth.anthropic.key,
  "anthropic-beta": "structured-outputs-2025-11-13,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,context-management-2025-06-27,thinking-binding-controls-2026-08-01",
}
const result: any = {
  started: new Date().toISOString(), scope: "Exploratory payload matrix through actual isolated OpenCode gateway H2; no model tools executed; not full app acceptance.",
  controls: { bytewise_utf8: "PASS", truncated_terminal: "EXPECTED_FAIL", error_event: "PASS", C_only_tools_changed: "PASS", D_only_messages_changed: "PASS" },
  source: { originalPath, originalBodySha256: hash(originalCapture.body), ompPreSendSha256: omp.bodySha256 },
  arms: Object.fromEntries(Object.entries(arms).map(([k, b]) => [k, { sha256: hash(b), bytes: Buffer.byteLength(JSON.stringify(b)), tools: b.tools.length, messages: b.messages.length, thinking: b.thinking, output_config: b.output_config, max_tokens: b.max_tokens }])),
  order: ["A", "B", "C", "D", "D", "C", "B", "A"], calls: [],
}
const out = path.join(here, "matrix-results.json")
const persist = () => fs.writeFile(out, JSON.stringify(result, null, 2))
await persist()
try {
  for (const key of result.order as Array<keyof typeof arms>) {
    assert.ok(result.calls.length < 8)
    const body = arms[key]
    const start = Date.now()
    const item: any = { arm: key, index: result.calls.length, started: new Date().toISOString(), status: 0, complete: false, text_chars: 0, thinking_chars: 0, event_count: 0, ping_count: 0, tools: [], body_sha256: hash(body) }
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const timer = setTimeout(() => { item.deadline = true; controller.abort(); void reader?.cancel("matrix deadline"); h2.closeAll() }, 90000)
    try {
      const response = await gateway.wrapFetch(globalThis.fetch)("https://api.anthropic.com/v1/messages", {
        method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
        gatewayProvider: "anthropic", gatewayModel: body.model, gatewayProtocol: "h2", gatewayStream: true,
      })
      item.status = response.status
      item.headers_ms = Date.now() - start
      item.provider_request_id = response.headers.get("request-id")
      reader = response.body!.getReader()
      const sse = new SSE()
      let seen = 0
      const toolJson = new Map<number, string>()
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) { sse.push(new Uint8Array(), true); break }
        item.first_byte_ms ??= Date.now() - start
        sse.push(chunk.value)
        if (!response.headers.get("content-type")?.includes("text/event-stream")) {
          item.non_sse_bytes = (item.non_sse_bytes ?? 0) + chunk.value.length
          continue
        }
        for (const event of sse.events.slice(seen)) {
          const ms = Date.now() - start
          item.event_count++
          if (event.type === "message_start") item.initial_usage = event.message?.usage
          if (event.type === "ping") item.ping_count++
          if (event.type === "content_block_start" && event.content_block?.type === "thinking") item.first_thinking_start_ms ??= ms
          if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            item.first_action_ms ??= ms
            item.tools.push(event.content_block.name)
            toolJson.set(event.index, "")
          }
          if (event.delta?.text) { item.first_action_ms ??= ms; item.first_text_ms ??= ms; item.text_chars += event.delta.text.length }
          if (event.delta?.thinking) { item.first_visible_thinking_ms ??= ms; item.thinking_chars += event.delta.thinking.length }
          if (event.delta?.partial_json) toolJson.set(event.index, (toolJson.get(event.index) ?? "") + event.delta.partial_json)
          if (event.type === "content_block_stop" && toolJson.has(event.index)) {
            try { JSON.parse(toolJson.get(event.index) || "{}"); item.valid_tool_json = true }
            catch { item.invalid_tool_json = true }
          }
          if (event.type === "message_delta") { item.stop_reason = event.delta?.stop_reason; item.final_usage = event.usage }
          if (event.type === "message_stop") item.complete = true
          if (event.type === "error") item.provider_error = event.error
        }
        seen = sse.events.length
      }
    } catch (error) {
      item.error = String(error).replace(/sk-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    } finally {
      clearTimeout(timer)
      item.elapsed_ms = Date.now() - start
    }
    item.action_ready = item.complete && !item.invalid_tool_json && (
      item.stop_reason === "end_turn" && item.text_chars > 0 || item.stop_reason === "tool_use" && item.valid_tool_json === true
    )
    result.calls.push(item)
    await persist()
    console.log(JSON.stringify({ arm: key, i: item.index, status: item.status, complete: item.complete, elapsed_ms: item.elapsed_ms, first_action_ms: item.first_action_ms, stop: item.stop_reason, output: item.final_usage?.output_tokens, thinking: item.final_usage?.output_tokens_details?.thinking_tokens, action_ready: item.action_ready, error: item.error }))
    if (item.status !== 200 || item.provider_error || item.error) {
      result.stopped_for = "Invalid/error arm requires re-grounding; no unchanged retries or later calls."
      break
    }
  }
} finally {
  h2.closeAll()
  result.finished = new Date().toISOString()
  await persist()
}
console.log(JSON.stringify({ artifact: out, calls: result.calls.length, finished: result.finished }))
