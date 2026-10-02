import { afterEach, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Schema } from "effect"
import { requestGrowth, windowState } from "../../src/session/compaction"
import { forecastContext } from "../../src/session/context-forecast"
import { requestPrefixFingerprint, toolCatalogFingerprint } from "../../src/session/llm"
import { jsonSchema, tool } from "ai"
import { MessageV2 } from "../../src/session/message-v2"
import { Session } from "../../src/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import type { Provider } from "../../src/provider/provider"

const model = {
  id: "fixture",
  providerID: "fixture",
  limit: { context: 1_000_000, output: 16_384 },
  capabilities: {},
} as unknown as Provider.Model

setDefaultTimeout(20_000)
afterEach(async () => { await Instance.disposeAll() })

function history(prompts: number[], prefix = "stable", base = 0): MessageV2.WithParts[] {
  return [
    { info: { role: "user", id: "user" }, parts: [{ type: "text", text: "continue" }] },
    {
      info: { role: "assistant", id: "assistant", providerID: model.providerID, modelID: model.id,
        tokens: { input: 999_999, output: 10, reasoning: 0, cache: { read: 999_999, write: 0 } } },
      parts: prompts.map((prompt) => ({
        type: "step-finish", reason: "tool-calls", contextPrefix: prefix,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: base + prompt - 100, write: 0 } },
      })),
    },
  ] as unknown as MessageV2.WithParts[]
}

test("forecast counts model requests, excluding the repeated prefix and aggregated message usage", () => {
  const visible = history([100_000, 109_000, 118_000, 127_000, 136_000, 145_000])
  const state = windowState({ visible, model, cfg: {} })
  expect(state.perTurn).toBeCloseTo(9_000, 0)
  const shifted = windowState({ visible: history([100_000, 109_000, 118_000, 127_000, 136_000, 145_000], "stable", 200_000), model, cfg: {} })
  expect(shifted.perTurn).toBe(state.perTurn)
  // Capacity includes the cached prefix; tempo does not.
  expect(shifted.open - state.open).toBe(200_000)
})

test("cache partition changes cancel, while a changed prefix starts a fresh series", () => {
  const visible = history([100_000, 109_000, 118_000, 127_000, 136_000, 145_000])
  const parts = visible[1].parts as MessageV2.StepFinishPart[]
  parts[2].tokens.input += 50_000
  parts[2].tokens.cache.read -= 50_000
  expect(requestGrowth(visible, model)).toEqual([9_000, 9_000, 9_000, 9_000, 9_000])
  parts[3].contextPrefix = "changed"
  parts[4].contextPrefix = "changed"
  parts[5].contextPrefix = "changed"
  expect(requestGrowth(visible, model)).toEqual([9_000, 9_000])
  expect(windowState({ visible, model, cfg: {} }).forecast.turnsLeft).toBeNull()
})

test("unknown prefix, model change and shrink never train across the boundary", () => {
  const visible = history([100_000, 109_000, 118_000, 127_000, 136_000, 145_000])
  const parts = visible[1].parts as MessageV2.StepFinishPart[]
  delete parts[3].contextPrefix
  expect(requestGrowth(visible, model)).toEqual([9_000])
  expect(requestGrowth(visible, { ...model, id: "other" as never })).toEqual([])
  parts[3].contextPrefix = "stable"
  parts[4].tokens.cache.read = 50_000 - 100
  expect(requestGrowth(visible, model)).toEqual([95_000])
})

test("compact resets the rate even with the same prefix and increasing prompt sizes", () => {
  const before = history([100_000, 109_000, 118_000, 127_000, 136_000, 145_000])
  const star = { info: { role: "user", id: "compact" }, parts: [{ type: "text", text: "=== COMPACTED ===\nstate preserved" }] } as unknown as MessageV2.WithParts
  const after = history([200_000, 201_000, 202_000, 203_000])
  expect(requestGrowth([...before, star, ...after], model)).toEqual([1_000, 1_000, 1_000])
  expect(windowState({ visible: after, model: { ...model, limit: { ...model.limit, context: 0 } }, cfg: {} }).forecast.turnsLeft).toBeNull()
})

