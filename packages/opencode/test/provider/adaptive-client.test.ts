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
})
