import { describe, expect, test } from "bun:test"
import type { SessionSettings } from "../../src/session/session-settings"
import { resolveAgentVariant, sessionAgentRouting, sessionModelRouting } from "../../src/session/session-settings"

// Subplan 04 rev 4 — session-scoped OpenRouter routing resolvers. Pure
// functions: no disk, no mocks — the values are what llm.ts threads per
// stream and what the TUI writes into sessions/{sid}.jsonc.
describe("session-settings routing resolvers", () => {
  const routing = { order: ["streamlake"], allow_fallbacks: false }

  test("sessionAgentRouting returns the agent's routing", () => {
    const settings: SessionSettings = { agent: { build: { routing } } }
    expect(sessionAgentRouting("build", settings)).toEqual(routing)
  })

  test("sessionAgentRouting is undefined for other agents / empty settings", () => {
    const settings: SessionSettings = { agent: { build: { routing } } }
    expect(sessionAgentRouting("explore", settings)).toBeUndefined()
    expect(sessionAgentRouting("build", null)).toBeUndefined()
    expect(sessionAgentRouting("build", {})).toBeUndefined()
  })

  test("sessionAgentRouting drops malformed routing (arrays, scalars)", () => {
    const settings = {
      agent: {
        build: { routing: ["streamlake"] as unknown as Record<string, unknown> },
        explore: { routing: "streamlake" as unknown as Record<string, unknown> },
      },
    }
    expect(sessionAgentRouting("build", settings)).toBeUndefined()
    expect(sessionAgentRouting("explore", settings)).toBeUndefined()
  })

  test("sessionModelRouting reads the variant-stripped provider/model key", () => {
    const settings: SessionSettings = { modelRouting: { "openrouter/deepseek-v4-flash": routing } }
    expect(sessionModelRouting("openrouter", "deepseek-v4-flash", settings)).toEqual(routing)
    expect(sessionModelRouting("openrouter", "deepseek-v4-flash:nitro", settings)).toBeUndefined()
    expect(sessionModelRouting("openrouter", "other", settings)).toBeUndefined()
    expect(sessionModelRouting("openrouter", "deepseek-v4-flash", null)).toBeUndefined()
  })

  test("sessionModelRouting drops malformed entries", () => {
    const settings = {
      modelRouting: {
        "openrouter/a": "bad" as unknown as Record<string, unknown>,
        "openrouter/b": [1] as unknown as Record<string, unknown>,
      },
    }
    expect(sessionModelRouting("openrouter", "a", settings)).toBeUndefined()
    expect(sessionModelRouting("openrouter", "b", settings)).toBeUndefined()
  })
})

// resolveAgentVariant — the worktree (model.json) step that was documented
// but never implemented: thinking-mode selections were lost on every
// restart / new session (Alexander, 2026-09-02). settings:{} + injected
// modelState keep these disk-free.
describe("resolveAgentVariant worktree restore", () => {
  const context = { sessionID: "ses_test" }
  const model = { providerID: "openrouter", modelID: "z-ai/glm-5.3-flash" }
  const agentKey = "plan_mode/openrouter/z-ai/glm-5.3-flash"

  test("worktree agentVariant restores the thinking mode in a new session", async () => {
    const result = await resolveAgentVariant("plan_mode", model, context, {
      settings: {},
      modelState: { agentVariant: { [agentKey]: "max" } },
    })
    expect(result).toBe("max")
  })

  test("session variant wins over the worktree layer", async () => {
    const settings: SessionSettings = { agentVariant: { [agentKey]: "low" } }
    const result = await resolveAgentVariant("plan_mode", model, context, {
      settings,
      modelState: { agentVariant: { [agentKey]: "max" } },
    })
    expect(result).toBe("low")
  })

  test("explicit 'default' sentinel in the session stops the chain", async () => {
    const settings: SessionSettings = { agentVariant: { [agentKey]: "default" } }
    const result = await resolveAgentVariant("plan_mode", model, context, {
      settings,
      modelState: { agentVariant: { [agentKey]: "max" } },
    })
    expect(result).toBeUndefined()
  })

  test("explicit 'default' sentinel in the worktree layer stops the chain", async () => {
    const result = await resolveAgentVariant("plan_mode", model, context, {
      settings: {},
      modelState: { agentVariant: { [agentKey]: "default" } },
    })
    expect(result).toBeUndefined()
  })

  test("worktree model-level variant map is the fallback", async () => {
    const result = await resolveAgentVariant("plan_mode", model, context, {
      settings: {},
      modelState: { variant: { "openrouter/z-ai/glm-5.3-flash": "high" } },
    })
    expect(result).toBe("high")
  })

  test("no layers set → undefined (caller falls through to agent config)", async () => {
    const result = await resolveAgentVariant("plan_mode", model, context, {
      settings: {},
      modelState: {},
    })
    expect(result).toBeUndefined()
  })
})
