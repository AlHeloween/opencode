// Root-cause probe #2 for the T5 11-session stall: capture the inner error.
// (a) replicate the failing scenario and print EVERY outcome, not a sample;
// (b) at the frozen state (2 sessions full), run createSession's code verbatim as a
//     replica — plain connect and wired connect — printing whatever throws.
import http2 from "node:http2"
import { closeAll, getSessionCount, request } from "../../packages/opencode/src/provider/gateway/h2-transport"

const server = http2.createServer({ settings: { maxConcurrentStreams: 4 } })
const arrivals: Array<{ sid: number; release: () => void }> = []
const serverSessions: http2.ServerHttp2Session[] = []
const ids = new Map<http2.ServerHttp2Session, number>()
server.on("session", (session) => {
  ids.set(session, serverSessions.length + 1)
  serverSessions.push(session)
  session.on("error", () => {})
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
  stream.on("error", () => {})
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

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

const outcomes: string[] = new Array(41).fill("")
Array.from({ length: 41 }, (_, i) =>
  fire(41).then(
    (response) => {
      outcomes[i] = `ok:${response.status}`
    },
    (error) => {
      outcomes[i] = `rej:${String(error instanceof Error ? error.message : error).slice(0, 90)}`
    },
  ),
)
await Bun.sleep(1500)
console.log("arrivals", arrivals.length, "sessions", getSessionCount())
console.log("OUTCOMES:")
outcomes.forEach((outcome, index) => console.log(`  #${index + 1} ${outcome}`))

// (b) the replica of createSession (src/provider/gateway/h2-transport.ts:151-206) — report, never swallow.
function createSessionReplica(url: string, wired: boolean): string {
  try {
    const session = http2.connect(url)
    if (wired) {
      let remoteMaxStreams = 100
      let h2Session: object | null = null
      session.on("remoteSettings", (settings: http2.Settings) => {
        if (settings.maxConcurrentStreams !== undefined) {
          remoteMaxStreams = settings.maxConcurrentStreams
          void h2Session
        }
      })
      session.on("error", () => {})
      session.on("close", () => {})
      session.on("goaway", () => {})
      session.on("ping", () => {})
      h2Session = { remoteMaxStreams }
    }
    return `created (closed=${session.closed})`
  } catch (error) {
    return `THREW ${error instanceof Error ? error.message : String(error)}`
  }
}
console.log("replica plain connect:", createSessionReplica(baseUrl, false))
console.log("replica wired connect:", createSessionReplica(baseUrl, true))

closeAll()
for (const session of serverSessions) {
  if (!session.destroyed) session.destroy()
}
server.close()
await Bun.sleep(200)
console.log("DIAG2 DONE")
process.exit(0)
