// Root-cause probe #3: name the stream error for fires past the first two sessions.
// Same scenario as probe-11-sessions, but every outcome prints response.error.message,
// and the server prints its own session/stream errors.
import http2 from "node:http2"
import { closeAll, getSessionCount, request } from "../../packages/opencode/src/provider/gateway/h2-transport"

const server = http2.createServer({ settings: { maxConcurrentStreams: 4 } })
const arrivals: Array<{ sid: number; release: () => void }> = []
const serverSessions: http2.ServerHttp2Session[] = []
const ids = new Map<http2.ServerHttp2Session, number>()
let serverErrors = 0
server.on("session", (session) => {
  ids.set(session, serverSessions.length + 1)
  serverSessions.push(session)
  session.on("error", (error) => {
    serverErrors++
    console.log("SRV session error:", (error as Error).message)
  })
})
server.on("stream", (stream) => {
  const sid = ids.get(stream.session as http2.ServerHttp2Session) ?? 0
  let released = false
  arrivals.push({
    sid,
    release: () => {
      if (released) return
      released = true
      stream.respond({ ":status": 200, "content-type": "text/plain" })
      stream.end("ok")
    },
  })
  stream.on("error", (error) => {
    console.log("SRV stream error:", (error as Error).message)
  })
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
console.log("server on", baseUrl)

const fire = (limit: number) =>
  request({
    url: `${baseUrl}/x`,
    baseUrl,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    concurrencyLimit: limit,
  })

const warm = fire(41)
while (arrivals.length < 1) await Bun.sleep(5)
arrivals[0]!.release()
await warm
console.log("warm done, sessions", getSessionCount(), "arrivals", arrivals.length)

const started = Date.now()
const outcomes: string[] = new Array(41).fill("pending")
Array.from({ length: 41 }, (_, i) =>
  fire(41).then(
    (response) => {
      outcomes[i] = `t+${Date.now() - started}ms status=${response.status} err=${response.error?.message?.slice(0, 120) ?? "-"}`
    },
    (error) => {
      outcomes[i] = `t+${Date.now() - started}ms REJECTED ${String(error).slice(0, 120)}`
    },
  ),
)
await Bun.sleep(2000)
console.log("arrivals", arrivals.length, "sessions", getSessionCount(), "serverErrors", serverErrors)
outcomes.forEach((outcome, index) => console.log(`  #${index + 1} ${outcome}`))

closeAll()
for (const session of serverSessions) {
  if (!session.destroyed) session.destroy()
}
server.close()
await Bun.sleep(200)
console.log("DIAG3 DONE")
process.exit(0)
