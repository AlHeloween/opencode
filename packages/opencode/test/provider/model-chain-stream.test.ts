import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { buildSwitchNote, createFirstTokenWatch, decideStreamError, runChainStream, toChainError } from "@/provider/model-chain/stream-failover"
import type { ChainHealth, ChainMember } from "@/provider/model-chain/chain"
import { memberKey } from "@/provider/model-chain/chain"

setDefaultTimeout(20_000)

const free: ChainMember = { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }
const go: ChainMember = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor", variant: "xhigh" }

function healthOf(): Map<string, ChainHealth> {
  return new Map()
}

/** Fake clock + manual timer queue: no sleeping, ever. */
function fakeTime() {
  let now = 1_000_000
  const timers = new Map<number, { at: number; cb: () => void }>()
  let nextId = 1
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id)
          t.cb()
        }
      }
    },
    schedule: (ms: number, cb: () => void) => {
      const id = nextId++
      timers.set(id, { at: now + ms, cb })
      return () => {
        timers.delete(id)
      }
    },
    pending: () => timers.size,
  }
}

describe("createFirstTokenWatch", () => {
  test("hanging provider with no first token trips the measured threshold", () => {
    const clock = fakeTime()
    let fired = 0
    const watch = createFirstTokenWatch({
      timeoutMs: 120_000,
      now: clock.now,
      schedule: clock.schedule,
      onTimeout: () => {
        fired += 1
      },
    })
    watch.arm()
    clock.advance(119_999)
    expect(fired).toBe(0)
    clock.advance(1)
    expect(fired).toBe(1)
    expect(clock.pending()).toBe(0)
    watch.cancel()
  })
  test("a first token before the threshold disarms the watch", () => {
    const clock = fakeTime()
    let fired = 0
    const watch = createFirstTokenWatch({
      timeoutMs: 120_000,
      now: clock.now,
      schedule: clock.schedule,
      onTimeout: () => {
        fired += 1
      },
    })
    watch.arm()
    clock.advance(37_000)
    watch.notifyToken()
    clock.advance(200_000)
    expect(fired).toBe(0)
    expect(clock.pending()).toBe(0)
  })
  test("cancel silences a hung member without firing", () => {
    const clock = fakeTime()
    let fired = 0
    const watch = createFirstTokenWatch({
      timeoutMs: 120_000,
      now: clock.now,
      schedule: clock.schedule,
      onTimeout: () => {
        fired += 1
      },
    })
    watch.arm()
    watch.cancel()
    clock.advance(500_000)
    expect(fired).toBe(0)
  })
})

describe("decideStreamError", () => {
  test("hang past the threshold marks DOWN and walks to the next UP member", () => {
    const health = healthOf()
    const decision = decideStreamError({
      chain: [free, go],
      health,
      now: () => 0,
      error: { code: "FIRST_TOKEN_TIMEOUT", message: "no first token within 120000ms" },
    })
    expect(decision.action).toBe("next")
    if (decision.action !== "next") throw new Error("unreachable")
    expect(decision.member).toEqual(go)
    expect(health.get(memberKey(free))?.status).toBe("DOWN")
  })
  test("privacy refusal marks DOWN at once and never retries the refusing member", () => {
    const health = healthOf()
    const decision = decideStreamError({
      chain: [go, free],
      health,
      now: () => 0,
      error: { message: "This Go model trains on request data. Allow paid endpoints in Privacy settings" },
    })
    expect(decision.action).toBe("next")
    if (decision.action !== "next") throw new Error("unreachable")
    expect(decision.member).toEqual(free)
    expect(health.get(memberKey(go))?.status).toBe("DOWN")
    expect(decision.attemptsOnFailed).toBe(1)
  })
  test("402 marks DOWN at once with no retry on it", () => {
    const health = healthOf()
    const decision = decideStreamError({
      chain: [free, go],
      health,
      now: () => 0,
      error: { statusCode: 402, message: "Insufficient Balance" },
    })
    expect(decision.action).toBe("next")
    if (decision.action !== "next") throw new Error("unreachable")
    expect(health.get(memberKey(free))?.status).toBe("DOWN")
    expect(decision.attemptsOnFailed).toBe(1)
  })
  test("429-transient retries bounded, then DOWN and next", () => {
    const health = healthOf()
    const decision = decideStreamError({
      chain: [free, go],
      health,
      now: () => 0,
      error: { statusCode: 429, message: "Too Many Requests" },
      attemptsSoFar: 2,
      maxTransientAttempts: 2,
    })
    expect(decision.action).toBe("next")
    if (decision.action !== "next") throw new Error("unreachable")
    expect(decision.member).toEqual(go)
  })
  test("429-transient below the bound stays on the member", () => {
    const health = healthOf()
    const decision = decideStreamError({
      chain: [free, go],
      health,
      now: () => 0,
      error: { statusCode: 429, message: "Too Many Requests" },
      attemptsSoFar: 1,
      maxTransientAttempts: 2,
    })
    expect(decision.action).toBe("retry-member")
    if (decision.action !== "retry-member") throw new Error("unreachable")
    expect(decision.member).toEqual(free)
    expect(health.get(memberKey(free))).toBeUndefined()
  })
  test("exhausted chain errors visibly and never invents", () => {
    const health = healthOf()
    health.set(memberKey(go), { status: "DOWN", downAt: 0, reason: "hang" })
    const decision = decideStreamError({
      chain: [free],
      health,
      now: () => 0,
      error: { statusCode: 402, message: "Insufficient Balance" },
    })
    expect(decision.action).toBe("exhausted")
    if (decision.action !== "exhausted") throw new Error("unreachable")
    expect(decision.tried).toEqual(["opencode/muse-spark-1.3-contributor-free"])
  })
  test("429 with retry-after beyond the floor marks DOWN at once — live t73 2026-10-16", () => {
    const health = healthOf()
    const decision = decideStreamError({
      chain: [free, go],
      health,
      now: () => 0,
      error: { statusCode: 429, message: "Too Many Requests", retryAfterMs: 49_715_000 },
    })
    expect(decision.action).toBe("next")
    if (decision.action !== "next") throw new Error("unreachable")
    expect(decision.member).toEqual(go)
    expect(health.get(memberKey(free))?.status).toBe("DOWN")
    expect(decision.attemptsOnFailed).toBe(1)
  })
})

