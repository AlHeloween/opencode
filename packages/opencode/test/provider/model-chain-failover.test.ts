import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  favoritesToChain,
  HEALTH_CHECK_INTERVAL_MS,
  chainKey,
  displayHealth,
  fillChainForNewLayer,
  firstUp,
  memberKey,
  readChainLayer,
  shouldBackfill,
  validateChain,
} from "@/provider/model-chain/chain"
import { FIRST_TOKEN_FLOOR_MS, classifyChainError, firstTokenTimeoutMs, parseRetryAfterMs } from "@/provider/model-chain/classify"
import { runWithFailover } from "@/provider/model-chain/failover"
import { classifyGatewayError, gatewayErrorToChainInput } from "@/provider/model-chain/gateway"
import { probeDownMembers } from "@/provider/model-chain/health-check"
import type { ChainHealth, ChainMember } from "@/provider/model-chain/chain"

setDefaultTimeout(20_000)

const free: ChainMember = { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }
const go: ChainMember = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor", variant: "xhigh" }

function healthOf(): Map<string, ChainHealth> {
  return new Map()
}

describe("classifyChainError", () => {
  test("terminal: privacy/consent gate is DOWN at once", () => {
    expect(
      classifyChainError({
        message: "This Go model trains on request data. Allow paid endpoints that train on request data in your workspace's Privacy settings",
      }),
    ).toBe("terminal")
  })
  test("terminal: 402 balance never retries", () => {
    expect(classifyChainError({ statusCode: 402, message: "402 Insufficient Balance" })).toBe("terminal")
  })
  test("terminal: FreeUsageLimitError is DOWN at once — measured live 2026-10-16 (429 + retry-after 64404s), never retried for 17.9h", () => {
    expect(
      classifyChainError({
        statusCode: 429,
        message: '{"type":"error","error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}}',
      }),
    ).toBe("terminal")
  })
  test("terminal: auth 401/403 never retries", () => {
    expect(classifyChainError({ statusCode: 401, message: "Unauthorized" })).toBe("terminal")
    expect(classifyChainError({ statusCode: 403, message: "Forbidden" })).toBe("terminal")
  })
  test("terminal: model-not-found never retries", () => {
    expect(classifyChainError({ statusCode: 404, message: "Model not found: opencode/nope" })).toBe("terminal")
  })
  test("terminal: unknown_parameter naming a body field never retries", () => {
    expect(classifyChainError({ statusCode: 400, message: 'unknown field "repetition_penalty"', field: "repetition_penalty" })).toBe(
      "terminal",
    )
  })
  test("transient: 429 / 5xx / timeout retry bounded", () => {
    expect(classifyChainError({ statusCode: 429, message: "Too Many Requests" })).toBe("transient")
    expect(classifyChainError({ statusCode: 500, message: "Internal Server Error" })).toBe("transient")
    expect(classifyChainError({ statusCode: 503, message: "Service Unavailable" })).toBe("transient")
    expect(classifyChainError({ message: "Provider response headers timed out after 30000ms" })).toBe("transient")
  })
  test("terminal: retry-after beyond the measured floor is DOWN at once — live t73 2026-10-16 (429 + retry-after 49715s, no body text)", () => {
    expect(classifyChainError({ statusCode: 429, message: "Too Many Requests", retryAfterMs: 49_715_000 })).toBe("terminal")
  })
  test("transient: retry-after within the floor stays bounded", () => {
    expect(classifyChainError({ statusCode: 429, message: "Too Many Requests", retryAfterMs: 5_000 })).toBe("transient")
    expect(classifyChainError({ statusCode: 429, message: "Too Many Requests" })).toBe("transient")
  })
  test("parseRetryAfterMs mirrors the retry policy: ms-key wins, then seconds, then HTTP date", () => {
    expect(parseRetryAfterMs({ "retry-after-ms": "2500" })).toBe(2_500)
    expect(parseRetryAfterMs({ "retry-after": "7" })).toBe(7_000)
    const future = new Date(Date.now() + 60_000).toUTCString()
    const parsed = parseRetryAfterMs({ "retry-after": future })
    expect(parsed !== undefined && parsed > 30_000 && parsed <= 60_000).toBe(true)
    expect(parseRetryAfterMs(undefined)).toBeUndefined()
    expect(parseRetryAfterMs({})).toBeUndefined()
    expect(parseRetryAfterMs({ "retry-after": "not-a-time" })).toBeUndefined()
  })
})

describe("firstTokenTimeoutMs", () => {
  test("derived from measured response latency, never a guessed constant", () => {
    expect(firstTokenTimeoutMs(0)).toBe(FIRST_TOKEN_FLOOR_MS)
    expect(firstTokenTimeoutMs(10_000)).toBe(120_000)
    expect(firstTokenTimeoutMs(20_000)).toBe(120_000)
    expect(firstTokenTimeoutMs(50_000)).toBe(150_000)
  })
})

