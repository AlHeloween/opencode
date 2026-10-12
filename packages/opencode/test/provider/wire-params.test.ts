import { expect, test } from "bun:test"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { stripUnsupportedWireParams } from "../../src/provider/wire-params"

/**
 * The wire-param gate exists because acceptance is NOT advertised: an
 * OpenAI-compatible endpoint publishes no request schema (measured 2026-10-12:
 * Zen Go docs declare no per-model parameters), so a rejected field is learned
 * by DESCENT — the provider names it (`[unknown_parameter] json: unknown field
 * "repetition_penalty"`) — and recorded once, like a transport rung.
 *
 * The measured case these tests pin: opencode-go/glm-5.3-flash 400s on a body
 * carrying `repetition_penalty` (raw-wire capture 2026-10-12T04-30-16Z), while
 * opencode-go/mimo-v2.6-flash finished 11 turns with the same field — the
 * rejection is per MODEL, so the control cases matter as much as the subject.
 */

const createModel = (providerID: string, modelID: string): Provider.Model => ({
  id: ModelID.zod.parse(`${providerID}/${modelID}`),
  providerID: ProviderID.zod.parse(providerID),
  api: {
    id: modelID,
    url: "https://opencode.ai/zen/go/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  },
  limit: { context: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-08-26",
})

test("glm-5.3-flash on opencode-go drops repetition_penalty at packaging", () => {
  const packaged = ProviderTransform.providerOptions(createModel("opencode-go", "glm-5.3-flash"), {
    repetition_penalty: 1.1,
    thinking: { type: "enabled" },
    top_p: 0.95,
    prompt_cache_key: "ses_x:glm-5.3-flash",
  })
  expect(packaged["opencode-go"].repetition_penalty).toBeUndefined()
  // thinking joined the measured-rejected set 2026-10-12 (zen/go strict upstream
  // 400'd it; provider_fact row + seed) — the gate MUST strip it now. The old
  // assertion used it as the untouched control; the control moved to top_p.
  expect(packaged["opencode-go"].thinking).toBeUndefined()
  // the rest of the body is untouched — the gate is a strip, not a filter
  expect(packaged["opencode-go"].top_p).toBe(0.95)
  expect(packaged["opencode-go"].prompt_cache_key).toBe("ses_x:glm-5.3-flash")
})

test("a model that accepts the field keeps it (mimo-v2.6-flash, same provider)", () => {
  const packaged = ProviderTransform.providerOptions(createModel("opencode-go", "mimo-v2.6-flash"), {
    repetition_penalty: 1.1,
  })
  expect(packaged["opencode-go"].repetition_penalty).toBe(1.1)
})

test("a variant suffix does not dodge the gate", () => {
  const stripped = stripUnsupportedWireParams(createModel("opencode-go", "glm-5.3-flash:max"), {
    repetition_penalty: 1.1,
    top_p: 0.95,
  })
  expect(stripped.repetition_penalty).toBeUndefined()
  expect(stripped.top_p).toBe(0.95)
})

test("an unrecorded pair is untouched — no probing, no over-stripping", () => {
  const stripped = stripUnsupportedWireParams(createModel("deepseek", "deepseek-flash"), {
    repetition_penalty: 1.1,
  })
  expect(stripped.repetition_penalty).toBe(1.1)
})

/**
 * Transport controls are OUR knobs, never wire parameters: the gateway fetch
 * reads `model.options.protocol` / `model.options.streaming` directly
 * (provider.ts gatewayProtocol/gatewayStreaming), and no upstream accepts them
 * as body fields — zen/go answered 400 [unknown_parameter] on "protocol"
 * (measured 2026-10-12, payload dump 141041.594). The @ai-sdk openai-compatible
 * model spreads unknown providerOptions keys into the body, so the strip is
 * deterministic at packaging — not learned-by-rejection.
 */
test("transport knobs never reach the body — protocol/streaming are ours", () => {
  const packaged = ProviderTransform.providerOptions(createModel("opencode-go", "glm-5.3-flash"), {
    protocol: "h2",
    streaming: true,
    prompt_cache_key: "ses_x:glm-5.3-flash",
  })
  expect(packaged["opencode-go"].protocol).toBeUndefined()
  expect(packaged["opencode-go"].streaming).toBeUndefined()
  // the rest of the body is untouched
  expect(packaged["opencode-go"].prompt_cache_key).toBe("ses_x:glm-5.3-flash")
})

test("the transport strip is global — any provider, not just a learned pair", () => {
  const packaged = ProviderTransform.providerOptions(createModel("deepseek", "deepseek-flash"), {
    protocol: "h2",
    streaming: true,
  })
  expect(packaged["deepseek"].protocol).toBeUndefined()
  expect(packaged["deepseek"].streaming).toBeUndefined()
})
