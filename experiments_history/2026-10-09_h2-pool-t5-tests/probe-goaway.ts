// Focused re-probe of Q3 for the T5 pool suite: where does the Bun http2 client
// surface a server GOAWAY — as the "goaway" event, or only as session close?
// (Probe 1, run 20261009T002720Z_9e6d1d62, answered Q1+Q2 and mis-ordered this part.)
// Each observation is printed as one line so the suite's claim (d) assertions can quote them.
import http2 from "node:http2"
import { closeAll, getSessionCount, request } from "../../packages/opencode/src/provider/gateway/h2-transport"

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

const waitFor = async (cond: () => boolean, what: string) => {
  const deadline = Date.now() + 3000
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`)
    await Bun.sleep(10)
  }
}

// establish the transport's connection → server session #1
const response = await request({ url: `${baseUrl}/x`, baseUrl, method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
console.log("probe: transport status", response.status, "pool", getSessionCount())

// raw client → after "connect" the server session may register a tick later: wait for it.
const raw = http2.connect(baseUrl)
raw.on("error", () => {})
let rawSawGoaway = false
raw.on("goaway", () => {
  rawSawGoaway = true
})
let rawClosed = false
raw.on("close", () => {
  rawClosed = true
})
await new Promise<void>((resolve) => raw.on("connect", () => resolve()))
await waitFor(() => serverSessions.length === 2, "the raw client's server-side session to register")
serverSessions[1]!.goaway()
await Bun.sleep(300)
console.log("raw client saw goaway event:", rawSawGoaway, "| saw close:", rawClosed, "| server session destroyed:", serverSessions[1]!.destroyed)

// The transport's own connection: GOAWAY only, connection deliberately kept open.
serverSessions[0]!.goaway()
await Bun.sleep(300)
console.log("pool count 300ms after transport-session goaway:", getSessionCount(), "(0 = the client surfaced it)")
console.log("transport server session destroyed:", serverSessions[0]!.destroyed)

raw.destroy()
closeAll()
for (const session of serverSessions) {
  if (!session.destroyed) session.destroy()
}
server.close()
await Bun.sleep(100)
console.log("REPROBE DONE")
process.exit(0)
