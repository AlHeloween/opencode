import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import http2 from "node:http2"
import { createHash } from "node:crypto"

const root = import.meta.dir
const run = `h2-abort-${Date.now()}-${crypto.randomUUID()}`
const stand = path.join(root, "stand", run)
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

// G6 task vector: actual H2 AbortSignal propagation and independent local control.
const sv = {
  Keywords: "h2-abort 0.50, signal-propagation 0.30, differential-control 0.20",
  "Semantic dominant": "Отделить потерю AbortSignal в gateway от работоспособности реального H2 transport.",
  md5: "abc85016e9fd4a92810cb67d435fe209",
  "prev-md5": "00000000000000000000000000000000",
  "parent-goal-md5": "521cbe68349a4f82b176d9e028fa703d",
}
const out = path.join(root, "h2-abort-fixture-results.json")
const result: Record<string, any> = { run, stand, sv, scope: "current source, localhost h2c, no TLS/Anthropic/history claim", qualification: "pending", cases: [], retainedRuntimeErrors: [] }
const sessions = new Set<any>()
const streams = new Map<string, any>()
const closed = new Map<string, number>()
const sse = (type: string, payload: unknown) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`
const prefix = (mode: string) => sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }) + sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: `H2_THINK_${mode}` } })
const end = sse("message_stop", { type: "message_stop" })
const late = sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "LATE_AFTER_ABORT" } })
const server = http2.createServer()
server.on("session", (session) => { sessions.add(session); session.on("close", () => sessions.delete(session)) })
server.on("stream", (stream, headers) => {
  const mode = String(headers[":path"]).slice(1)
  stream.on("error", (error) => { result.retainedRuntimeErrors.push({ layer: "server-stream", mode, error: String(error) }) })
  stream.on("close", () => { closed.set(mode, stream.rstCode) })
  stream.respond({ ":status": 200, "content-type": "text/event-stream", "x-fixture-transport": "node-http2" })
  if (mode === "qualify") { stream.end("H2_QUALIFIED"); return }
  streams.set(mode, stream)
  stream.write(prefix(mode))
  if (mode === "complete") stream.end(end)
})
const stop = () => {
  h2.closeAll()
  for (const session of sessions) session.destroy()
  server.close()
}
const hostTimeout = setTimeout(async () => {
  result.verdict = "UNKNOWN"
  result.stopReason = "external 10000ms harness deadline"
  stop()
  await fs.writeFile(out, JSON.stringify(result, null, 2))
  console.error(JSON.stringify({ verdict: result.verdict, run, artifact: out, stopReason: result.stopReason }))
  process.exit(2)
}, 10_000)
process.on("unhandledRejection", (error) => { result.retainedRuntimeErrors.push({ layer: "unhandledRejection", error: String(error), stack: error instanceof Error ? error.stack : undefined }) })

try {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const baseUrl = `http://127.0.0.1:${address.port}`
  const qualification = http2.connect(baseUrl)
  let qualified = ""
  const q = qualification.request({ ":path": "/qualify" })
  q.setEncoding("utf8")
  q.on("data", (chunk) => { qualified += chunk })
  await new Promise<void>((resolve, reject) => { q.on("end", resolve); q.on("error", reject); q.end() })
  qualification.close()
  assert.equal(qualified, "H2_QUALIFIED")
  result.qualification = { verdict: "PASS", transport: "h2c", independentlyObserved: qualified }
  for (const mode of ["complete", "abort"] as const) {
    const ctrl = new AbortController()
    const response = await gateway.wrapFetch(globalThis.fetch)(`${baseUrl}/${mode}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "h2-fixture", stream: true, messages: [] }),
      gatewayProvider: "fixture-local-h2", gatewayModel: "h2-fixture", gatewayProtocol: "h2", gatewayStream: true,
      signal: ctrl.signal,
    })
    assert.equal(response.headers.get("x-fixture-transport"), "node-http2")
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let received = ""
    let abortOutcome = "not-requested"
    while (true) {
      const next = await reader.read()
      if (next.done) break
      received += decoder.decode(next.value, { stream: true })
      if (mode === "abort" && received.includes("H2_THINK_abort") && !ctrl.signal.aborted) {
        ctrl.abort("confirmed delta then real user abort")
        const pending = reader.read().then((value) => ({ kind: "read", value }), (error) => ({ kind: "error", error: String(error) }))
        const observed = await Promise.race([pending, Bun.sleep(250).then(() => ({ kind: "pending" }))])
        abortOutcome = observed.kind
        // Release only OUR server after observing whether cancellation propagated.
        const stream = streams.get(mode)
        if (observed.kind === "pending" && !stream.closed) {
          stream.end(late + end)
          const released = await pending
          if (released.kind === "read" && released.value.value) received += decoder.decode(released.value.value, { stream: true })
        } else if (observed.kind === "error") break
      }
    }
    received += decoder.decode()
    const dir = path.join(process.env.OPENCODE_GATEWAY_LOG_DIR!, "per-response")
    const entries = await fs.readdir(dir)
    const captures = []
    for (const file of entries.filter((name) => name.endsWith(".json"))) {
      const capturePath = path.join(dir, file)
      const metadata = JSON.parse(await fs.readFile(capturePath, "utf8"))
      const rawPath = capturePath.replace(/\.json$/, ".raw.txt")
      const raw = await fs.readFile(rawPath, "utf8")
      if (raw.includes(`H2_THINK_${mode}`)) captures.push({ capturePath, rawPath, metadata, raw })
    }
    assert.equal(captures.length, 1)
    const capture = captures[0]!
    const expected = prefix(mode) + (mode === "abort" && abortOutcome === "pending" ? late : "") + (capture.metadata.state === "complete" ? end : "")
    assert.equal(capture.raw, expected)
    assert.equal(received.includes("H2_THINK_"), true)
    if (mode === "complete") assert.equal(capture.metadata.state, "complete")
    const abortPropagated = mode === "abort" && abortOutcome !== "pending" && !received.includes("LATE_AFTER_ABORT")
    let deliveryPredicateRejected = false
    if (mode === "abort") {
      try { assert.equal(abortPropagated, true) }
      catch (error) { deliveryPredicateRejected = error instanceof assert.AssertionError }
    }
    assert.throws(() => assert.equal(capture.metadata.state, "aborted"), assert.AssertionError)
    result.cases.push({ mode, actualTransport: response.headers.get("x-fixture-transport"), signalAborted: ctrl.signal.aborted, abortOutcome, abortPropagated, lateDelivered: received.includes("LATE_AFTER_ABORT"), terminal: capture.metadata.state, terminalReversalRejected: true, verdict: mode === "complete" || abortPropagated ? "PASS" : "FAIL", deliveryPredicate: deliveryPredicateRejected ? "EXPECTED_FAIL" : "PASS", capturePath: capture.capturePath, rawPath: capture.rawPath, rawBytes: Buffer.byteLength(capture.raw), sha256: createHash("sha256").update(capture.raw).digest("hex") })
  }
  // Same native transport and origin: direct signal control, without gateway seam.
  const directCtrl = new AbortController()
  const direct = await h2.requestStream({ baseUrl, url: `${baseUrl}/direct`, method: "POST", headers: {}, body: "{}", signal: directCtrl.signal })
  const directReader = direct.response.body!.getReader()
  let directText = ""
  while (!directText.includes("H2_THINK_direct")) {
    const part = await directReader.read()
    assert.equal(part.done, false)
    directText += new TextDecoder().decode(part.value)
  }
  directCtrl.abort("direct control after observed nonempty delta")
  const directOutcome = await Promise.race([directReader.read().then((value) => ({ kind: "read", done: value.done }), (error) => ({ kind: "error", error: String(error) })), Bun.sleep(250).then(() => ({ kind: "pending" }))])
  assert.equal(directOutcome.kind, "error", "direct real AbortSignal must interrupt transport")
  await Bun.sleep(30)
  result.directControl = { verdict: "PASS", observedDelta: directText.includes("H2_THINK_direct"), outcome: directOutcome, rstCode: closed.get("direct"), h2SessionHealthy: h2.isSessionHealthy(baseUrl) }
  assert.equal(closed.get("direct"), http2.constants.NGHTTP2_CANCEL)
  result.verdict = result.cases.some((item: any) => item.verdict === "FAIL") ? "DEFECT_REPRODUCED" : "PASS"
  clearTimeout(hostTimeout)
  stop()
  await fs.writeFile(path.join(stand, "result.json"), JSON.stringify(result, null, 2))
  await fs.writeFile(out, JSON.stringify(result, null, 2))
  assert.equal(JSON.parse(await fs.readFile(out, "utf8")).run, run)
  console.log(JSON.stringify({ verdict: result.verdict, run, artifact: out, cases: result.cases.map((item: any) => ({ mode: item.mode, verdict: item.verdict, signalAborted: item.signalAborted, abortOutcome: item.abortOutcome, lateDelivered: item.lateDelivered })), directControl: result.directControl }))
  process.exit(result.retainedRuntimeErrors.length ? 1 : 0)
} catch (error) {
  clearTimeout(hostTimeout)
  result.verdict = result.qualification === "pending" ? "UNKNOWN" : "FAIL"
  result.error = String(error)
  stop()
  await fs.writeFile(path.join(stand, "result.json"), JSON.stringify(result, null, 2))
  await fs.writeFile(out, JSON.stringify(result, null, 2))
  console.error(error)
  process.exit(1)
}
