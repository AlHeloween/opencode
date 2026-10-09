// Timeline probe: the pool's own view across the 41-fire burst (2ms sampling),
// with timestamped server session/stream events. Pins whether session #3 ever
// exists and what the pool believes each session's stream budget is.
import http2 from "node:http2"
import { closeAll, getRemoteMaxConcurrentStreams, getSessionCount, request } from "../../packages/opencode/src/provider/gateway/h2-transport"

const t0 = Date.now()
const stamp = () => `t+${Date.now() - t0}ms`

const server = http2.createServer({ settings: { maxConcurrentStreams: 4 } })
const arrivals: Array<{ sid: number; release: () => void }> = []
const serverSessions: http2.ServerHttp2Session[] = []
const ids = new Map<http2.ServerHttp2Session, number>()
server.on("session", (session) => {
  const sid = serverSessions.length + 1
  ids.set(session, sid)
  serverSessions.push(session)
  console.log(`${stamp()} SRV session #${sid} accepted`)
  session.on("error", (error) => console.log(`${stamp()} SRV session #${sid} error: ${(error as Error).message}`))
  session.on("close", () => console.log(`${stamp()} SRV session #${sid} closed`))
})
server.on("stream", (stream) => {
  const sid = ids.get(stream.session as http2.ServerHttp2Session) ?? 0
  console.log(`${stamp()} SRV stream on #${sid} (${arrivals.length + 1}th arrival)`)
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
  stream.on("error", (error) => console.log(`${stamp()} SRV stream on #${sid} error: ${(error as Error).message}`))
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
while (arrivals.length < 1) await Bun.sleep(2)
arrivals[0]!.release()
await warm
console.log(`${stamp()} warm done pool=${getSessionCount()} ms=${getRemoteMaxConcurrentStreams(baseUrl)} arrivals=${arrivals.length}`)

const outcomes: string[] = new Array(41).fill("pending")
Array.from({ length: 41 }, (_, i) =>
  fire(41).then(
    (response) => {
      outcomes[i] = `status=${response.status} err=${response.error?.message?.slice(0, 60) ?? "-"}`
    },
    (error) => {
      outcomes[i] = `REJECTED ${String(error).slice(0, 60)}`
    },
  ),
)
console.log(`${stamp()} fired 41`)

let last = ""
for (let tick = 0; tick < 120; tick++) {
  const view = `pool=${getSessionCount()} ms=${getRemoteMaxConcurrentStreams(baseUrl)} arrivals=${arrivals.length} srvSessions=${serverSessions.length} settled=${outcomes.filter((o) => o !== "pending").length}`
  if (view !== last) {
    console.log(`${stamp()} ${view}`)
    last = view
  }
  await Bun.sleep(5)
}
console.log(`${stamp()} refused=${outcomes.filter((o) => o.includes("REFUSED_STREAM")).length} ok200=${outcomes.filter((o) => o.includes("status=200")).length} pending=${outcomes.filter((o) => o === "pending").length}`)

closeAll()
for (const session of serverSessions) {
  if (!session.destroyed) session.destroy()
}
server.close()
await Bun.sleep(200)
console.log("TIMELINE DONE")
process.exit(0)
