import { describe, expect, test } from "bun:test"
import {
  classifyVariantState,
  pruneSummary,
  withoutKeys,
} from "../../src/cli/cmd/tui/component/model-state-prune"

const PROVIDERS = [
  {
    id: "deepseek",
    models: { "deepseek-flash": { variants: { low: {}, high: {}, max: {} } } },
  },
  {
    // ProviderTransform.variants() returns {} for the qwen family, so any
    // stored variant for this model is inert by construction.
    id: "groq",
    models: { "qwen/qwen3.6-27b": { variants: {} } },
  },
  {
    id: "streamlake-vanchin",
    models: { "ep-pfi2yr-1789318787045375441": {} },
  },
] as const

const AGENTS = ["build_mode", "plan_mode", "reasoning_mode"]

describe("variant state prune", () => {
  test("a live model that offers variants is never a prune target", () => {
    const report = classifyVariantState(
      { variant: { "deepseek/deepseek-flash": "high" } },
      PROVIDERS,
      AGENTS,
    )
    expect(report.inert).toEqual([])
    expect(report.unresolved).toEqual([])
  })

  test("a loaded model with no variants is inert and safe to remove", () => {
    const report = classifyVariantState(
      { variant: { "groq/qwen/qwen3.6-27b": "default" } },
      PROVIDERS,
      AGENTS,
    )
    expect(report.inert).toEqual([
      { map: "variant", key: "groq/qwen/qwen3.6-27b", value: "default", reason: "no-variants" },
    ])
    expect(report.unresolved).toEqual([])
  })

  test("an absent provider is unresolved, not inert — it may just be unconfigured", () => {
    // The retired KAT line, and the same endpoint under an old provider id.
    const report = classifyVariantState(
      {
        variant: {
          "kat-coder-pro-v2-5/ep-x7d49z-1787019286684713063": "default",
          "smit-glm-5.3-flash/ep-pfi2yr-1789318787045375441": "default",
        },
      },
      PROVIDERS,
      AGENTS,
    )
    expect(report.inert).toEqual([])
    expect(report.unresolved.map((x) => x.key)).toEqual([
      "kat-coder-pro-v2-5/ep-x7d49z-1787019286684713063",
      "smit-glm-5.3-flash/ep-pfi2yr-1789318787045375441",
    ])
  })

  test("an agent key resolves without splitting on the ambiguous separator", () => {
    // "build_mode/groq/qwen/qwen3.6-27b" has four segments and both the
    // provider and the model id contain "/", so naive splitting cannot work.
    const report = classifyVariantState(
      {
        agentVariant: {
          "build_mode/groq/qwen/qwen3.6-27b": "default",
          "plan_mode/deepseek/deepseek-flash": "high",
          "build_mode/kat-coder-pro-v2-5/ep-x7d49z-1787019286684713063": "default",
        },
      },
      PROVIDERS,
      AGENTS,
    )
    expect(report.inert.map((x) => x.key)).toEqual(["build_mode/groq/qwen/qwen3.6-27b"])
    expect(report.unresolved.map((x) => x.key)).toEqual([
      "build_mode/kat-coder-pro-v2-5/ep-x7d49z-1787019286684713063",
    ])
  })

  test("an unknown agent name leaves the entry unresolved rather than matching a model", () => {
    const report = classifyVariantState(
      { agentVariant: { "retired_agent/deepseek/deepseek-flash": "high" } },
      PROVIDERS,
      AGENTS,
    )
    expect(report.inert).toEqual([])
    expect(report.unresolved.map((x) => x.key)).toEqual(["retired_agent/deepseek/deepseek-flash"])
  })

  test("a model present but declaring no variants field counts as inert", () => {
    const report = classifyVariantState(
      { variant: { "streamlake-vanchin/ep-pfi2yr-1789318787045375441": "default" } },
      PROVIDERS,
      AGENTS,
    )
    expect(report.inert.map((x) => x.key)).toEqual(["streamlake-vanchin/ep-pfi2yr-1789318787045375441"])
  })

  test("removal drops only the named keys of the named map", () => {
    const targets = [
      { map: "variant" as const, key: "a/b", value: "default", reason: "no-variants" as const },
      { map: "agentVariant" as const, key: "x/a/b", value: "default", reason: "no-variants" as const },
    ]
    expect(withoutKeys({ "a/b": "default", "c/d": "max" }, targets, "variant")).toEqual({ "c/d": "max" })
    expect(withoutKeys({ "x/a/b": "default", "x/c/d": "max" }, targets, "agentVariant")).toEqual({
      "x/c/d": "max",
    })
    expect(withoutKeys(undefined, targets, "variant")).toEqual({})
  })

  test("the summary names what is kept, not only what goes", () => {
    expect(pruneSummary({ inert: [], unresolved: [] })).toBe("0 inert")
    expect(
      pruneSummary({
        inert: [{ map: "variant", key: "a", value: "default", reason: "no-variants" }],
        unresolved: [{ map: "variant", key: "b", value: "default", reason: "unresolved" }],
      }),
    ).toBe("1 inert · 1 unresolved (kept)")
  })
})
