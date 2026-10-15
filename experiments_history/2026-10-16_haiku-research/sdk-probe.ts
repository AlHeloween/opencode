import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { createAnthropic } from "../../packages/opencode/node_modules/@ai-sdk/anthropic"
import { generateText, streamText } from "../../packages/opencode/node_modules/ai"
import { ProviderTransform } from "../../packages/opencode/src/provider/transform"

const out = new URL("./sdk-results.json", import.meta.url)
const captures: Record<string, any>[] = []
const model = (id: string) => ({
  id, providerID: "anthropic", name: id,
  api: { id, npm: "@ai-sdk/anthropic", url: "https://fixture.invalid" },
  capabilities: { reasoning: true, interleaved: false },
  limit: { context: id.includes("4-5") ? 64_000 : 1_000_000, output: id.includes("4-5") ? 64_000 : 128_000 },
  options: {}, headers: {}, status: "active", release_date: "2026-10-07",
}) as any
const response = (id: string) => ({
  id: "msg_fixture", type: "message", role: "assistant", model: id,
  content: [{ type: "text", text: "FIXTURE_OK" }], stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 20, output_tokens: 4 },
})

async function capture(id: string, options: any, messages?: any[]) {
  let body: any
  const sdk = createAnthropic({ apiKey: "fixture-only", fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body))
    return new Response(JSON.stringify(response(id)), { headers: { "content-type": "application/json" } })
  } })
  await generateText({ model: sdk(id), maxOutputTokens: 8192, maxRetries: 0,
    ...(messages ? { messages } : { prompt: "fixture" }),
    providerOptions: ProviderTransform.providerOptions(model(id), options),
  })
  assert.ok(body, "capture-fetch was called")
  return body
}

for (const id of ["claude-haiku-5-5", "claude-haiku-5.5", "claude-opus-4-7", "claude-haiku-4-5"]) {
  const variant = ProviderTransform.variants(model(id)).high
  const body = await capture(id, variant)
  captures.push({ id, variant: "high", thinking: body.thinking, output_config: body.output_config, max_tokens: body.max_tokens })
  assert.equal(body.thinking.type, id.includes("4-5") ? "enabled" : "adaptive")
  if (id.includes("5-5") || id.includes("5.5")) assert.equal(body.thinking.display, undefined)
  if (id.includes("opus")) assert.equal(body.thinking.display, "summarized")
}
const max = ProviderTransform.variants(model("claude-haiku-5-5")).max
const explicit = await capture("claude-haiku-5-5", { ...max, thinking: { ...max.thinking, display: "summarized" } })
assert.equal(explicit.thinking.display, "summarized")
assert.equal(explicit.output_config.effort, "max")
captures.push({ id: "claude-haiku-5-5", variant: "explicit summarized/max", thinking: explicit.thinking,
  output_config: explicit.output_config })

const history = [{ role: "assistant", content: [
  { type: "reasoning", text: "", providerOptions: { anthropic: { signature: "fixture-signature" } } },
  { type: "text", text: "First answer" },
] }, { role: "user", content: "Next turn" }]
const direct = await capture("claude-haiku-5-5", max, history)
const transformedMessages = ProviderTransform.message(structuredClone(history) as any, model("claude-haiku-5-5"), {})
const transformed = await capture("claude-haiku-5-5", max, transformedMessages)
const directBlocks = direct.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
const transformedBlocks = transformed.messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : [])
assert.ok(directBlocks.some((p: any) => p.type === "thinking" && p.thinking === "" && p.signature === "fixture-signature"))
assert.equal(transformedBlocks.some((p: any) => p.type === "thinking"), false)

// Deterministic local SSE, split through multibyte UTF-8 and across frame boundaries.
function fixtureEvents(summarized: boolean) {
  return [
    { type: "message_start", message: { ...response("claude-haiku-5-5"), content: [], stop_reason: null } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    ...(summarized ? [{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "R_α" } }] : []),
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "fixture-signature" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "T_OK_α" } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: "message_stop" },
  ]
}
const streams = []
for (const summarized of [false, true]) {
  const encoded = new TextEncoder().encode(fixtureEvents(summarized)
    .map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""))
  const sdk = createAnthropic({ apiKey: "fixture-only", fetch: async () => new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < encoded.length; i += 7) controller.enqueue(encoded.slice(i, i + 7))
      controller.close()
    },
  }), { headers: { "content-type": "text/event-stream" } }) })
  const events = []
  const result = streamText({ model: sdk("claude-haiku-5-5"), prompt: "fixture", maxRetries: 0, maxOutputTokens: 8192,
    providerOptions: { anthropic: max },
  })
  for await (const event of result.fullStream) {
    events.push({ type: event.type, text: "text" in event ? event.text : undefined,
      metadata: "providerMetadata" in event ? event.providerMetadata : undefined })
  }
  assert.equal(await result.text, "T_OK_α")
  assert.equal(await result.finishReason, "stop")
  const signatures = events.filter(e => (e.metadata as any)?.anthropic?.signature === "fixture-signature")
  assert.ok(signatures.length > 0, "SDK must emit signature metadata even with empty thinking text")
  const thinking = events.filter(e => e.type === "reasoning-delta").map(e => e.text ?? "").join("")
  assert.equal(thinking, summarized ? "R_α" : "")
  streams.push({ summarized, complete: true, text: await result.text, thinking_chars: thinking.length,
    signature_events: signatures.length, event_types: events.map(e => e.type) })
}

// The completed-stream predicate must reject a truncated stream (EXPECTED_FAIL control).
const terminal = (events: any[]) => events.some(e => e.type === "message_stop")
assert.equal(terminal(fixtureEvents(false)), true)
assert.equal(terminal(fixtureEvents(false).slice(0, -1)), false)
const report = { captures, signed_empty: { direct_sdk_preserved: true, transformed_preserved: false }, streams,
  controls: { utf8_chunk_boundary: "PASS", complete_stream: "PASS", truncated_stream: "EXPECTED_FAIL" },
  scope: "Actual installed SDK and ProviderTransform; no provider network, processor or TUI execution." }
writeFileSync(out, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))
