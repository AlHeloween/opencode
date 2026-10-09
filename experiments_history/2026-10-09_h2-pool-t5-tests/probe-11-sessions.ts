// DIAGNOSTIC probe for the 11-session stall of gateway-h2-pool.test.ts (T5):
// instrumented copy of the failing scenario — prints how far the pool grows,
// how many streams reach the server, and which requests settle after release.
import http2 from "node:http2"
import { closeAll, getRemoteMaxConcurrentStreams, getSessionCount, request } from "../../packages/opencode/src/provider/gateway/h2-transport"

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
console.log("warm done: ms", getRemoteMaxConcurrentStreams(baseUrl), "sessions", getSessionCount())

const outcomes: string[] = new Array(41).fill("")
const held = Array.from({ length: 41 }, (_, i) =>
  fire(41).then(
    (response) => {
      outcomes[i] = `ok:${response.status}`
    },
    (error) => {
      outcomes[i] = `rej:${String(error).slice(0, 80)}`
    },
  ),
)

for (let tick = 1; tick <= 24; tick++) {
  await Bun.sleep(250)
  const sids = [...new Set(arrivals.map((a) => a.sid))]
  console.log(
    `grow t=${tick * 250}ms arrivals=${arrivals.length} poolSessions=${getSessionCount()} serverSessions=${serverSessions.length} sids=[${sids.join(",")}]`,
  )
  if (arrivals.length >= 42) break
}
console.log("GROW PHASE DONE: arrivals", arrivals.length, "want 42 | poolSessions", getSessionCount(), "want 11")

arrivals.forEach((a) => a.release())
for (let tick = 1; tick <= 20; tick++) {
  await Bun.sleep(250)
  const settled = outcomes.filter((o) => o !== "").length
  console.log(`settle t=${tick * 250}ms settled=${settled}/41`)
  if (settled === 41) break
}
console.log("UNSETTLED:", outcomes.map((o, i) => (o === "" ? i : null)).filter((i) => i !== null).join(",") || "none")
console.log("outcome sample:", outcomes.slice(0, 6).join(" | "))

console.log("CLEANUP: closeAll, then destroy server sessions")
closeAll()
await Bun.sleep(300)
for (const session of serverSessions) {
  if (!session.destroyed) session.destroy()
}
server.close()
await Bun.sleep(200)
console.log("CLEANUP DONE")
process.exit(0)
