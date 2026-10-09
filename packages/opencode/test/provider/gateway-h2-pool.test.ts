/**
 * T5 oracles — h2 session pool, `src/provider/gateway/h2-transport.ts`
 * (plan `plans/2026-09-29_h2-session-pool-and-connection-badge.md`, design decisions 1-3).
 *
 * The pool runs against an IN-PROCESS loopback HTTP/2 (h2c) server on 127.0.0.1 —
 * no mocks of the pool: `h2-transport` dials the real server through `http2.connect`,
 * the same shape as `test/provider/adaptive-client.test.ts:434-467`, whose h2 rung
 * already ran against a `node:http2` server under `bun test`. The server advertises
 * `maxConcurrentStreams: 4` and DOES NOT ANSWER until the test releases a stream, so
 * `activeStreams` stays where the test needs it and the pick / cap / queue behaviour
 * is deterministic with small numbers: limit 6 → cap 2, limit 12 → cap 3,
 * limit 41 → cap 11.
 *
 * Harness qualification before this suite was written (probe runs):
 *   `20261009T002720Z_9e6d1d62` — the transport dials the loopback server (200 "ok")
 *     and the pool sees `remoteMaxConcurrentStreams: 4`;
 *   `20261009T002749Z_0ee3da7d` — the Bun client surfaces `goaway` and the pool
 *     drops the session to 0 after a server GOAWAY.
 *
 * ACCOMMODATION, named openly: a FRESH session keeps the 100-stream default
 * (`h2-transport.ts:156`) until the server's SETTINGS frame lands asynchronously
 * (`:159-168`), so a same-tick burst of >4 fires over-subscribes the newest session
 * and the loopback server refuses the excess with RST_STREAM(REFUSED_STREAM) —
 * measured in `20261009T003031Z_7d5d02f3`, `20261009T003348Z_b835d84b`,
 * `20261009T003455Z_b192f9ec` (probes under `experiments/2026-10-09_h2-pool-t5-tests/`).
 * That race lives in the transport, not in the pool contract this suite pins, and the
 * suite therefore fills sessions in WAVES of PER_SESSION with a settle delay between
 * waves: a fresh session is never asked for more streams than the physical per-session
 * limit, and the next wave's pick sees the real budget. The race itself is recorded
 * in the plan's T5 box as an open product residual.
 *
 * Claims pinned (each assertion's expected value is fallible; mutants proving that
 * live in `experiments/2026-10-09_h2-pool-t5-tests/`):
 *   1. the pick is load-based (least `activeStreams`), and a session is dialed only
 *      when EVERY session is full and the pool is under its cap;
 *   2. cap = ceil(concurrencyLimit / remoteMaxConcurrentStreams), adversarially:
 *      at the cap an extra call WAITS — no fresh dial;
 *   3. warm sessions are never evicted on idle — the pool survives past the old
 *      10-session idle threshold and keeps servicing streams;
 *   4. a session that gets goaway/close removes itself and the pool recovers by
 *      dialing a fresh session;
 *   5. model-limits registry: deepseek-flash 2500, deepseek-v4-pro 500, an unknown
 *      model keeps the pre-registry policy.
 */
import http2 from "node:http2"
import { expect, setDefaultTimeout, test } from "bun:test"
import {
  closeAll,
  getRemoteMaxConcurrentStreams,
  getSessionCount,
  isSessionHealthy,
  request,
} from "../../src/provider/gateway/h2-transport"
import type { H2Response } from "../../src/provider/gateway/h2-transport"
import { modelConcurrencyLimit, routeKeyParts } from "../../src/provider/gateway/model-limits"
import { providerPolicy } from "../../src/provider/gateway/adjustment-store"

setDefaultTimeout(20_000)

/** The server's advertised per-session stream budget — the fixture's known state. */
const PER_SESSION = 4

