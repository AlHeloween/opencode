// Root-cause probe for the T5 11-session stall: `createSession` returns null past the
// second session, which means `http2.connect()` (or the handler wiring beside it) throws.
// Phase A: six sequential raw connects on one origin.
// Phase B: two sessions each carrying 4 held streams (the pool's exact shape), then connect #3.
// Every step prints; thrown errors print their full text.
import http2 from "node:http2"

const server = http2.createServer({ settings: { maxConcurrentStreams: 4 } })
let serverSessionCount = 0
const held: Array<() => void> = []
server.on("session", (session) => {
  serverSessionCount++
  console.log("server: session #", serverSessionCount)
  session.on("error", (error) => console.log("server: session error", error.message))
})
server.on("stream", (stream) => {
  let released = false
  held.push(() => {
    if (released) return
    released = true
    stream.respond({ ":status": 200, "content-type": "text/plain" })
    stream.end("ok")
  })
  stream.on("error", () => {})
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

const tryConnect = (label: string) => {
  try {
    const session = http2.connect(baseUrl)
    session.on("error", () => {})
    return { label, session }
  } catch (error) {
    console.log(`${label}: THREW ${String(error)}`)
    return { label, session: null }
  }
}

// Phase A: six sequential connects, no streams.
console.log("— phase A: sequential connects —")
for (let i = 1; i <= 6; i++) {
  const { session } = tryConnect(`A${i}`)
  if (!session) continue
  try {
    await new Promise<void>((resolve, reject) => {
      session.once("connect", resolve)
      session.once("error", reject)
      setTimeout(() => reject(new Error("connect timeout")), 2000)
    })
    console.log(`A${i}: connected`)
  } catch (error) {
    console.log(`A${i}: connect failed: ${String(error)}`)
  }
  session.close()
}
await Bun.sleep(200)

// Phase B: two sessions, four held streams each, then connect #3 — the pool's shape.
console.log("— phase B: two busy sessions, then a third connect —")
const busy = [tryConnect("B1"), tryConnect("B2")]
for (const { label, session } of busy) {
  if (!session) continue
  await new Promise<void>((resolve, reject) => {
    session.once("connect", resolve)
    session.once("error", reject)
    setTimeout(() => reject(new Error("connect timeout")), 2000)
  }).catch((error) => console.log(`${label}: connect issue ${String(error)}`))
  let sent = 0
  for (let n = 0; n < 4; n++) {
    try {
      const req = session.request({ ":method": "POST", ":path": "/busy" })
      req.on("error", () => {})
      req.end()
      sent++
    } catch (error) {
      console.log(`${label}: request #${n + 1} THREW ${String(error)}`)
      break
    }
  }
  console.log(`${label}: ${sent} requests sent`)
}
await Bun.sleep(300)
console.log("server sessions so far:", serverSessionCount, "held streams:", held.length)
const third = tryConnect("B3")
console.log("B3 session created:", third.session !== null)
if (third.session) {
  await new Promise<void>((resolve) => {
    third.session!.once("connect", resolve)
    third.session!.once("error", () => resolve())
    setTimeout(resolve, 2000)
  })
  console.log("B3 connected-state:", !third.session.closed)
}

held.forEach((release) => release())
for (const { session } of [...busy, third]) {
  if (session && !session.destroyed) session.destroy()
}
server.close()
await Bun.sleep(200)
console.log("PROBE DONE")
process.exit(0)
