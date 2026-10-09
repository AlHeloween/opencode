// Qualification probe for the T5 pool suite (plan 2026-09-29_h2-session-pool-and-connection-badge).
// Three questions, each printed as one line — the suite may only be written on the answers:
//   Q1 does a Bun `node:http2` server honour `settings.maxConcurrentStreams` (client sees 4)?
//   Q2 does `h2-transport.request()` dial an in-process h2c server on 127.0.0.1?
//   Q3 does the Bun http2 client emit "goaway", and does `ServerHttp2Session.goaway()` exist?
// Run: cmd_runner start --cwd packages/opencode -- bun run ../../experiments/2026-10-09_h2-pool-t5-tests/probe-loopback.ts
import http2 from "node:http2"
import {
  closeAll,
  getRemoteMaxConcurrentStreams,
  getSessionCount,
  request,
} from "../../packages/opencode/src/provider/gateway/h2-transport"

const server = http2.createServer({ settings: { maxConcurrentStreams: 4 } })
const serverSessions: http2.ServerHttp2Session[] = []
server.on("session", (session) => {
  serverSessions.push(session)
  session.on("error", () => {})
})
server.on("stream", (stream) => {
  stream.respond({ ":status": 200, "content-type": "text/plain" })
  stream.end("ok")
  stream.on("error", () => {})
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

// Q2 — the transport dials the loopback server and completes a request.
const response = await request({
  url: `${baseUrl}/qualify`,
  baseUrl,
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
})
console.log("Q2 transport request:", JSON.stringify({ status: response.status, body: response.body, error: response.error?.message ?? null }))

// Q1 — the advertised settings reached the pool.
await Bun.sleep(100)
console.log("Q1 remoteMaxConcurrentStreams:", getRemoteMaxConcurrentStreams(baseUrl), "(want 4)")
console.log("Q1 pool sessions:", getSessionCount(), "(want 1)")

// Q3 — goaway: a raw client observes the event; the transport pool drops the session.
const raw = http2.connect(baseUrl)
const rawSession = serverSessions[serverSessions.length - 1]!
raw.on("error", () => {})
let rawSawGoaway = false
raw.on("goaway", () => {
  rawSawGoaway = true
})
await new Promise<void>((resolve) => raw.on("connect", () => resolve()))
console.log("Q3 ServerHttp2Session.goaway is", typeof rawSession.goaway)
rawSession.goaway()
await Bun.sleep(200)
console.log("Q3 raw client saw goaway event:", rawSawGoaway)
serverSessions[0]!.goaway()
await Bun.sleep(200)
console.log("Q3 pool count after transport session goaway:", getSessionCount(), "(want 0)")

raw.destroy()
closeAll()
for (const session of serverSessions) {
  if (!session.destroyed) session.destroy()
}
server.close()
await Bun.sleep(100)
console.log("PROBE DONE")
process.exit(0)
