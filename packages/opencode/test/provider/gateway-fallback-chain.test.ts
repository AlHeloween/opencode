import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { configureLogging, setDebugConfig, wrapFetch } from "@/provider/gateway/adaptive-client"
import { GlobalBus } from "@/bus/global"

// T65 A7 (T2 RED): full downgrade chain h3→h2→http/1.1 through wrapFetch.
// S4 (adaptive-client.test.ts) pins h3→h2 against an h2c server; NOTHING pins
// the last leg — an h2 rung failure reaching http/1.1. Prediction: stubbed-h3
// reject, h2 fails against the h1-only server, h1 serves 200; wire attempts
// read ["h3","h2","http/1.1"], selected ["http/1.1"], attempts [1,2,3].
// Explicit "h3" (never "auto"): no probe-cache pin, no Store persistence —
// the fixture touches no owner data. Paid inference: zero (local servers).

setDefaultTimeout(20_000)

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gateway-chain-"))
const originalLogDir = process.env.OPENCODE_GATEWAY_LOG_DIR

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

describe("gateway full downgrade chain", () => {
  test("S5: h3-fail → h2-fail → http/1.1 serves; one wire record per seam", async () => {
    process.env.OPENCODE_GATEWAY_LOG_DIR = logDir
    resetCaptureDirs()
    configureLogging(true)
    setDebugConfig({ debug: false, logBodies: false, logResponseBodies: false, perRequest: true })

    // h1-only server: h2 has nothing to handshake with here.
    using server = Bun.serve({
      port: 0,
      async fetch() {
        return new Response("chain-ok", { status: 200, headers: { "content-type": "text/plain" } })
      },
    })

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
      const response = await wrapFetch(realFetch)(server.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "msg_chain_turn" },
        body: '{"model":"capture-model","messages":[]}',
        gatewayProvider: "capture-provider",
        gatewayModel: "capture-model",
        gatewayProtocol: "h3",
        gatewayStream: false,
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("chain-ok")
    } finally {
      GlobalBus.off("event", onSelected)
      globalThis.fetch = realFetch
    }
    await Bun.sleep(50)

    const wires = captureFiles("raw-wire", ".json").map(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(logDir, "raw-wire", name), "utf8")) as {
          attempt: number
          protocol: string
        },
    )
    expect(wires.map((wire) => wire.protocol)).toEqual(["h3", "h2", "http/1.1"])
    expect(wires.map((wire) => wire.attempt)).toEqual([1, 2, 3])
    expect(selected).toEqual(["http/1.1"])
    const responses = captureFiles("per-response", ".json")
    // Failed rungs also leave error records; the SERVED attempt is attempt3.
    expect(responses.length).toBeGreaterThanOrEqual(1)
    const served = responses.filter((name) => name.includes("-attempt3.json"))
    expect(served).toHaveLength(1)
    const responseEntry = JSON.parse(
      fs.readFileSync(path.join(logDir, "per-response", served[0]!), "utf8"),
    ) as { state: string; status: number }
    expect(responseEntry.state).toBe("complete")
    expect(responseEntry.status).toBe(200)
  })
})
