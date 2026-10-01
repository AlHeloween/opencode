import { describe, expect, test } from "bun:test"
import { carriedVariant, commitStage, stageEdit, type GlobalStage } from "../../src/cli/cmd/tui/component/global-agent-stage"

const flash = { providerID: "deepseek", modelID: "deepseek-v4.1-flash" }
const glm = { providerID: "huggingface", modelID: "zai-org/GLM-5.3-Flash-BF16" }

describe("stageEdit", () => {
  test("a model pick stages model and variant together", () => {
    expect(stageEdit({}, "build", { model: flash, variant: "max" })).toEqual({ build: { model: flash, variant: "max" } })
  })

  test("a variant-only pick keeps the model staged earlier", () => {
    const stage = stageEdit({}, "build", { model: flash, variant: "max" })
    expect(stageEdit(stage, "build", { variant: undefined })).toEqual({ build: { model: flash, variant: undefined } })
  })

  test("a newer model pick replaces the staged one; other agents are untouched", () => {
    const stage = stageEdit(stageEdit({}, "build", { model: flash, variant: "max" }), "plan", { variant: "high" })
    expect(stageEdit(stage, "build", { model: glm, variant: undefined })).toEqual({
      build: { model: glm, variant: undefined },
      plan: { variant: "high" },
    })
  })

  test("the input stage is not mutated", () => {
    const stage: GlobalStage = {}
    stageEdit(stage, "build", { model: flash, variant: "max" })
    expect(stage).toEqual({})
  })
})

describe("carriedVariant", () => {
  test("a model pick keeps the variant the new model also declares", () => {
    expect(carriedVariant("max", ["high", "max"])).toBe("max")
  })

  test("a variant the new model does not declare falls back to the default", () => {
    expect(carriedVariant("max", ["low", "high"])).toBeUndefined()
    expect(carriedVariant("max", [])).toBeUndefined()
  })

  test("no variant stays no variant", () => {
    expect(carriedVariant(undefined, ["high"])).toBeUndefined()
  })
})

describe("commitStage", () => {
  test("writes one agent at a time, never two in flight", async () => {
    const stage = stageEdit(stageEdit({}, "build", { model: flash, variant: "max" }), "plan", { variant: "high" })
    const events: string[] = []
    const result = await commitStage(stage, async (agent) => {
      events.push(`start ${agent}`)
      await Bun.sleep(5)
      events.push(`end ${agent}`)
    })
    expect(events).toEqual(["start build", "end build", "start plan", "end plan"])
    expect(result).toEqual({ saved: ["build", "plan"], failed: [] })
  })

  test("a failed write is reported and the remaining agents still save", async () => {
    const stage = stageEdit(stageEdit({}, "build", { model: flash, variant: "max" }), "plan", { variant: "high" })
    const result = await commitStage(stage, async (agent) => {
      if (agent === "build") throw new Error("422")
    })
    expect(result).toEqual({ saved: ["plan"], failed: [{ agent: "build", error: "422" }] })
  })

  test("an empty stage writes nothing", async () => {
    const calls: string[] = []
    expect(await commitStage({}, async (agent) => void calls.push(agent))).toEqual({ saved: [], failed: [] })
    expect(calls).toEqual([])
  })
})
