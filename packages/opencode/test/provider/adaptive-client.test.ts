import { afterAll, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { configureLogging, setDebugConfig, wrapFetch } from "@/provider/gateway/adaptive-client"

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gateway-capture-"))
const originalLogDir = process.env.OPENCODE_GATEWAY_LOG_DIR

afterAll(() => {
  if (originalLogDir === undefined) delete process.env.OPENCODE_GATEWAY_LOG_DIR
  else process.env.OPENCODE_GATEWAY_LOG_DIR = originalLogDir
  fs.rmSync(logDir, { recursive: true, force: true })
})

describe("gateway wire capture", () => {
  test("perRequest captures formatted request and complete streaming responses with diffs", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
    configureLogging(true)
    setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

    let sequence = 0
    using server = Bun.serve({
      port: 0,
      fetch() {
        sequence++
        return new Response(`data: {"id":"${sequence}","content":"turn-${sequence}"}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })
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
    ) as { body: { model: string }; body_raw: string }
    expect(requestEntry.body.model).toBe("capture-model")
    expect(requestEntry.body_raw).toContain('"stream":true')

    const responses = fs.readdirSync(path.join(logDir, "per-response"))
    expect(responses.filter((name) => name.endsWith(".json"))).toHaveLength(2)
    expect(responses.filter((name) => name.endsWith(".diff"))).toHaveLength(1)
    const responseEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-response", responses.find((name) => name.endsWith(".json"))!), "utf8"),
    ) as { body: string[]; body_raw: string }
    expect(responseEntry.body[0]).toContain('"content":"turn-1"')
    expect(responseEntry.body_raw).toContain("data: [DONE]")
  })

  test("glm/deepseek bodies: dual reasoning dialect rewritten to single native reasoning_content", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
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
    ) as { body: { messages: Array<Record<string, unknown>> }; body_raw: string }
    const assistant = entry.body.messages.find((message) => message.role === "assistant")!
    expect(assistant.reasoning_content).toBe("thought")
    expect(assistant.reasoning).toBeUndefined()
    expect(assistant.reasoning_details).toBeUndefined()
    expect(entry.body_raw).toContain('"reasoning_content":"thought"')
    expect(entry.body_raw).not.toContain('"reasoning_details"')
    // DeepSeek contract: tool-call turn with empty CoT still carries the field.
    const toolTurn = entry.body.messages.find(
      (message) => message.role === "assistant" && Array.isArray(message.tool_calls),
    )!
    expect(toolTurn.reasoning_content).toBe("")
    expect(entry.body_raw).toContain('"reasoning_content":""')
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

    const zaiFuture = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-request", requests.at(-1)!), "utf8"),
    ) as { body_raw: string }
    expect(zaiFuture.body_raw).toContain('"reasoning_content":"thought"')
    expect(zaiFuture.body_raw).not.toContain('"reasoning_details"')
  })
})
