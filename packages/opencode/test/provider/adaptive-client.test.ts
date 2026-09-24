import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { configureLogging, protocolChain, resolveGatewayProtocol, setDebugConfig, shouldDowngrade, wrapFetch } from "@/provider/gateway/adaptive-client"
import { GlobalBus } from "@/bus/global"

setDefaultTimeout(20_000)

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gateway-capture-"))
const originalLogDir = process.env.OPENCODE_GATEWAY_LOG_DIR

// Each test owns its capture surface: stale files from a previous test would
// break exact-count assertions (per-request logger is a module singleton and
// writes are async).
function resetCaptureDirs() {
  for (const sub of ["per-request", "raw-wire", "per-response"]) {
    fs.rmSync(path.join(logDir, sub), { recursive: true, force: true })
  }
}

function captureFiles(sub: string, ext: string): string[] {
  const dir = path.join(logDir, sub)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith(ext)).sort()
}

afterAll(() => {
  if (originalLogDir === undefined) delete process.env.OPENCODE_GATEWAY_LOG_DIR
  else process.env.OPENCODE_GATEWAY_LOG_DIR = originalLogDir
  fs.rmSync(logDir, { recursive: true, force: true })
})

describe("resolveGatewayProtocol", () => {
  test("default policy: auto (h3-first) for every provider", () => {
    // Owner directive 2026-09-24: attempt h3 first, downgrade to h2, h1 only
    // as the last resort. The probe outcome is cached per origin, so a
    // no-QUIC provider pays one fast-fail probe per TTL, not per request.
    expect(resolveGatewayProtocol("openai")).toBe("auto")
    expect(resolveGatewayProtocol("opencode")).toBe("auto")
    expect(resolveGatewayProtocol("opencode-go")).toBe("auto")
    expect(resolveGatewayProtocol("deepseek")).toBe("auto")
    expect(resolveGatewayProtocol("novita-ai")).toBe("auto")
    expect(resolveGatewayProtocol("openrouter")).toBe("auto")
  })

  test("configured override always wins", () => {
    expect(resolveGatewayProtocol("opencode", "h3")).toBe("h3")
    expect(resolveGatewayProtocol("novita-ai", "h2")).toBe("h2")
    expect(resolveGatewayProtocol("openai", "http/1.1")).toBe("http/1.1")
    expect(resolveGatewayProtocol("openai", "auto")).toBe("auto")
  })
})

describe("h3-first transport policy", () => {
  test("downgrade chain: auto probes h3, a dead h3 probe is cached, explicit choice is honored", () => {
    expect(protocolChain("auto", false)).toEqual(["h3", "h2", "http/1.1"])
    expect(protocolChain("auto", true)).toEqual(["h2", "http/1.1"])
    // An explicit h3 choice ignores the cached probe — the user asked for it.
    expect(protocolChain("h3", true)).toEqual(["h3", "h2", "http/1.1"])
    expect(protocolChain("h2", false)).toEqual(["h2", "http/1.1"])
    // h1 is never a recommended rung: it exists only as the last resort.
    expect(protocolChain("http/1.1", false)).toEqual(["http/1.1"])
  })

  test("downgrade decision: h3 leaves on any transport error, h2 keeps its established rule", () => {
    const handshake = { category: "tls_error" as const, retryable: false, message: "HTTP3HandshakeFailed fetching ..." }
    expect(shouldDowngrade("h3", handshake)).toBe(true)
    expect(shouldDowngrade("h3", { category: "client_abort" as const, retryable: false, message: "request aborted" })).toBe(false)
    // h2 keeps the old rule: tls_error does NOT downgrade, conn_reset does.
    expect(shouldDowngrade("h2", handshake)).toBe(false)
    expect(shouldDowngrade("h2", { category: "conn_reset" as const, retryable: true, message: "ECONNRESET" })).toBe(true)
    expect(shouldDowngrade("http/1.1", { category: "conn_reset" as const, retryable: true, message: "ECONNRESET" })).toBe(false)
  })
})