interface Arrival {
  /** Which server-side session carried this stream (1-based, in connect order). */
  serverSessionId: number
  /** Answer the held stream — releases the client-side slot. */
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
    session.on("error", () => {}) // teardown paths (goaway/destroy) must not crash the server
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
    stream.on("error", () => {}) // RST_STREAM(CANCEL) from aborts lands here
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

/**
 * One loopback pool per test: builds fires through the REAL transport, then in
 * `finally` closes the pool, takes the SERVER down (which errors any still-held
 * streams), and only then settles every fired promise — the server teardown is what
 * lets a held stream's request settle at all.
 */
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

/** The warm-up request every capacity test needs: answers once, session 1 stays warm + settings land. */
async function warmUp(loop: Loopback, fire: (concurrencyLimit: number) => Promise<H2Response>, limit: number) {
  const warm = fire(limit)
  await waitFor(() => loop.arrivals.length === 1, "the warm-up stream")
  loop.arrivals[0]!.release()
  const response = await warm
  expect(response.status).toBe(200)
  expect(getRemoteMaxConcurrentStreams(loop.baseUrl)).toBe(PER_SESSION)
}

test("loopback h2c: the transport dials the in-process server and sees its maxConcurrentStreams", async () => {
  await withPool(async (loop, fire) => {
    const first = fire(12)
    await waitFor(() => loop.arrivals.length === 1, "the first stream to reach the loopback server")
    expect(loop.arrivals[0]!.serverSessionId).toBe(1)
    loop.arrivals[0]!.release()
    const response = await first
    expect(response.status).toBe(200)
    expect(response.error).toBeUndefined()
    expect(response.body).toBe("ok")
    expect(getRemoteMaxConcurrentStreams(loop.baseUrl)).toBe(PER_SESSION)
    expect(getSessionCount()).toBe(1)
    expect(isSessionHealthy(loop.baseUrl)).toBe(true)
  })
})

test("a session is dialed only once every existing session is full (pool under its cap)", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 12)

    // Four held streams fill session 1 exactly — while room exists, no new session.
    const fills = [fire(12), fire(12), fire(12), fire(12)]
    await waitFor(() => loop.arrivals.length === 5, "four held streams")
    expect(getSessionCount()).toBe(1)

    // The next call finds every session full and dials session 2 (cap 3 allows it).
    const overflow = fire(12)
    await waitFor(() => loop.arrivals.length === 6, "the overflow stream")
    expect(loop.arrivals[5]!.serverSessionId).toBe(2)
    expect(getSessionCount()).toBe(2)

    loop.arrivals.forEach((arrival) => arrival.release())
    for (const response of await Promise.all([...fills, overflow])) {
      expect(response.status).toBe(200)
    }
    expect(getSessionCount()).toBe(2)
  })
})

test("the pool picks the least-loaded session, not the first one with room", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 12)

    const fills = [fire(12), fire(12), fire(12), fire(12)]
    await waitFor(() => loop.arrivals.length === 5, "four held streams")
    expect(loop.arrivals.slice(1).map((arrival) => arrival.serverSessionId)).toEqual([1, 1, 1, 1])

    const overflow = fire(12)
    await waitFor(() => loop.arrivals.length === 6, "the overflow stream")
    expect(loop.arrivals[5]!.serverSessionId).toBe(2) // second session: all of session 1 was full

    // Free exactly one slot on session 1: loads are now S1=3, S2=1.
    loop.arrivals[1]!.release()
    expect((await fills[0]!).status).toBe(200)

    // The next call must go to session 2 (1 active < 3 active). A "first session
    // with room" pick would choose session 1 — it is first in the pool and has room.
    const probe = fire(12)
    await waitFor(() => loop.arrivals.length === 7, "the probe stream")
    expect(loop.arrivals[6]!.serverSessionId).toBe(2)
    expect(getSessionCount()).toBe(2)

    loop.arrivals.forEach((arrival) => arrival.release())
    for (const response of await Promise.all([...fills.slice(1), overflow, probe])) {
      expect(response.status).toBe(200)
    }
  })
})

test("the cap is ceil(limit / remoteMaxConcurrentStreams) — and at the cap the pool waits, never dials", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 6)

    // ceil(6/4) = 2 sessions. If the cap were floor()=1, the 5th held call would
    // queue forever and fewer than 9 streams could ever arrive.
    const held = Array.from({ length: 8 }, () => fire(6))
    await waitFor(() => loop.arrivals.length === 9, "eight held streams on a two-session cap", 8000)
    expect(getSessionCount()).toBe(2)

    // Both sessions full, open = cap: the 9th call must WAIT — no third dial.
    const queued = fire(6)
    await Bun.sleep(250)
    expect(loop.arrivals.length).toBe(9)
    expect(getSessionCount()).toBe(2)

    // Releasing slots wakes the waiter; it is admitted onto an existing session.
    loop.arrivals.forEach((arrival) => arrival.release())
    await waitFor(() => loop.arrivals.length === 10, "the queued stream to be admitted")
    loop.arrivals[9]!.release()
    for (const response of await Promise.all([...held, queued])) {
      expect(response.status).toBe(200)
    }
    expect(new Set(loop.arrivals.map((arrival) => arrival.serverSessionId))).toEqual(new Set([1, 2]))
    expect(getSessionCount()).toBe(2)
  })
})

