/**
 * MUTATION CHECKS for `packages/opencode/test/provider/gateway-h2-pool.test.ts` (plan T5).
 *
 * The transport source cannot be edited from this task (owner 2026-10-08: test-only), so the
 * mutation is applied to a COPY OF THE TEST'S OBSERVED VALUE instead: every block below repeats
 * one scenario of the suite and asserts a DELIBERATELY WRONG expected value (marked MUTATED).
 *
 * THIS FILE MUST GO FULLY RED. Each red block proves the corresponding suite assertion is
 * fallible; a GREEN block would mean that pin cannot fail and is vacuous. Run:
 *   cmd_runner start --cwd packages/opencode -- bun test ../../experiments/2026-10-09_h2-pool-t5-tests/gateway-h2-pool.mutants.test.ts
 */
import http2 from "node:http2"
import { expect, setDefaultTimeout, test } from "bun:test"
import {
  closeAll,
  getRemoteMaxConcurrentStreams,
  getSessionCount,
  request,
} from "../../packages/opencode/src/provider/gateway/h2-transport"
import type { H2Response } from "../../packages/opencode/src/provider/gateway/h2-transport"
import { modelConcurrencyLimit } from "../../packages/opencode/src/provider/gateway/model-limits"
import { providerPolicy } from "../../packages/opencode/src/provider/gateway/adjustment-store"

setDefaultTimeout(20_000)

const PER_SESSION = 4

interface Arrival {
  serverSessionId: number
  release: () => void
}

interface Loopback {
  baseUrl: string
  arrivals: Arrival[]
  serverSessions: http2.ServerHttp2Session[]
  close: () => Promise<void>
}

async function startLoopback(): Promise<Loopback> {
  const server = http2.createServer({ settings: { maxConcurrentStreams: PER_SESSION } })
  const arrivals: Arrival[] = []
  const serverSessions: http2.ServerHttp2Session[] = []
  const ids = new Map<http2.ServerHttp2Session, number>()
  server.on("session", (session) => {
    ids.set(session, serverSessions.length + 1)
    serverSessions.push(session)
    session.on("error", () => {})
  })
  server.on("stream", (stream) => {
    const serverSessionId = ids.get(stream.session as http2.ServerHttp2Session) ?? 0
    let released = false
    arrivals.push({
      serverSessionId,
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
  return {
    baseUrl,
    arrivals,
    serverSessions,
    close: async () => {
      for (const session of serverSessions) {
        if (!session.destroyed) session.destroy()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(10)
  }
}

async function withPool(
  body: (loop: Loopback, fire: (concurrencyLimit: number) => Promise<H2Response>) => Promise<void>,
): Promise<void> {
  const loop = await startLoopback()
  const inFlight: Array<Promise<H2Response>> = []
  const fire = (concurrencyLimit: number) => {
    const pending = request({
      url: `${loop.baseUrl}/chat/completions`,
      baseUrl: loop.baseUrl,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      concurrencyLimit,
    })
    inFlight.push(pending)
    return pending
  }
  try {
    await body(loop, fire)
  } finally {
    closeAll()
    await loop.close()
    await Promise.allSettled(inFlight)
  }
}

async function warmUp(loop: Loopback, fire: (concurrencyLimit: number) => Promise<H2Response>, limit: number) {
  const warm = fire(limit)
  await waitFor(() => loop.arrivals.length === 1, "the warm-up stream")
  loop.arrivals[0]!.release()
  const response = await warm
  expect(response.status).toBe(200)
  expect(getRemoteMaxConcurrentStreams(loop.baseUrl)).toBe(PER_SESSION)
}

test("MUTANT C2a (must be RED): filled-session count 1 flipped to 2", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 12)
    const fills = [fire(12), fire(12), fire(12), fire(12)]
    await waitFor(() => loop.arrivals.length === 5, "four held streams")
    expect(getSessionCount()).toBe(2) // MUTATED from 1 — the suite pins "no new session while room exists"
    loop.arrivals.forEach((arrival) => arrival.release())
    await Promise.all(fills)
  })
})

test("MUTANT C2b (must be RED): overflow stream's session id 2 flipped to 1", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 12)
    const fills = [fire(12), fire(12), fire(12), fire(12)]
    await waitFor(() => loop.arrivals.length === 5, "four held streams")
    const overflow = fire(12)
    await waitFor(() => loop.arrivals.length === 6, "the overflow stream")
    expect(loop.arrivals[5]!.serverSessionId).toBe(1) // MUTATED from 2 — the suite pins "fresh session dialed when all full"
    loop.arrivals.forEach((arrival) => arrival.release())
    await Promise.all([...fills, overflow])
  })
})

