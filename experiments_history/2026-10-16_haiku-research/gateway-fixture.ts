import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"

// Plan binding: gateway stream capture, complete/consumer-abort controls.
const sv = {
  Keywords: "gateway-capture 0.50, cancellation 0.30, deterministic-controls 0.20",
  "Semantic dominant": "Проверить сохранение реального SSE при завершении и отмене потребителем.",
  md5: "b2a9130ce78446f19e6d08572fa3c641",
  "prev-md5": "00000000000000000000000000000000",
  "parent-goal-md5": "521cbe68349a4f82b176d9e028fa703d",
}

const root = import.meta.dir
const run = `gateway-${Date.now()}-${crypto.randomUUID()}`
const stand = path.join(root, "stand", run)
await fs.mkdir(stand, { recursive: true })
process.env.OPENCODE_TEST_HOME = stand
process.env.OPENCODE_TEST_CONFIG = path.join(stand, "config")
process.env.OPENCODE_GATEWAY_LOG_DIR = path.join(stand, "gateway")
process.env.OPENCODE_DB = ":memory:"
const { Global } = await import("../../packages/core/src/global")
Global.initFromWorktree(stand)
assert.equal(Global.Path.data, path.join(stand, ".opencode", "data"))
const { configureLogging, setDebugConfig, wrapFetch } = await import(
  "../../packages/opencode/src/provider/gateway/adaptive-client"
)
configureLogging(true)
setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

const encode = new TextEncoder()
const event = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
const prefix = (marker: string) =>
  event("message_start", {
    type: "message_start",
    message: { id: "msg_fixture", type: "message", role: "assistant", content: [], model: "fixture", usage: { input_tokens: 1, output_tokens: 0 } },
  }) +
  event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }) +
  event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: marker } })
const suffix = () =>
  event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "fixture-signature" } }) +
  event("content_block_stop", { type: "content_block_stop", index: 0 }) +
  event("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }) +
  event("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "HAIKU_T_OK" } }) +
  event("content_block_stop", { type: "content_block_stop", index: 1 }) +
  event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }) +
  event("message_stop", { type: "message_stop" })

const cases: Array<Record<string, unknown>> = []
let server: ReturnType<typeof Bun.serve> | undefined
try {
  for (const mode of ["complete", "abort"] as const) {
    const marker = `HAIKU_R_α_${mode}`
    const expectedRaw = prefix(marker) + (mode === "complete" ? suffix() : "")
    let serverCancelled = false
    const emitted: string[] = []
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        assert.equal(new URL(request.url).hostname, "127.0.0.1")
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            // Independently specified fixture, including a multibyte character.
            const bytes = encode.encode(expectedRaw)
            const alpha = encode.encode(expectedRaw.slice(0, expectedRaw.indexOf("α"))).length
            controller.enqueue(bytes.slice(0, alpha + 1))
            controller.enqueue(bytes.slice(alpha + 1))
            emitted.push(expectedRaw)
            if (mode === "complete") controller.close()
          },
          cancel() { serverCancelled = true },
        }), { headers: { "content-type": "text/event-stream" } })
      },
    })
    const dir = path.join(process.env.OPENCODE_GATEWAY_LOG_DIR!, "per-response")
    const before = new Set(await fs.readdir(dir).catch((error) => {
      if (error.code !== "ENOENT") throw error
      return [] as string[]
    }))
    const response = await wrapFetch(globalThis.fetch)(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: `fixture-${mode}`, stream: true, messages: [] }),
      gatewayProvider: "fixture-local",
      gatewayModel: `fixture-${mode}`,
      gatewayProtocol: "http/1.1",
      gatewayStream: true,
      gatewayTimeoutMs: 5000,
    })
    assert.equal(response.status, 200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let received = ""
    const deadline = setTimeout(() => { void reader.cancel("fixture timeout") }, 4000)
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        received += decoder.decode(value, { stream: true })
        if (mode === "abort" && received.includes(marker)) {
          // Cancellation is allowed only AFTER the actual delivered delta is observed.
          await reader.cancel("fixture user stop after confirmed delta")
          break
        }
      }
      received += decoder.decode()
    } finally {
      clearTimeout(deadline)
    }
    assert.ok(received.includes(marker), "consumer must observe the nonempty thinking delta")
    const files = (await fs.readdir(dir)).filter((name) => name.endsWith(".json") && !before.has(name))
    assert.equal(files.length, 1, "exactly one independent response record")
    const capturePath = path.join(dir, files[0]!)
    const captured = JSON.parse(await fs.readFile(capturePath, "utf8"))
    const rawPath = capturePath.replace(/\.json$/, ".raw.txt")
    const raw = await fs.readFile(rawPath, "utf8")
    assert.equal(captured.state, mode === "complete" ? "complete" : "aborted")
    assert.equal(raw, expectedRaw, "readback must match the independent fixture byte for byte")
    assert.equal(emitted.join(""), raw)
    assert.equal(raw.includes("HAIKU_T_OK"), mode === "complete")
    // Discriminating control: terminal reversal MUST be rejected by this predicate.
    assert.notEqual(captured.state, mode === "complete" ? "aborted" : "complete")
    let rejectedWrongTerminal = false
    try { assert.equal(captured.state, mode === "complete" ? "aborted" : "complete") }
    catch (error) { rejectedWrongTerminal = error instanceof assert.AssertionError }
    assert.equal(rejectedWrongTerminal, true)
    cases.push({ mode, prediction: mode === "complete" ? "complete + text" : "aborted + partial thinking", verdict: "PASS", control: "EXPECTED_FAIL", capturePath, rawPath, sha256: createHash("sha256").update(raw).digest("hex"), rawBytes: Buffer.byteLength(raw), receivedBytes: Buffer.byteLength(received), confirmedDelta: marker, serverCancelledAtReadback: serverCancelled })
    server.stop(true)
    server = undefined
  }
  const result = { verdict: "PASS", run, scope: "real gateway HTTP/1.1 local SSE + terminal capture, not SDK/processor/TUI or live Anthropic", stand, sv, cases }
  const out = path.join(root, "gateway-fixture-results.json")
  await fs.writeFile(out, JSON.stringify(result, null, 2))
  const readback = JSON.parse(await fs.readFile(out, "utf8"))
  assert.equal(readback.cases.length, 2)
  console.log(JSON.stringify({ verdict: "PASS", run, artifact: out, cases: cases.length, controls: cases.map((c) => c.control) }))
  process.exit(0)
} catch (error) {
  console.error(error)
  await fs.writeFile(path.join(root, "gateway-fixture-results.json"), JSON.stringify({ verdict: "FAIL", run, stand, sv, cases, error: String(error) }, null, 2))
  process.exitCode = 1
} finally {
  server?.stop(true)
}
