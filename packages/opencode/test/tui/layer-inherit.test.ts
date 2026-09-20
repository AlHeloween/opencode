import { describe, expect, test } from "bun:test"
import { planCopyFromParent, type Layers } from "../../src/cli/cmd/tui/component/layer-inherit"

const LAYERS: Layers = {
  session: {},
  worktree: { model: "deepseek/deepseek-flash", variant: "high" },
  global: { model: "openrouter/z-ai/glm-5.3-flash", variant: "max" },
}

describe("layer copy between layers", () => {
  test("session copies down from worktree, worktree from global", () => {
    const toSession = planCopyFromParent("session", LAYERS)
    expect(toSession).toEqual({
      ok: true,
      plan: { from: "worktree", to: "session", model: "deepseek/deepseek-flash", variant: "high" },
    })
    const toWorktree = planCopyFromParent("worktree", LAYERS)
    expect(toWorktree).toEqual({
      ok: true,
      plan: { from: "global", to: "worktree", model: "openrouter/z-ai/glm-5.3-flash", variant: "max" },
    })
  })

  test("global has nothing above it", () => {
    const planned = planCopyFromParent("global", LAYERS)
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.reason).toContain("widest layer")
  })

  test("an empty parent is refused rather than copying nothing", () => {
    const planned = planCopyFromParent("session", { ...LAYERS, worktree: {} })
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.reason).toBe("worktree holds no value to copy")
  })

  test("a parent variant with no model is refused — it would key to a model the user never saw", () => {
    const planned = planCopyFromParent("session", { ...LAYERS, worktree: { variant: "max" } })
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.reason).toContain("variant but no model")
  })

  test("a copy carries the model without a variant when the parent has none", () => {
    const planned = planCopyFromParent("session", {
      ...LAYERS,
      worktree: { model: "groq/qwen/qwen3.6-27b" },
    })
    expect(planned).toEqual({
      ok: true,
      plan: { from: "worktree", to: "session", model: "groq/qwen/qwen3.6-27b", variant: undefined },
    })
  })

})