test("exponential least squares predicts an independent continuation including its floor", () => {
  const costs = Array.from({ length: 6 }, (_, i) => 4_000 + 16_000 * 0.5 ** i)
  const result = forecastContext(costs, 40_000)
  // Oracle uses the known generating sequence BEYOND the fitted observations.
  let spent = 0
  let expected = 0
  while (spent + 4_000 + 16_000 * 0.5 ** (6 + expected) <= 40_000) {
    spent += 4_000 + 16_000 * 0.5 ** (6 + expected)
    expected++
  }
  expect(result.method).toBe("exponential")
  expect(result.nextTokens).toBeCloseTo(4_250, 0)
  expect(result.turnsLeft).toBe(expected)
})

test("noisy actual-session sequence does not force a decaying forecast", () => {
  const result = forecastContext([9558, 14099, 28515, 12328, 8842, 26404, 12965, 11709, 488], 100_000)
  expect(result.method).toBe("recent")
  expect(result.nextTokens).toBe((26404 + 12965 + 11709 + 488) / 4)
  expect(result.turnsLeft).toBe(7)
})

test("small samples are unknown, and an exponential with no finite crossing reports a bounded lower limit", () => {
  expect(forecastContext([1000, 500, 250], 100_000).turnsLeft).toBeNull()
  expect(forecastContext([0, 0, 0, 0], 100_000).turnsLeft).toBeNull()
  const result = forecastContext([16000, 8000, 4000, 2000, 1000, 500], 100_000)
  expect(result.turnsLeft).toBe(1024)
  expect(result.atLeast).toBe(true)
})

test("wire prefix fingerprint covers system boundaries, tool descriptions, schemas and order", () => {
  const catalog = (description: string, type: "string" | "number" = "string") => ({
    read: tool({ description, inputSchema: jsonSchema({ type: "object", properties: { value: { type } } }) }),
    check: tool({ description: "check", inputSchema: jsonSchema({ type: "object" }) }),
  })
  const tools = catalog("read")
  const hash = toolCatalogFingerprint(tools).hash
  expect(toolCatalogFingerprint(catalog("read")).hash).toBe(hash)
  expect(toolCatalogFingerprint(catalog("new description")).hash).not.toBe(hash)
  expect(toolCatalogFingerprint(catalog("read", "number")).hash).not.toBe(hash)
  expect(toolCatalogFingerprint({ check: tools.check, read: tools.read }).hash).not.toBe(hash)
  expect(requestPrefixFingerprint(["a", "bc"], hash)).not.toBe(requestPrefixFingerprint(["ab", "c"], hash))
  expect(requestPrefixFingerprint(["stable"], hash)).toBe(requestPrefixFingerprint(["stable"], hash))
  // OAuth sends the final instructions, rather than a system message array.
  expect(requestPrefixFingerprint([], hash, "final instructions A"))
    .not.toBe(requestPrefixFingerprint([], hash, "final instructions B"))
  expect(requestPrefixFingerprint([], hash, "same instructions"))
    .toBe(requestPrefixFingerprint([], hash, "same instructions"))
})

test("real session storage and StepFinishPart schema preserve measured prefix and request samples", async () => {
  await Effect.runPromise(Effect.scoped(provideTmpdirInstance((dir) => Effect.gen(function* () {
    const sessions = yield* Session.Service
    const session = yield* sessions.create({})
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    yield* sessions.updateMessage({ id: userID, sessionID: session.id, role: "user", time: { created: 0 },
      agent: "build_mode", model: { providerID: model.providerID, modelID: model.id } })
    yield* sessions.updateMessage({ id: assistantID, sessionID: session.id, parentID: userID, role: "assistant",
      time: { created: 1 }, mode: "build", agent: "build_mode", modelID: model.id, providerID: model.providerID,
      path: { cwd: dir, root: dir }, cost: 0,
      tokens: { input: 999_999, output: 10, reasoning: 0, cache: { read: 999_999, write: 0 } } })
    const steps = history([100_000, 109_000, 118_000, 127_000, 136_000, 145_000])[1].parts as MessageV2.StepFinishPart[]
    for (const step of steps) yield* sessions.updatePart({ ...step, id: PartID.ascending(), sessionID: session.id, messageID: assistantID, cost: 0 })
    const persisted = MessageV2.get({ sessionID: session.id, messageID: assistantID })
    for (const part of persisted.parts) {
      const decoded = Schema.decodeUnknownSync(MessageV2.StepFinishPart)(part)
      expect(decoded.contextPrefix).toBe("stable")
    }
    expect(requestGrowth([persisted], model)).toEqual([9_000, 9_000, 9_000, 9_000, 9_000])
  })).pipe(Effect.provide(Session.defaultLayer), Effect.provide(CrossSpawnSpawner.defaultLayer))))
})