describe("buildSwitchNote", () => {
  test("names previous, next, reason and kept partial chars", () => {
    const note = buildSwitchNote({
      prevKey: "opencode/muse-spark-1.3-contributor-free",
      nextKey: "opencode-go/muse-spark-1.3-contributor",
      reason: "terminal: FreeUsageLimitError",
      keptChars: 41,
    })
    expect(note).toMatch(/opencode\/muse-spark-1\.3-contributor-free/)
    expect(note).toMatch(/opencode-go\/muse-spark-1\.3-contributor/)
    expect(note).toMatch(/FreeUsageLimitError/)
    expect(note).toMatch(/41 chars kept/)
  })
  test("hang without partial text still names the threshold", () => {
    const note = buildSwitchNote({
      prevKey: "opencode/muse-spark-1.3-contributor-free",
      nextKey: "opencode-go/muse-spark-1.3-contributor",
      reason: "hang past 120000ms",
      keptChars: 0,
    })
    expect(note).toMatch(/hang past 120000ms/)
    expect(note).toMatch(/no partial text/)
  })
})

describe("toChainError", () => {
  test("keeps statusCode and parses retry-after headers off the raw error", () => {
    const raw = Object.assign(new Error('{"type":"error","error":{"type":"FreeUsageLimitError"}}'), {
      statusCode: 429,
      responseHeaders: { "retry-after": "49715" },
    })
    expect(toChainError(raw)).toEqual({
      message: '{"type":"error","error":{"type":"FreeUsageLimitError"}}',
      statusCode: 429,
      retryAfterMs: 49_715_000,
    })
  })
  test("missing headers stay undefined, never a guessed wait", () => {
    expect(toChainError(new Error("boom"))).toEqual({ message: "boom", statusCode: undefined, retryAfterMs: undefined })
  })
})

describe("runChainStream (stream-phase failover)", () => {
  interface StubModel {
    key: string
  }
  const freeModel: StubModel = { key: "opencode/muse-spark-1.3-contributor-free" }
  const goModel: StubModel = { key: "opencode-go/muse-spark-1.3-contributor" }
  const freeError = () =>
    Object.assign(new Error('{"type":"error","error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded"}}'), {
      statusCode: 429,
      responseHeaders: { "retry-after": "49715" },
    })
  function depsOf(health: Map<string, ChainHealth>, seen: { freeCalls: number; scheduled: number[] }) {
    return {
      chain: [free, go],
      initialModel: freeModel,
      memberOf: (model: StubModel) => (model.key === freeModel.key ? free : model.key === goModel.key ? go : undefined),
      modelKey: (model: StubModel) => model.key,
      run: (model: StubModel, _abort: AbortSignal) =>
        Effect.succeed({
          stream: (async function* (): AsyncGenerator<string> {
            if (model.key === freeModel.key) {
              seen.freeCalls += 1
              throw freeError()
            }
            yield "hello from go"
          })(),
        }),
      resolveModel: (member: ChainMember) =>
        Effect.succeed(member === go ? goModel : member === free ? freeModel : undefined),
      health,
      timeoutMs: 120_000,
      now: () => 0,
      schedule: (ms: number, _cb: () => void) => {
        seen.scheduled.push(ms)
        return () => {}
      },
    }
  }
  test("stream-phase 429 + huge retry-after: DOWN in one response, switch with note, no waiting", async () => {
    const health = healthOf()
    const seen = { freeCalls: 0, scheduled: [] as number[] }
    const collected = await Effect.runPromise(Stream.runCollect(runChainStream(depsOf(health, seen))))
    const elements = Array.from(collected)
    expect(seen.freeCalls).toBe(1)
    expect(health.get(memberKey(free))?.status).toBe("DOWN")
    const note = elements.find(
      (element) => typeof element === "object" && element !== null && (element as { type?: string }).type === "chain-switch",
    ) as { prevKey: string; nextKey: string; reason: string } | undefined
    expect(note?.nextKey).toBe(memberKey(go))
    expect(note?.reason).toMatch(/terminal/)
    expect(elements).toContain("hello from go")
    expect(elements.indexOf(note)).toBeLessThan(elements.indexOf("hello from go"))
  })
})