describe("gateway wire capture", () => {
  test("three points of one exchange: verbatim intent, verbatim wire, complete response under one key", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
    resetCaptureDirs()
    configureLogging(true)
    setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

    let sequence = 0
    const received: string[] = []
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        sequence++
        received.push(await request.text())
        // OpenAI-shaped SSE chunk: assembleMessage() (per-response capture)
        // folds choices[].delta.content — the fixture must speak the real wire
        // dialect for the assembled message to carry the turn payload.
        return new Response(
          `data: {"id":"${sequence}","choices":[{"delta":{"content":"turn-${sequence}"}}]}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    const requestBody = '{"model":"capture-model","stream":true,"messages":[]}'
    const protocolEvents: Array<{ directory?: string; payload: { type: string; properties: Record<string, string> } }> = []
    const onProtocol = (event: any) => {
      if (event.payload?.type === "gateway.protocol.selected") protocolEvents.push(event)
    }
    GlobalBus.on("event", onProtocol)
    const request = () => wrapFetch(globalThis.fetch)(server.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "msg_current_turn" },
      body: requestBody,
      gatewayProvider: "capture-provider",
      gatewayModel: "capture-model",
      gatewayProtocol: "http/1.1",
      gatewayStream: true,
    })

    try {
      expect(await (await request()).text()).toContain("turn-1")
      expect(await (await request()).text()).toContain("turn-2")
      await Bun.sleep(25)
    } finally {
      GlobalBus.off("event", onProtocol)
    }

    // T4: the worker publishes the correlated fact through the TUI event bridge.
    expect(protocolEvents).toHaveLength(2)
    expect(protocolEvents[0]).toMatchObject({
      directory: "global",
      payload: {
        type: "gateway.protocol.selected",
        properties: {
          requestID: "msg_current_turn",
          providerID: "capture-provider",
          modelID: "capture-model",
          protocol: "http/1.1",
        },
      },
    })

    // ── intent: per-request/<ISO-start>-<requestId>.json ──
    const intentFiles = captureFiles("per-request", ".json")
    expect(intentFiles).toHaveLength(2)
    expect(intentFiles.some((name) => name.includes("unknown"))).toBe(false)
    expect(captureFiles("per-request", ".diff")).toHaveLength(1)
    const stem1 = intentFiles[0]!.replace(/\.json$/, "")
    expect(stem1).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}$/)
    const requestEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-request", intentFiles[0]!), "utf8"),
    ) as { body: string; headers: Record<string, string> }
    // T1: the intent body is stored VERBATIM — the string is the record.
    expect(requestEntry.body).toBe(requestBody)
    expect(Object.keys(requestEntry.headers)).toContain("content-type")

    // ── sent: raw-wire/<stem>-attempt<N>.json ──
    const wireFiles = captureFiles("raw-wire", ".json")
    expect(wireFiles).toHaveLength(2)
    expect(captureFiles("raw-wire", ".diff")).toHaveLength(2)
    const wireEntries = wireFiles.map(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(logDir, "raw-wire", name), "utf8")) as {
          id: string
          attempt: number
          protocol: string
          body: string
          headers: Record<string, string>
        },
    )
    for (const wireEntry of wireEntries) {
      expect(wireEntry.attempt).toBe(1)
      expect(wireEntry.protocol).toBe("http/1.1")
      // T2: the exact string handed to the transport, one record per attempt.
      expect(wireEntry.body).toBe(requestBody)
    }
    const wireStems = wireFiles.map((name) => name.replace(/-attempt\d+\.json$/, ""))
    expect(wireStems).toContain(stem1)
    expect(Object.keys(wireEntries[0]!.headers)).not.toContain("authorization")

    // ── received: per-response/<stem>-attempt<N>.json|.md|.raw.txt ──
    const responseFiles = captureFiles("per-response", ".json")
    expect(responseFiles).toHaveLength(2)
    expect(captureFiles("per-response", ".raw.txt")).toHaveLength(2)
    expect(captureFiles("per-response", ".md")).toHaveLength(2)
    expect(fs.readdirSync(path.join(logDir, "per-response")).filter((name) => name.includes("-attempt1."))).toHaveLength(6)
    const responseEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-response", responseFiles[0]!), "utf8"),
    ) as { message: { content: string }; state: string; status: number }
    expect(responseEntry.state).toBe("complete")
    expect(responseEntry.status).toBe(200)
    expect(JSON.stringify(responseEntry.message)).toContain("turn-1")
    const rawSidecar = fs.readFileSync(
      path.join(logDir, "per-response", captureFiles("per-response", ".raw.txt")[0]!),
      "utf8",
    )
    expect(rawSidecar).toContain("data: [DONE]")

    // S5: capture is read-only — the bytes ON the wire do not depend on the
    // logging switch.
    configureLogging(false)
    expect(await (await request()).text()).toContain("turn-3")
    expect(received[0]).toBe(requestBody)
    expect(received[2]).toBe(requestBody)
    configureLogging(true)
  })

  test("glm/deepseek: per-request holds the INTENT, raw-wire holds the REWRITTEN body", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
    resetCaptureDirs()
    configureLogging(true)
    setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
      },
    })
    const dual = JSON.stringify({
      model: "z-ai/glm-5.3-flash",
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: "a",
          reasoning: "thought",
          reasoning_details: [{ type: "reasoning.text", text: "thought" }],
        },
        { role: "tool", tool_call_id: "call_x", content: "result" },
        {
          role: "assistant",
          content: null,
          reasoning_details: [],
          tool_calls: [
            { id: "call_y", type: "function", function: { name: "noop", arguments: "{}" } },
          ],
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_z", type: "function", function: { name: "noop2", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_z", content: "result-2" },
      ],
    })
    await wrapFetch(globalThis.fetch)(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dual,
      gatewayProvider: "openrouter",
      gatewayModel: "z-ai/glm-5.3-flash",
      gatewayProtocol: "http/1.1",
      gatewayStream: true,
    })
    // Non-target provider must pass through untouched.
    await wrapFetch(globalThis.fetch)(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dual.replace("z-ai/glm-5.3-flash", "some-anthropic-model"),
      gatewayProvider: "openrouter",
      gatewayModel: "some-anthropic-model",
      gatewayProtocol: "http/1.1",
      gatewayStream: true,
    })
    // All z-ai vendor models are covered (slug prefix, not just glm family).
    await wrapFetch(globalThis.fetch)(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: dual,
      gatewayProvider: "openrouter",
      gatewayModel: "z-ai/future-non-glm-model",
      gatewayProtocol: "http/1.1",
      gatewayStream: true,
    })
    await Bun.sleep(25)

    // T1: per-request is the INTENT — the SDK's dual dialect, BEFORE the
    // rewrite. This is exactly what the three-point split exists to show.
    const intents = captureFiles("per-request", ".json").map(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(logDir, "per-request", name), "utf8")) as { body: string },
    )
    expect(intents).toHaveLength(3)
    const intentGlm = JSON.parse(intents.at(-3)!.body) as { messages: Array<Record<string, unknown>> }
    const intentAssistant = intentGlm.messages.find((message) => message.role === "assistant")!
    expect(intentAssistant.reasoning).toBe("thought")
    expect(intentAssistant.reasoning_details).toBeDefined()
    expect(intentAssistant.reasoning_content).toBeUndefined()
    expect(intents.at(-3)!.body).toContain('"reasoning_details"')
    // Passthrough providers keep their intent verbatim too.
    expect(intents.at(-2)!.body).toContain("some-anthropic-model")
    expect(intents.at(-2)!.body).toContain('"reasoning_details"')

    // T2: raw-wire is what was SENT — the single native reasoning_content.
    const wires = captureFiles("raw-wire", ".json").map(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(logDir, "raw-wire", name), "utf8")) as { body: string; attempt: number },
    )
    expect(wires).toHaveLength(3)
    expect(wires.every((wire) => wire.attempt === 1)).toBe(true)
    const wireGlm = JSON.parse(wires.at(-3)!.body) as { messages: Array<Record<string, unknown>> }
    const wireAssistant = wireGlm.messages.find((message) => message.role === "assistant")!
    expect(wireAssistant.reasoning_content).toBe("thought")
    expect(wireAssistant.reasoning).toBeUndefined()
    expect(wireAssistant.reasoning_details).toBeUndefined()
    expect(JSON.stringify(wireGlm)).toContain('"reasoning_content":"thought"')
    expect(JSON.stringify(wireGlm)).not.toContain('"reasoning_details"')
    // DeepSeek contract: tool-call turn with empty CoT still carries the field.
    const toolTurn = wireGlm.messages.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
    )!
    expect(toolTurn.reasoning_content).toBe("")
    expect(JSON.stringify(wireGlm)).toContain('"reasoning_content":""')
    // Canonical vendor shape: reasoning_content precedes tool_calls.
    expect(Object.keys(toolTurn)).toEqual(["role", "content", "reasoning_content", "tool_calls"])
    // Tool-call turn with NO reasoning fields at all still gets the empty field.
    const bareTurn = wireGlm.messages.find(
      (message) =>
        message.role === "assistant" &&
        Array.isArray(message.tool_calls) &&
        (message.tool_calls as Array<{ function: { name: string } }>)[0]?.function?.name === "noop2",
    )!
    expect(bareTurn.reasoning_content).toBe("")
    expect(Object.keys(bareTurn)).toEqual(["role", "content", "reasoning_content", "tool_calls"])

    const wireUntouched = JSON.parse(wires.at(-2)!.body) as { messages: Array<Record<string, unknown>> }
    const untouchedAssistant = wireUntouched.messages.find((message) => message.role === "assistant")!
    expect(untouchedAssistant.reasoning).toBe("thought")
    expect(untouchedAssistant.reasoning_content).toBeUndefined()

    const wireFuture = JSON.parse(wires.at(-1)!.body) as { messages: Array<Record<string, unknown>> }
    expect(JSON.stringify(wireFuture)).toContain('"reasoning_content":"thought"')
    expect(JSON.stringify(wireFuture)).not.toContain('"reasoning_details"')
  })

  test("aborted and error terminals still leave a per-response record (T3)", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
    resetCaptureDirs()
    configureLogging(true)
    setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

    // Streaming server whose stream never ends on its own: the consumer aborts.
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })

    const aborted = await wrapFetch(globalThis.fetch)(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"capture-model","stream":true,"messages":[]}',
      gatewayProvider: "capture-provider",
      gatewayModel: "capture-model",
      gatewayProtocol: "http/1.1",
      gatewayStream: true,
    })
    const reader = aborted.body!.getReader()
    await reader.read()
    await reader.cancel("user stop")
    await Bun.sleep(50)

    const abortedFiles = captureFiles("per-response", ".json")
    expect(abortedFiles).toHaveLength(1)
    const abortedEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-response", abortedFiles[0]!), "utf8"),
    ) as { state: string; status: number }
    expect(abortedEntry.state).toBe("aborted")
    expect(abortedEntry.status).toBe(200)
    const abortedRaw = fs.readFileSync(
      path.join(logDir, "per-response", abortedFiles[0]!.replace(/\.json$/, ".raw.txt")),
      "utf8",
    )
    expect(abortedRaw).toContain("partial")

    // S3: h3 5xx — the error body must be on disk even though the rung is
    // abandoned. Only the h3 attempt is stubbed; whatever the h2/h1 rungs do
    // against an h1-only server afterwards, the record is the assertion.
    resetCaptureDirs()
    const realFetch = globalThis.fetch
    const errorBody = '{"error":{"message":"stub upstream failure"}}'
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if ((init as { protocol?: string } | undefined)?.protocol === "http3") {
        return Promise.resolve(new Response(errorBody, { status: 503, headers: { "content-type": "application/json" } }))
      }
      return realFetch(input, init)
    }) as typeof fetch
    try {
      await wrapFetch(realFetch)(server.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"model":"capture-model","stream":true,"messages":[]}',
        gatewayProvider: "capture-provider",
        gatewayModel: "capture-model",
        gatewayProtocol: "h3",
        gatewayStream: true,
      }).then(
        () => undefined,
        () => undefined,
      )
    } finally {
      globalThis.fetch = realFetch
    }
    await Bun.sleep(50)

    const errorFiles = captureFiles("per-response", ".json")
    expect(errorFiles.length).toBeGreaterThanOrEqual(1)
    const errorEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-response", errorFiles[0]!), "utf8"),
    ) as { state: string; status: number; protocol: string }
    expect(errorEntry.state).toBe("error")
    expect(errorEntry.status).toBe(503)
    expect(errorEntry.protocol).toBe("h3")
    const errorRaw = fs.readFileSync(
      path.join(logDir, "per-response", errorFiles[0]!.replace(/\.json$/, ".raw.txt")),
      "utf8",
    )
    expect(errorRaw).toBe(errorBody)
  })

  test("S4: an h3→h2 fallback leaves one raw-wire record per attempt that reached its seam", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
    resetCaptureDirs()
    configureLogging(true)
    setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

    // Real HTTP/2 (h2c) server: the fallback rung must actually SEND, so the
    // second seam record exists for a reason.
    const http2 = await import("node:http2")
    const h2server = http2.createServer()
    h2server.on("stream", (stream) => {
      stream.respond({ ":status": 200, "content-type": "text/event-stream" })
      stream.end('data: {"choices":[{"delta":{"content":"h2-turn"}}]}\n\ndata: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => h2server.listen(0, "127.0.0.1", resolve))
    const address = h2server.address() as { port: number }

    const realFetch = globalThis.fetch
    const selected: string[] = []
    const onSelected = (event: any) => {
      if (event.payload?.type === "gateway.protocol.selected") selected.push(event.payload.properties.protocol)
    }
    GlobalBus.on("event", onSelected)
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if ((init as { protocol?: string } | undefined)?.protocol === "http3") {
        return Promise.reject(new Error("stub: QUIC handshake failed"))
      }
      return realFetch(input, init)
    }) as typeof fetch
    try {
      const response = await wrapFetch(realFetch)(`http://127.0.0.1:${address.port}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "msg_fallback_turn" },
        body: '{"model":"capture-model","stream":true,"messages":[]}',
        gatewayProvider: "capture-provider",
        gatewayModel: "capture-model",
        gatewayProtocol: "h3",
        gatewayStream: true,
      })
      expect(await response.text()).toContain("h2-turn")
    } finally {
      GlobalBus.off("event", onSelected)
      globalThis.fetch = realFetch
      h2server.close()
      const closer = h2server as unknown as { closeAllConnections?: () => void }
      closer.closeAllConnections?.()
    }
    await Bun.sleep(50)

    // Two attempts reached a seam: the h3 hand-off (recorded before the call,
    // so a failed rung still has its record) and the h2 send that answered.
    const wires = captureFiles("raw-wire", ".json").map(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(logDir, "raw-wire", name), "utf8")) as { attempt: number; protocol: string },
    )
    expect(wires.map((wire) => wire.protocol)).toEqual(["h3", "h2"])
    expect(selected).toEqual(["h2"])
    expect(wires.map((wire) => wire.attempt)).toEqual([1, 2])
    const responses = captureFiles("per-response", ".json")
    expect(responses).toHaveLength(1)
    expect(responses[0]).toContain("-attempt2.json")
    const responseEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-response", responses[0]!), "utf8"),
    ) as { state: string; status: number }
    expect(responseEntry.state).toBe("complete")
    expect(responseEntry.status).toBe(200)
  })
})
