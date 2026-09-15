// Smoke: gateway transports send headers VERBATIM (2026-09-07 user directive:
// "мы не должны резать хидеры вообще") + correlation IDs exist for all providers.
// Usage: bun run experiments/2026-09-07_go-session-smoke/wire-probe.mjs

import * as H1 from "../../packages/opencode/src/provider/gateway/h1-transport.ts"
import { responseCacheHeaders } from "../../packages/opencode/src/provider/response-cache.ts"

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

// ── Part 1: live wire probe — verbatim passthrough over HTTP/1.1 ──
let received
using server = Bun.serve({
  port: 0,
  fetch(req) {
    received = Object.fromEntries(req.headers.entries())
    return new Response("ok")
  },
})

await H1.request({
  url: server.url.toString(),
  method: "POST",
  headers: {
    "x-opencode-session": "ses_smoke_probe",
    "x-opencode-request": "msg_smoke_probe",
    "x-opencode-project": "proj_smoke",
    "x-opencode-client": "tui",
    "x-request-id": "req_smoke_probe",
    "x-session-id": "ses_smoke_probe",
    "x-opencode-oauth-token": "secret-still-arrives",
    authorization: "Bearer smoke",
    "user-agent": "opencode/smoke",
  },
})

check("wire: x-opencode-session present", received["x-opencode-session"] === "ses_smoke_probe", JSON.stringify(received))
check("wire: x-opencode-request present", received["x-opencode-request"] === "msg_smoke_probe")
check("wire: x-request-id present (fills Novita Request ID)", received["x-request-id"] === "req_smoke_probe")
check("wire: x-session-id present (fills Novita Session ID)", received["x-session-id"] === "ses_smoke_probe")
check("wire: oauth token arrives verbatim (no cutting)", received["x-opencode-oauth-token"] === "secret-still-arrives")
check("wire: authorization kept", received["authorization"] === "Bearer smoke")

// ── Part 2: response-cache opt-in sanity (unchanged) ──
check("cache: opencode-go never cached", Object.keys(responseCacheHeaders("opencode-go", { responseCache: true })).length === 0)
check("cache: openrouter opt-in", responseCacheHeaders("openrouter", { responseCache: true })["X-OpenRouter-Cache"] === "true")

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
