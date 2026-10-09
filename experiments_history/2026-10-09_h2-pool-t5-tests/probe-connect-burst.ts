// Boundary probe for the T5 harness: same-tick connect bursts to an in-process
// loopback http2 server — default listen vs an explicit backlog.
// Decides whether the test harness adds `backlog` or staggers session creation.
import http2 from "node:http2"

const burst = async (label: string, count: number, listen: (server: http2.Http2Server) => Promise<void>) => {
  const server = http2.createServer({ settings: { maxConcurrentStreams: 4 } })
  let accepted = 0
  server.on("session", (session) => {
    accepted++
    session.on("error", () => {})
  })
  server.on("stream", (stream) => {
    stream.respond({ ":status": 200 })
    stream.end("ok")
    stream.on("error", () => {})
  })
  await listen(server)
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  let connected = 0
  let refused = 0
  let other = 0
  const sessions: http2.ClientHttp2Session[] = []
  for (let i = 0; i < count; i++) {
    try {
      const session = http2.connect(baseUrl)
      sessions.push(session)
      session.on("error", (error) => {
        if (String((error as Error).message ?? error).includes("ECONNREFUSED")) refused++
        else other++
      })
    } catch (error) {
      if (String(error).includes("ECONNREFUSED")) refused++
      else other++
    }
  }
  await Promise.all(
    sessions.map(
      (session) =>
        new Promise<void>((resolve) => {
          session.on("connect", () => {
            connected++
            resolve()
          })
          session.on("error", () => resolve())
          setTimeout(resolve, 2000)
        }),
    ),
  )
  console.log(`${label} burst=${count}: connected=${connected} refused=${refused} otherErrors=${other} serverAccepted=${accepted}`)
  sessions.forEach((session) => session.destroy())
  server.close()
  await Bun.sleep(300)
}

await burst("default-listen", 10, (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve())))
await burst("default-listen", 30, (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve())))
await burst("backlog=511", 30, (server) => new Promise((resolve) => server.listen({ port: 0, host: "127.0.0.1", backlog: 511 }, () => resolve())))
console.log("BURST PROBE DONE")
process.exit(0)
