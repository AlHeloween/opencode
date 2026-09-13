import { expect, test } from "bun:test"
import { modelSampling, modelSamplingKey } from "../../src/session/model-sampling"

test("every model starts with the approved thinking-agent sampling profile", () => {
  expect(modelSampling(undefined)).toEqual({
    temperature: 0.65,
    repetition_penalty: 1.1,
    top_p: 0.95,
    presence_penalty: 0.2,
  })
})

test("configured model sampling changes only finite supplied parameters", () => {
  expect(
    modelSampling({ temperature: 0.2, repetition_penalty: 1.3, top_p: 0.7, presence_penalty: Number.NaN }),
  ).toEqual({
    temperature: 0.2,
    repetition_penalty: 1.3,
    top_p: 0.7,
    presence_penalty: 0.2,
  })
})

test("model sampling ignores display variants", () => {
  expect(modelSamplingKey("openrouter", "deepseek-v4-flash:nitro")).toBe("openrouter/deepseek-v4-flash")
})
