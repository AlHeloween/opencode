import { describe, expect, test } from "bun:test"
import {
  agentHintText,
  agentModelCell,
  agentModelRef,
  agentRowModelCell,
} from "../../src/cli/cmd/tui/component/agent-model-cell"

describe("agentModelCell", () => {
  test("a session override wins, and the cell says so", () => {
    expect(
      agentModelCell({
        session: "deepseek/deepseek-flash",
        worktree: "huggingface/zai-org/GLM-5.3-BF16",
        declared: "opencode/big-pickle",
        guard: "inherits from worktree",
      }),
    ).toEqual({ model: "deepseek/deepseek-flash", origin: "session" })
  })

  test("the worktree layer answers when the session is silent", () => {
    expect(
      agentModelCell({ worktree: "huggingface/zai-org/GLM-5.3-Flash-BF16", declared: "opencode/big-pickle", guard: "g" }),
    ).toEqual({ model: "huggingface/zai-org/GLM-5.3-Flash-BF16", origin: "worktree" })
  })

  test("the live defect: an unread session layer still shows the model the agent will run", () => {
    // Measured 2026-09-21 on the owner's session: every row printed `inherits from worktree`
    // while .opencode/data/sessions/ses_f4d1592e9ffe3xdoiVgVCeKkS2.jsonc held a model for 11
    // agents. The column must fall back to the agent's own declaration, not to a guard.
    expect(
      agentModelCell({
        declared: "huggingface/zai-org/GLM-5.3-Flash-BF16",
        guard: "inherits from worktree",
      }),
    ).toEqual({ model: "huggingface/zai-org/GLM-5.3-Flash-BF16", origin: "agent" })
  })

  test("the guard is the only answer with no origin, and it is never an empty cell", () => {
    expect(agentModelCell({ guard: "inherits from worktree" })).toEqual({ model: "inherits from worktree" })
  })
})

describe("agentModelRef", () => {
  test("splits at the FIRST slash — model ids carry their own slashes", () => {
    expect(agentModelRef("custom/org/Model-BF16")).toEqual({
      providerID: "custom",
      modelID: "org/Model-BF16",
    })
  })

  test("a guard label is not a model reference", () => {
    expect(agentModelRef("inherits from worktree")).toBeUndefined()
  })
})

describe("agentRowModelCell", () => {
  test("renders the model picker's cell: pretty name, provider, price, capabilities, variant", () => {
    // The owner's target row (2026-09-21): `DeepSeek V4.1 Flash  DeepSeek  ⇣0.15 ⇡0.6 ↻0.003 [👁 🧠 🔧] · max`.
    expect(
      agentRowModelCell({
        ref: "deepseek/deepseek-flash",
        provider: { id: "deepseek", name: "DeepSeek" },
        info: {
          name: "DeepSeek V4.1 Flash",
          cost: { input: 0.15, output: 0.6, cache: { read: 0.003 } },
          capabilities: { reasoning: true, toolcall: true, input: { image: true } },
        },
        variant: "max",
      }),
    ).toEqual({
      description: "DeepSeek V4.1 Flash",
      footer: "DeepSeek ⇣0.15 ⇡0.6 ↻0.003 [👁 🧠 🔧] · max",
    })
  })

  test("an unpublished price shows nothing rather than a zero", () => {
    expect(
      agentRowModelCell({
        ref: "custom/local-model",
        provider: { id: "custom", name: "Custom" },
        info: { name: "Local Model", capabilities: { toolcall: true } },
      }),
    ).toEqual({ description: "Local Model", footer: "Custom [🔧]" })
  })

  test("a Zen free-tier model reads Free — the test model on this host", () => {
    // Owner, 2026-09-21: «вот модель для тестов. На hf у нас сейчас денег нету» —
    // Muse Spark 1.2 Free carries real zeros, which is the one case where zero IS a price.
    expect(
      agentRowModelCell({
        ref: "opencode/muse-spark-1.2-free",
        provider: { id: "opencode", name: "OpenCode Zen" },
        info: {
          name: "Muse Spark 1.2 Free",
          cost: { input: 0, output: 0 },
          capabilities: { reasoning: true, toolcall: true, input: { image: true, video: true } },
        },
        variant: "high",
      }),
    ).toEqual({
      description: "Muse Spark 1.2 Free",
      footer: "OpenCode Zen Free [🎥 👁 🧠 🔧] · high",
    })
  })

  test("the guard label survives as the cell, with no invented provider or price", () => {
    expect(agentRowModelCell({ ref: "inherits from worktree" })).toEqual({
      description: "inherits from worktree",
      footer: "",
    })
  })
})

describe("agentHintText", () => {
  test("carries the explanation the row no longer shows, plus how the model resolved", () => {
    expect(
      agentHintText({
        description: "Primary implementer (build_mode)",
        origin: "session",
        taskCount: 2,
      }),
    ).toBe("Primary implementer (build_mode) · model from the session layer · task: 2")
  })

  test("facts without a description still produce a hint", () => {
    expect(agentHintText({ origin: "agent" })).toBe("model from the agent layer")
  })

  test("nothing to say → no hint, so the line is hidden rather than blank", () => {
    expect(agentHintText({})).toBeUndefined()
  })
})