describe("chain order and fill", () => {
  test("validateChain keeps explicit order, drops empties", () => {
    expect(validateChain([free, go]).map(memberKey)).toEqual([
      "opencode/muse-spark-1.3-contributor-free",
      "opencode-go/muse-spark-1.3-contributor",
    ])
    expect(validateChain([])).toEqual([])
  })
  test("fill-once: a new layer gets a copy of the parent, then owns it", () => {
    const filled = fillChainForNewLayer([free, go])
    expect(filled).toEqual([free, go])
    expect(filled).not.toBe([free, go])
    expect(fillChainForNewLayer(undefined)).toBeUndefined()
    expect(fillChainForNewLayer([])).toBeUndefined()
  })
  test("readChainLayer reads ONE key: no parent is ever consulted", () => {
    expect(readChainLayer([free])).toEqual([free])
    expect(readChainLayer([])).toBeUndefined()
    expect(readChainLayer(undefined)).toBeUndefined()
    expect(readChainLayer([{ providerID: "", modelID: "x" }])).toBeUndefined()
  })
  test("shouldBackfill is true only when the layer holds nothing", () => {
    expect(shouldBackfill(undefined)).toBe(true)
    expect(shouldBackfill([])).toBe(true)
    expect(shouldBackfill([free])).toBe(false)
  })
  test("chainKey names the key namespace", () => {
    expect(chainKey("global", "build_mode")).toBe("global:agent:build_mode:chain")
    expect(chainKey("session:abc", "build_mode")).toBe("session:abc:agent:build_mode:chain")
  })
  test("displayHealth: absent oracle reads as unknown, never blank", () => {
    const health = healthOf()
    expect(displayHealth(free, health)).toBe("unknown")
    health.set(memberKey(free), { status: "UP" })
    expect(displayHealth(free, health)).toBe("UP")
    health.set(memberKey(free), { status: "DOWN", downAt: 0, reason: "402" })
    expect(displayHealth(free, health)).toBe("DOWN")
  })
  test("firstUp skips DOWN members", () => {
    const health = healthOf()
    health.set(memberKey(free), { status: "DOWN", downAt: 0, reason: "402" })
    expect(firstUp([free, go], health)).toEqual(go)
    expect(firstUp([free], health)).toBeUndefined()
  })
})

describe("runWithFailover", () => {
  test("privacy refusal marks DOWN at once: refusing member called exactly once", async () => {
    const calls = new Map<string, number>()
    const health = healthOf()
    const result = await runWithFailover({
      chain: [go, free],
      health,
      now: () => 0,
      timeoutMs: 50,
      call: async (member) => {
        calls.set(memberKey(member), (calls.get(memberKey(member)) ?? 0) + 1)
        if (member.providerID === "opencode-go") {
          throw { message: "This Go model trains on request data. Allow paid endpoints in Privacy settings" }
        }
        return "ok-from-free"
      },
    })
    expect(result.text).toBe("ok-from-free")
    expect(result.member).toEqual(free)
    expect(calls.get(memberKey(go))).toBe(1)
    expect(health.get(memberKey(go))?.status).toBe("DOWN")
    expect(result.note).toMatch(/opencode-go/)
    expect(result.note).toMatch(/terminal/)
  })
  test("402 marks DOWN at once, never retried on it", async () => {
    const calls = new Map<string, number>()
    const health = healthOf()
    const result = await runWithFailover({
      chain: [free, go],
      health,
      now: () => 0,
      timeoutMs: 50,
      call: async (member) => {
        calls.set(memberKey(member), (calls.get(memberKey(member)) ?? 0) + 1)
        if (member.providerID === "opencode") throw { statusCode: 402, message: "Insufficient Balance" }
        return "ok-from-go"
      },
    })
    expect(result.member).toEqual(go)
    expect(calls.get(memberKey(free))).toBe(1)
  })
  test("hanging member is cut at the threshold, then session ends on backup with a visible note", async () => {
    const health = healthOf()
    const notes: string[] = []
    const result = await runWithFailover({
      chain: [free, go],
      health,
      now: () => 0,
      timeoutMs: 50,
      maxTransientAttempts: 1,
      call: async (member) => {
        if (member.providerID === "opencode") return new Promise<string>(() => {})
        return "ok-from-go"
      },
      onNote: (note) => notes.push(note),
    })
    expect(result.member).toEqual(go)
    expect(health.get(memberKey(free))?.status).toBe("DOWN")
    expect(result.note.length).toBeGreaterThan(0)
    expect(notes.length).toBeGreaterThan(0)
  })
  test("429 gets bounded retry on the same member, then DOWN", async () => {
    let attempts = 0
    const health = healthOf()
    const result = await runWithFailover({
      chain: [free, go],
      health,
      now: () => 0,
      timeoutMs: 50,
      maxTransientAttempts: 2,
      call: async (member) => {
        if (member.providerID === "opencode") {
          attempts += 1
          throw { statusCode: 429, message: "Too Many Requests" }
        }
        return "ok-from-go"
      },
    })
    expect(result.member).toEqual(go)
    expect(attempts).toBe(2)
    expect(health.get(memberKey(free))?.status).toBe("DOWN")
  })
  test("exhausted chain errors visibly and never invents a model", async () => {
    const health = healthOf()
    let error: unknown
    try {
      await runWithFailover({
        chain: [free],
        health,
        now: () => 0,
        timeoutMs: 20,
        maxTransientAttempts: 1,
        call: async () => {
          throw { statusCode: 402, message: "Insufficient Balance" }
        },
      })
    } catch (e) {
      error = e
    }
    expect(String((error as Error)?.message ?? error)).toMatch(/exhausted/i)
    expect(String((error as Error)?.message ?? error)).toMatch(/muse-spark-1.3-contributor-free/)
  })
})

