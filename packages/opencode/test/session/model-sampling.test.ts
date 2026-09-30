import { expect, test } from "bun:test"
import { modelSampling, modelSamplingKey } from "../../src/session/model-sampling"

test("every model starts with the approved thinking-agent sampling profile", () => {
  expect(modelSampling(undefined)).toEqual({
    temperature: 0.65,
    repetition_penalty: 1.1,
    top_p: 0.95,
  })
})

test("configured model sampling changes only finite supplied parameters", () => {
  expect(modelSampling({ temperature: 0.2, repetition_penalty: 1.3, top_p: Number.NaN })).toEqual({
    temperature: 0.2,
    repetition_penalty: 1.3,
    top_p: 0.95,
  })
})

test("a stored penalty setting never comes back onto the wire", () => {
  // `presence_penalty`/`frequency_penalty` are deprecated at the vendor and form
  // a rejected pair with `repetition_penalty` — a Zen key that works on upstream
  // 1.18.29 answered ours with `400 invalid_request_error: repetition_penalty
  // can't be combined with frequency_penalty or presence_penalty` (2026-09-30).
  // Settings files written by an older build must not resurrect them.
  const loaded = modelSampling({ temperature: 0.2, presence_penalty: 0.8, frequency_penalty: 0.5 })
  expect(loaded).toEqual({
    temperature: 0.2,
    repetition_penalty: 1.1,
    top_p: 0.95,
  })
  expect(Object.keys(loaded).some((key) => key.includes("penalty") && key !== "repetition_penalty")).toBe(false)
})

test("model sampling ignores display variants", () => {
  expect(modelSamplingKey("openrouter", "deepseek-v4-flash:nitro")).toBe("openrouter/deepseek-v4-flash")
})
