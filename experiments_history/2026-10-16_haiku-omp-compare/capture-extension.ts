import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

// Research-only CLI hook. Its process is disposable; throwing alone is fail-open.
export default function captureExtension(pi: any) {
  const allowedOrigin = process.env.HAIKU_COMPARE_NETWORK_ALLOW_ORIGIN
  if (allowedOrigin) {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any, init: any) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
      if (url.origin !== allowedOrigin) {
        console.error("fixture blocked nonlocal fetch", url.origin)
        process.exit(77)
      }
      return originalFetch(input, init)
    }) as typeof fetch
  }
  pi.on("before_provider_request", (event: any, ctx: any) => {
    try {
      const out = process.env.HAIKU_COMPARE_OUT
      if (!out) throw new Error("HAIKU_COMPARE_OUT is required")
      const body = JSON.stringify(event.payload)
      const record = {
        observedAt: new Date().toISOString(),
        scope: "actual CLI pre-send hook, not transmitted wire",
        model: ctx.model && {
          id: ctx.model.id, provider: ctx.model.provider, api: ctx.model.api,
          baseUrl: ctx.model.baseUrl, maxTokens: ctx.model.maxTokens,
          thinking: ctx.model.thinking,
        },
        bodySha256: createHash("sha256").update(body).digest("hex"),
        bodyBytes: Buffer.byteLength(body),
        payload: event.payload,
      }
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, JSON.stringify(record, null, 2))
      console.error(JSON.stringify({ capture: out, bodyBytes: record.bodyBytes, bodySha256: record.bodySha256 }))
    } catch (error) {
      console.error("capture failure", String(error))
      process.exit(76)
    }
    if (process.env.HAIKU_COMPARE_CAPTURE_STOP !== "0") process.exit(74)
  })
}