test("warm sessions are never evicted: an 11-session pool survives idle and keeps being reused", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 41) // cap = ceil(41/4) = 11

    // 41 concurrently held streams need all 11 sessions — past the old
    // MAX_IDLE_SESSIONS=10 eviction point that no longer exists.
    // Waves of PER_SESSION (see the header accommodation): a fresh session is never
    // asked for more streams than the physical per-session limit, and the settle gap
    // lets its SETTINGS land before the next wave's pick reads its budget.
    const held: Array<Promise<H2Response>> = []
    let fired = 0
    while (fired < 41) {
      const wave = Math.min(PER_SESSION, 41 - fired)
      for (let n = 0; n < wave; n++) held.push(fire(41))
      fired += wave
      await waitFor(() => loop.arrivals.length === 1 + fired, `${fired} held streams`, 10_000)
      await Bun.sleep(25)
    }
    expect(getSessionCount()).toBe(11)
    expect(new Set(loop.arrivals.map((arrival) => arrival.serverSessionId)).size).toBe(11)

    loop.arrivals.forEach((arrival) => arrival.release())
    for (const response of await Promise.all(held)) {
      expect(response.status).toBe(200)
    }
    expect(getSessionCount()).toBe(11)

    // Idle — and still warm: no eviction, no teardown.
    await Bun.sleep(200)
    expect(getSessionCount()).toBe(11)
    expect(isSessionHealthy(loop.baseUrl)).toBe(true)

    // A lower ceiling must not shrink the pool or tear it down; the stream is
    // served by one of the SAME sessions (a fresh dial would be server session 12).
    const reuse = fire(8)
    await waitFor(() => loop.arrivals.length === 43, "the reuse stream")
    expect(loop.arrivals[42]!.serverSessionId).toBeLessThanOrEqual(11)
    loop.arrivals[42]!.release()
    expect((await reuse).status).toBe(200)
    expect(getSessionCount()).toBe(11)
  })
})

test("a session that gets goaway or an abrupt close removes itself; the pool dials fresh", async () => {
  await withPool(async (loop, fire) => {
    await warmUp(loop, fire, 12)

    // Server-side GOAWAY — the client pool must drop the session (probe 20261009T002749Z_0ee3da7d).
    loop.serverSessions[0]!.goaway()
    await waitFor(() => getSessionCount() === 0, "the goaway'd session to leave the pool", 3000)
    expect(isSessionHealthy(loop.baseUrl)).toBe(false)

    // Recovery: the next call dials a fresh session and completes.
    const second = fire(12)
    await waitFor(() => loop.arrivals.length === 2, "the recovery stream")
    expect(loop.arrivals[1]!.serverSessionId).toBe(2)
    loop.arrivals[1]!.release()
    expect((await second).status).toBe(200)
    expect(getSessionCount()).toBe(1)

    // Abrupt close (the error path) is the same contract.
    loop.serverSessions[1]!.destroy()
    await waitFor(() => getSessionCount() === 0, "the destroyed session to leave the pool", 3000)

    const third = fire(12)
    await waitFor(() => loop.arrivals.length === 3, "the second recovery stream")
    expect(loop.arrivals[2]!.serverSessionId).toBe(3)
    loop.arrivals[2]!.release()
    expect((await third).status).toBe(200)
    expect(getSessionCount()).toBe(1)
  })
})

test("model-limits: owner ceilings flow into the policy; unknown models keep the old policy", () => {
  expect(modelConcurrencyLimit("deepseek", "deepseek-flash")).toBe(2500)
  expect(modelConcurrencyLimit("deepseek", "deepseek-v4-pro")).toBe(500)
  expect(modelConcurrencyLimit("deepseek", "deepseek-flash:cloud")).toBe(2500) // suffix normalized before lookup
  expect(modelConcurrencyLimit("deepseek", "deepseek-flash-2")).toBeUndefined()
  expect(modelConcurrencyLimit("openai", "gpt-4o")).toBeUndefined()

  const key = (model: string) => `provider=deepseek|base=https://example.test|model=${model}|kind=chat|stream=true|shape=default`
  expect(providerPolicy(key("deepseek-flash")).maxStreams).toBe(2500)
  expect(providerPolicy(key("deepseek-flash")).maxInflight).toBe(2500)
  expect(providerPolicy(key("deepseek-v4-pro")).maxStreams).toBe(500)

  // No registered ceiling → deepseek's pre-registry policy, untouched.
  expect(providerPolicy(key("deepseek-reasoner-v9")).maxStreams).toBe(500)
  expect(providerPolicy(key("deepseek-reasoner-v9")).maxInflight).toBe(500)

  expect(routeKeyParts(key("deepseek-flash:cloud"))).toEqual({ provider: "deepseek", model: "deepseek-flash:cloud" })
})
