import tls from "node:tls"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ prefix: "gateway/probe" })

export interface ProbeResult {
  alpnNegotiated: string
  alpnAdvertised: string[]
  tlsVersion: string
  success: boolean
  error?: string
  latencyMs: number
}

const ALPN_PROTOCOLS = ["h2", "http/1.1"]

export async function probe(baseUrl: string, timeoutMs: number = 5000): Promise<ProbeResult> {
  const start = Date.now()

  try {
    const url = new URL(baseUrl)
    const host = url.hostname
    const port = url.protocol === "https:" ? 443 : 80
    const isHttps = url.protocol === "https:"

    if (!isHttps) {
      return {
        alpnNegotiated: "http/1.1",
        alpnAdvertised: ["http/1.1"],
        tlsVersion: "none",
        success: true,
        latencyMs: Date.now() - start,
      }
    }

    return await new Promise<ProbeResult>((resolve) => {
      const socket = tls.connect({
        host,
        port,
        ALPNProtocols: ALPN_PROTOCOLS,
        servername: host,
        timeout: timeoutMs,
      })

      let resolved = false

      const finish = (result: ProbeResult) => {
        if (resolved) return
        resolved = true
        socket.destroy()
        resolve(result)
      }

      socket.on("secureConnect", () => {
        const alpnProtocol = (socket as any).alpnProtocol as string | undefined
        const alpnAdvertised = (socket as any).alpnProtocol ? ALPN_PROTOCOLS : ["http/1.1"]

        finish({
          alpnNegotiated: alpnProtocol || "http/1.1",
          alpnAdvertised: alpnAdvertised as string[],
          tlsVersion: socket.getProtocol() || "unknown",
          success: true,
          latencyMs: Date.now() - start,
        })
      })

      socket.on("error", (err: Error) => {
        log.debug("ALPN probe failed", { host, error: err.message })
        finish({
          alpnNegotiated: "unknown",
          alpnAdvertised: ALPN_PROTOCOLS,
          tlsVersion: "none",
          success: false,
          error: err.message,
          latencyMs: Date.now() - start,
        })
      })

      socket.on("timeout", () => {
        log.debug("ALPN probe timed out", { host })
        finish({
          alpnNegotiated: "unknown",
          alpnAdvertised: ALPN_PROTOCOLS,
          tlsVersion: "none",
          success: false,
          error: "timeout",
          latencyMs: Date.now() - start,
        })
      })
    })
  } catch (err) {
    return {
      alpnNegotiated: "unknown",
      alpnAdvertised: ALPN_PROTOCOLS,
      tlsVersion: "none",
      success: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    }
  }
}
