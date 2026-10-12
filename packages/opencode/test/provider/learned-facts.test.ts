import { expect, test, afterEach } from "bun:test"
import { APICallError } from "ai"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { LearnedFacts } from "../../src/provider/learned-facts"
import { stripUnsupportedWireParams, unsupportedWireParams } from "../../src/provider/wire-params"
import { MessageV2 } from "../../src/session/message-v2"
import { TokenCalibration } from "../../src/session/token-calibration"
import { ProviderID } from "../../src/provider/schema"

/**
 * The learned rung of the wire-param gate: a field the provider's own 400 named is
 * recorded ONCE (durable, provider_fact), stripped from the next packaging, and the
 * rejection earns exactly ONE retry — a repeat rejection must not loop.
 *
 * These tests share the compiled SEED with wire-params.test.ts; here the subject is the
 * learned half and the store, under a temp worktree instance (the balance-storage
 * pattern).
 */

afterEach(async () => {
  await Instance.disposeAll()
})

const unknownParamError = () =>
  new APICallError({
    message: 'Bad Request: [unknown_parameter] invalid request body: json: unknown field "repetition_penalty"',
    url: "https://opencode.ai/zen/go/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseHeaders: { "content-type": "application/json" },
    responseBody: JSON.stringify({
      error: { message: '[unknown_parameter] invalid request body: json: unknown field "repetition_penalty"' },
    }),
    isRetryable: false,
  })

test("a rejected field is learned once, then strips from packaging", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(unsupportedWireParams("acme", "glm-next")).toEqual([])
      expect(LearnedFacts.recordUnsupportedParam("acme", "glm-next", "repetition_penalty")).toBe(true)
      expect(LearnedFacts.recordUnsupportedParam("acme", "glm-next", "repetition_penalty")).toBe(false)

      const stripped = stripUnsupportedWireParams(
        { providerID: "acme", api: { id: "glm-next" } },
        { repetition_penalty: 1.1, top_p: 0.95 },
      )
      expect(stripped.repetition_penalty).toBeUndefined()
      expect(stripped.top_p).toBe(0.95)
      expect(unsupportedWireParams("acme", "glm-next")).toEqual(["repetition_penalty"])
    },
  })
})

test("the compiled seed keeps working while the store is unavailable", () => {
  // No Instance context: loadFacts answers empty; the seed still guards the wire.
  // Seed grew 2026-10-12: `thinking` joined after zen/go's strict upstream 400'd
  // it (provider_fact row, measured ~05:25) — pinned into the compiled seed.
  expect(unsupportedWireParams("opencode-go", "glm-5.3-flash")).toEqual(["repetition_penalty", "thinking"])
})

test("fromError learns on the provider's own 400 and retries exactly once", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = MessageV2.fromError(unknownParamError(), {
        providerID: ProviderID.make("opencode-go"),
        modelID: "glm-next",
      }) as MessageV2.APIError
      expect(MessageV2.APIError.isInstance(first)).toBe(true)
      expect(first.data.isRetryable).toBe(true)
      expect(first.data.metadata?.unknownParam).toBe("repetition_penalty")

      // The fact is now known — the next attempt's packaging strips the field.
      expect(
        stripUnsupportedWireParams({ providerID: "opencode-go", api: { id: "glm-next" } }, { repetition_penalty: 1.1 })
          .repetition_penalty,
      ).toBeUndefined()

      // Second rejection of an already-known field: nothing new to learn, no retry loop.
      const again = MessageV2.fromError(unknownParamError(), {
        providerID: ProviderID.make("opencode-go"),
        modelID: "glm-next",
      }) as MessageV2.APIError
      expect(again.data.isRetryable).toBe(false)
    },
  })
})

test("without a model id nothing is learned — the error stays a plain 400", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = MessageV2.fromError(unknownParamError(), { providerID: ProviderID.make("opencode-go") }) as MessageV2.APIError
      expect(MessageV2.APIError.isInstance(result)).toBe(true)
      expect(result.data.isRetryable).toBe(false)
    },
  })
})

test("a provider-stated context limit is durable, not just an in-memory observation", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Distinct key per test — TokenCalibration's map is module-global.
      const model = { providerID: "acme", id: "glm-limit", limit: { context: 1_000_000 } } as never
      TokenCalibration.update(model, { contextLimit: 450_000 })
      expect(TokenCalibration.getObservedLimit(model)).toBe(450_000)
      // The durable half IS the assertion: the row, not the map, is what survives a restart.
      expect(LearnedFacts.loadFacts("acme", "glm-limit").contextLimit).toBe(450_000)
    },
  })
})
