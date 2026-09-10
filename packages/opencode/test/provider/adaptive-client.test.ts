import { afterAll, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { configureLogging, setDebugConfig, wrapFetch } from "@/provider/gateway/adaptive-client"

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gateway-capture-"))
const originalLogDir = process.env.OPENCODE_GATEWAY_LOG_DIR

// Each test owns its capture surface: stale files from a previous test would
// break exact-count assertions (per-request logger is a module singleton and
// writes are async).
function resetCaptureDirs() {
  for (const sub of ["per-request", "per-response"]) {
    fs.rmSync(path.join(logDir, sub), { recursive: true, force: true })
  }
}

afterAll(() => {
  if (originalLogDir === undefined) delete process.env.OPENCODE_GATEWAY_LOG_DIR
  else process.env.OPENCODE_GATEWAY_LOG_DIR = originalLogDir
  fs.rmSync(logDir, { recursive: true, force: true })
})

describe("gateway wire capture", () => {
  test("perRequest captures formatted request and complete streaming responses with diffs", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
    resetCaptureDirs()
    configureLogging(true)
    setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

    let sequence = 0
    using server = Bun.serve({
      port: 0,
      fetch() {
        sequence++
        // OpenAI-shaped SSE chunk: assembleMessage() (per-response capture)
        // folds choices[].delta.content — the fixture must speak the real wire
        // dialect for the assembled message to carry the turn payload.
        return new Response(
          `data: {"id":"${sequence}","choices":[{"delta":{"content":"turn-${sequence}"}}]}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    const request = () => wrapFetch(globalThis.fetch)(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"capture-model","stream":true,"messages":[]}',
      gatewayProvider: "capture-provider",
      gatewayModel: "capture-model",
      gatewayProtocol: "http/1.1",
      gatewayStream: true,
    })

    expect(await (await request()).text()).toContain("turn-1")
    expect(await (await request()).text()).toContain("turn-2")
    await Bun.sleep(25)

    const requests = fs.readdirSync(path.join(logDir, "per-request"))
    expect(requests.filter((name) => name.endsWith(".json"))).toHaveLength(2)
    expect(requests.some((name) => name.includes("unknown"))).toBe(false)
    expect(requests.filter((name) => name.endsWith(".diff"))).toHaveLength(1)

    const requestEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-request", requests.find((name) => name.endsWith(".json"))!), "utf8"),
    ) as { body: { model: string; stream: boolean } }
    expect(requestEntry.body.model).toBe("capture-model")
    // 2026-09-08: formatPerRequestEntry writes the parsed body only (raw
    // one-liner duplicate removed in 5d433565df as a lossless round-trip);
    // the old body_raw assertions predate that refactor and broke on it.
    expect(requestEntry.body.stream).toBe(true)

    const responses = fs.readdirSync(path.join(logDir, "per-response"))
    // 2026-09-08 surface: per-response captures are .json (assembled message)
    // + .raw.txt (literal wire) + .md (human report). The old .diff assertion
    // predates the readable-wire refactor (5d433565df) — diffs became
    // line-based per-request reports; responses carry the literal sidecar.
    expect(responses.filter((name) => name.endsWith(".json"))).toHaveLength(2)
    expect(responses.filter((name) => name.endsWith(".raw.txt"))).toHaveLength(2)
    expect(responses.filter((name) => name.endsWith(".md"))).toHaveLength(2)
    const responseEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-response", responses.find((name) => name.endsWith(".json"))!), "utf8"),
    ) as { message: { content: string } }
    expect(JSON.stringify(responseEntry.message)).toContain("turn-1")
    const rawSidecar = fs.readFileSync(
      path.join(logDir, "per-response", responses.find((name) => name.endsWith(".raw.txt"))!),
      "utf8",
    )
    expect(rawSidecar).toContain("data: [DONE]")
  })

  test("glm/deepseek bodies: dual reasoning dialect rewritten to single native reasoning_content", async () => {
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

    const requests = fs
      .readdirSync(path.join(logDir, "per-request"))
      .filter((name) => name.endsWith(".json"))
      .sort()
    const entry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-request", requests.at(-3)!), "utf8"),
    ) as { body: { messages: Array<Record<string, unknown>> } }
    const assistant = entry.body.messages.find((message) => message.role === "assistant")!
    expect(assistant.reasoning_content).toBe("thought")
    expect(assistant.reasoning).toBeUndefined()
    expect(assistant.reasoning_details).toBeUndefined()
    // Parsed-body form of the same wire facts (body_raw removed 5d433565df).
    expect(JSON.stringify(entry.body)).toContain('"reasoning_content":"thought"')
    expect(JSON.stringify(entry.body)).not.toContain('"reasoning_details"')
    // DeepSeek contract: tool-call turn with empty CoT still carries the field.
    const toolTurn = entry.body.messages.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
    )!
    expect(toolTurn.reasoning_content).toBe("")
    expect(JSON.stringify(entry.body)).toContain('"reasoning_content":""')
    // Canonical vendor shape: reasoning_content precedes tool_calls.
    expect(Object.keys(toolTurn)).toEqual(["role", "content", "reasoning_content", "tool_calls"])
    // Tool-call turn with NO reasoning fields at all still gets the empty field.
    const bareTurn = entry.body.messages.find(
      (message) =>
        message.role === "assistant" &&
        Array.isArray(message.tool_calls) &&
        (message.tool_calls as Array<{ function: { name: string } }>)[0]?.function?.name === "noop2",
    )!
    expect(bareTurn.reasoning_content).toBe("")
    expect(Object.keys(bareTurn)).toEqual(["role", "content", "reasoning_content", "tool_calls"])

    const untouched = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-request", requests.at(-2)!), "utf8"),
    ) as { body: { messages: Array<Record<string, unknown>> } }
    const untouchedAssistant = untouched.body.messages.find((message) => message.role === "assistant")!
    expect(untouchedAssistant.reasoning).toBe("thought")
    expect(untouchedAssistant.reasoning_content).toBeUndefined()

    // requests.at(-1) is the third captured request (sort order is by
    // timestamp prefix); identify the future-zai capture by its model field
    // instead of positional index — order-stable against async write timing.
    const entries = requests.map((name) =>
      JSON.parse(fs.readFileSync(path.join(logDir, "per-request", name), "utf8")) as {
        body: { model?: string; messages?: Array<Record<string, unknown>> }
      },
    )
    const zaiFuture = entries.at(-1)
    expect(JSON.stringify(zaiFuture!.body)).toContain('"reasoning_content":"thought"')
    expect(JSON.stringify(zaiFuture!.body)).not.toContain('"reasoning_details"')
  })
})