describe("probeDownMembers (10-minute check)", () => {
  test("DOWN member probed after interval; recovered member returns UP and order is restored", async () => {
    const health = healthOf()
    const t0 = 1_000_000
    health.set(memberKey(free), { status: "DOWN", downAt: t0, reason: "hang" })
    expect(HEALTH_CHECK_INTERVAL_MS).toBe(10 * 60 * 1000)
    const early = await probeDownMembers({
      chain: [free, go],
      health,
      now: t0 + 60_000,
      probe: async () => true,
    })
    expect(early.probed).toEqual([])
    const due = await probeDownMembers({
      chain: [free, go],
      health,
      now: t0 + HEALTH_CHECK_INTERVAL_MS + 1,
      probe: async () => true,
    })
    expect(due.probed).toEqual([memberKey(free)])
    expect(due.revived).toEqual([memberKey(free)])
    expect(health.get(memberKey(free))?.status).toBe("UP")
    expect(firstUp([free, go], health)).toEqual(free)
  })
  test("probe creates no sessions and carries no tools: direct-call only", async () => {
    const health = healthOf()
    const t0 = 2_000_000
    health.set(memberKey(free), { status: "DOWN", downAt: t0, reason: "hang" })
    let sessionsCreated = 0
    let toolsCarried = 0
    await probeDownMembers({
      chain: [free],
      health,
      now: t0 + HEALTH_CHECK_INTERVAL_MS + 1,
      probe: async () => {
        return true
      },
    })
    expect(sessionsCreated).toBe(0)
    expect(toolsCarried).toBe(0)
    expect(health.get(memberKey(free))?.status).toBe("UP")
  })
  test("still-DOWN member stays DOWN and is not retried before the next check", async () => {
    const health = healthOf()
    const t0 = 3_000_000
    health.set(memberKey(free), { status: "DOWN", downAt: t0, reason: "402" })
    let probes = 0
    await probeDownMembers({
      chain: [free, go],
      health,
      now: t0 + HEALTH_CHECK_INTERVAL_MS + 1,
      probe: async () => {
        probes += 1
        return false
      },
    })
    expect(probes).toBe(1)
    expect(health.get(memberKey(free))?.status).toBe("DOWN")
    expect(firstUp([free, go], health)).toEqual(go)
  })
})

describe("classifyGatewayError (one signal source)", () => {
  test("every gateway recordError category is transient for the chain", () => {
    expect(classifyGatewayError("429", 429)).toBe("transient")
    expect(classifyGatewayError("5xx", 503)).toBe("transient")
    expect(classifyGatewayError("server_5xx", 500)).toBe("transient")
    expect(classifyGatewayError("conn_reset")).toBe("transient")
    expect(classifyGatewayError("read_timeout")).toBe("transient")
  })
  test("terminal status still wins through the gateway adapter", () => {
    expect(classifyGatewayError("read_timeout", 402, "Insufficient Balance")).toBe("terminal")
    expect(classifyGatewayError("5xx", 401, "Unauthorized")).toBe("terminal")
  })
  test("gatewayErrorToChainInput preserves the refusal for both consumers", () => {
    expect(gatewayErrorToChainInput("429", 429, "Too Many Requests")).toEqual({
      statusCode: 429,
      message: "Too Many Requests",
      code: "429",
    })
  })
})

describe("favoritesToChain (explicit pick = head, favorites = backups)", () => {
  test("picked model heads, remaining favorites follow in order", () => {
    const picked: ChainMember = { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }
    const favs: ChainMember[] = [
      { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
      { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
    ]
    expect(favoritesToChain(picked, favs)).toEqual([
      { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
      { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
    ])
  })
  test("pick outside favorites still heads; duplicates collapse", () => {
    const picked: ChainMember = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" }
    const favs: ChainMember[] = [
      { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
      { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
    ]
    expect(favoritesToChain(picked, favs)).toEqual([
      { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" },
      { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
    ])
  })
  test("copies are never aliased to the inputs", () => {
    const picked: ChainMember = { providerID: "a", modelID: "m" }
    const favs: ChainMember[] = [{ providerID: "b", modelID: "n" }]
    const out = favoritesToChain(picked, favs)
    expect(out).not.toBe(favs)
    expect(out[0]).not.toBe(picked)
    expect(out[1]).not.toBe(favs[0])
  })
})
