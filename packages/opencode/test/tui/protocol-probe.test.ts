import { describe, expect, test } from "bun:test"
import { probeProtocol, protocolNeedsProbe } from "../../src/cli/cmd/tui/component/protocol-probe"

/**
 * Owner directive 2026-09-29: «если выбрано авто то протокол должен 1 раз пробаться и
 * фиксироваться, простым запросом». The probe runs ONCE at selection time; these cases pin
 * the rung decision and the request shape (h3 first, then the plain path) without a network.
 */
describe("protocol probe", () => {
  test("h3 answering pins h3 — one request, protocol http3", async () => {
    const calls: Array<{ url: string; protocol?: string }> = []
    const result = await probeProtocol({
      url: "https://example.test/api",
      fetchImpl: async (url, init) => {
        calls.push({ url, protocol: init?.protocol })
        return { ok: true }
      },
    })
    expect(result).toBe("h3")
    expect(calls).toEqual([{ url: "https://example.test/api", protocol: "http3" }])
  })

  test("h3 handshake failure falls to the plain path — result h2", async () => {
    const calls: string[] = []
    const result = await probeProtocol({
      url: "https://example.test/api",
      fetchImpl: async (_url, init) => {
        calls.push(init?.protocol ?? "plain")
        if (init?.protocol === "http3") throw new TypeError("HTTP3HandshakeFailed")
        return {}
      },
    })
    expect(result).toBe("h2")
    expect(calls).toEqual(["http3", "plain"])
  })

  test("both rungs dead → undefined (nothing is written)", async () => {
    const result = await probeProtocol({
      url: "https://example.test/api",
      fetchImpl: async () => {
        throw new Error("no route to host")
      },
    })
    expect(result).toBeUndefined()
  })

  test("protocolNeedsProbe: only unset or explicit auto", () => {
    expect(protocolNeedsProbe(undefined)).toBe(true)
    expect(protocolNeedsProbe(null)).toBe(true)
    expect(protocolNeedsProbe("auto")).toBe(true)
    expect(protocolNeedsProbe("h3")).toBe(false)
    expect(protocolNeedsProbe("h2")).toBe(false)
    expect(protocolNeedsProbe("http/1.1")).toBe(false)
  })
})