test("MUTANT C1 (must be RED): load-pick probe's session id 2 flipped to 1", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 12)
    const fills = [fire(12), fire(12), fire(12), fire(12)]
    await waitFor(() => loop.arrivals.length === 5, "four held streams")
    const overflow = fire(12)
    await waitFor(() => loop.arrivals.length === 6, "the overflow stream")
    loop.arrivals[1]!.release()
    await fills[0]!
    const probe = fire(12)
    await waitFor(() => loop.arrivals.length === 7, "the probe stream")
    expect(loop.arrivals[6]!.serverSessionId).toBe(1) // MUTATED from 2 — the suite pins least-loaded pick
    loop.arrivals.forEach((arrival) => arrival.release())
    await Promise.all([...fills.slice(1), overflow, probe])
  })
})

test("MUTANT C3 (must be RED): ceil(6/4) session count 2 flipped to 1", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 6)
    const held = Array.from({ length: 8 }, () => fire(6))
    await waitFor(() => loop.arrivals.length === 9, "eight held streams", 8000)
    expect(getSessionCount()).toBe(1) // MUTATED from 2 — the suite pins cap = ceil(limit / per-session)
    loop.arrivals.forEach((arrival) => arrival.release())
    await Promise.all(held)
  })
})

test("MUTANT C4 (must be RED): queued-while-at-cap arrivals 9 flipped to 10", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 6)
    const held = Array.from({ length: 8 }, () => fire(6))
    await waitFor(() => loop.arrivals.length === 9, "eight held streams", 8000)
    fire(6) // must WAIT: all sessions full, at cap
    await Bun.sleep(250)
    expect(loop.arrivals.length).toBe(10) // MUTATED from 9 — the suite pins "never dials beyond the cap"
    loop.arrivals.forEach((arrival) => arrival.release())
    await Promise.all(held)
  })
})

test("MUTANT C5a (must be RED): 11-session pool count flipped to 10", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 41)
    const held: Array<Promise<H2Response>> = []
    let fired = 0
    while (fired < 41) {
      const wave = Math.min(PER_SESSION, 41 - fired)
      for (let n = 0; n < wave; n++) held.push(fire(41))
      fired += wave
      await waitFor(() => loop.arrivals.length === 1 + fired, `${fired} held streams`, 10_000)
      await Bun.sleep(25)
    }
    expect(getSessionCount()).toBe(10) // MUTATED from 11 — the suite pins "warm sessions are never evicted"
    loop.arrivals.forEach((arrival) => arrival.release())
    await Promise.all(held)
  })
})

test("MUTANT C5b (must be RED): reuse stream's session id bound flipped to >= 12", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 41)
    const held: Array<Promise<H2Response>> = []
    let fired = 0
    while (fired < 41) {
      const wave = Math.min(PER_SESSION, 41 - fired)
      for (let n = 0; n < wave; n++) held.push(fire(41))
      fired += wave
      await waitFor(() => loop.arrivals.length === 1 + fired, `${fired} held streams`, 10_000)
      await Bun.sleep(25)
    }
    loop.arrivals.forEach((arrival) => arrival.release())
    await Promise.all(held)
    await Bun.sleep(200)
    const reuse = fire(8)
    await waitFor(() => loop.arrivals.length === 43, "the reuse stream")
    expect(loop.arrivals[42]!.serverSessionId).toBeGreaterThanOrEqual(12) // MUTATED from toBeLessThanOrEqual(11) — the suite pins reuse, not a fresh dial
    loop.arrivals[42]!.release()
    await reuse
  })
})

test("MUTANT C6 (must be RED): pool count after goaway flipped 0 to 1", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 12)
    loop.serverSessions[0]!.goaway()
    await waitFor(() => getSessionCount() === 0, "the goaway'd session to leave the pool", 3000)
    expect(getSessionCount()).toBe(1) // MUTATED from 0 — the suite pins "goaway removes the session"
  })
})

test("MUTANT C7 (must be RED): deepseek-flash ceiling 2500 flipped to 500", () => {
  expect(modelConcurrencyLimit("deepseek", "deepseek-flash")).toBe(500) // MUTATED from 2500
})

test("MUTANT C8 (must be RED): deepseek-v4-pro ceiling 500 flipped to 2500", () => {
  expect(modelConcurrencyLimit("deepseek", "deepseek-v4-pro")).toBe(2500) // MUTATED from 500
})

test("MUTANT C9 (must be RED): unknown-model policy 500 flipped to 2500", () => {
  const key = (model: string) => `provider=deepseek|base=https://example.test|model=${model}|kind=chat|stream=true|shape=default`
  expect(providerPolicy(key("deepseek-reasoner-v9")).maxStreams).toBe(2500) // MUTATED from 500
})
