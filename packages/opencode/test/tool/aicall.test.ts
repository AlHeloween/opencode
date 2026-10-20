import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { requestEnvelope } from "../../src/tool/aicall"

describe("aicall request envelope", () => {
  test("reports the direct provider request shape without prompt content", () => {
    const model: Pick<Provider.Model, "providerID" | "id" | "api" | "parameters" | "model_type" | "cost" | "limit"> = {
      providerID: ProviderID.make("deepseek"),
      id: ModelID.make("deepseek-v4-pro"),
      api: {
        id: "deepseek-v4-pro",
        npm: "@ai-sdk/deepseek",
        url: "https://api.deepseek.com",
      },
      parameters: 685,
      model_type: "chat",
      cost: { input: 0.27, output: 1.08, cache: { read: 0.027, write: 0.054 } },
      limit: { context: 1048576, output: 32768 },
    }

    const result = requestEnvelope(model, "secret prompt")

    expect(result).toContain("provider: deepseek")
    expect(result).toContain("model: deepseek-v4-pro")
    expect(result).toContain("sdk: @ai-sdk/deepseek")
    expect(result).toContain("type: chat")
    expect(result).toContain("parameters: 685B")
    expect(result).toContain("cost: $0.27/$1.08 per Mtok")
    expect(result).toContain("context: 1048576 tokens")
    expect(result).toContain("system: none (isolated aicall)")
    expect(result).toContain("tools: none (isolated aicall)")
    expect(result).toContain("user context: 13 chars")
    expect(result).not.toContain("secret prompt")
  })

  test("reports free models and unknown parameter counts without inventing data", () => {
    const model: Pick<Provider.Model, "providerID" | "id" | "api" | "parameters" | "model_type" | "cost" | "limit"> = {
      providerID: ProviderID.make("openrouter"),
      id: ModelID.make("z-ai/glm-5.2:free"),
      api: {
        id: "z-ai/glm-5.2:free",
        npm: "@openrouter/ai-sdk-provider",
        url: "https://openrouter.ai/api/v1",
      },
      parameters: undefined,
      model_type: "chat",
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 131072, output: 32768 },
    }

    const result = requestEnvelope(model, "hello")

    expect(result).toContain("cost: free")
    expect(result).toContain("parameters: unknown")
  })
})

describe("aicall router guard (t72)", () => {
  test("isRouterModel flags auto routers, never a real free model", async () => {
    const { isRouterModel } = await import("../../src/tool/aicall")
    expect(isRouterModel({ providerID: "openrouter", id: "auto" as never })).toBe(true)
    expect(isRouterModel({ providerID: "openrouter", id: "auto-beta" as never })).toBe(true)
    expect(isRouterModel({ providerID: "openrouter", id: "openrouter/auto-beta" as never })).toBe(true)
    expect(isRouterModel({ providerID: "openrouter", id: "openrouter/free" as never })).toBe(true)
    expect(
      isRouterModel({ providerID: "openrouter", id: "pareto-code" as never, name: "Pareto Code Router" }),
    ).toBe(true)
    expect(
      isRouterModel({ providerID: "nvidia", id: "switchyard" as never }),
    ).toBe(true)
    expect(
      isRouterModel({ providerID: "openrouter", id: "z-ai/glm-5.2:free" as never, name: "Z.ai: GLM 5.2" }),
    ).toBe(false)
    expect(
      isRouterModel({ providerID: "deepseek", id: "deepseek-v4-pro" as never, name: "DeepSeek V4 Pro" }),
    ).toBe(false)
  })

  test("router envelope prints UNKNOWN (router), never free", async () => {
    const { requestEnvelope } = await import("../../src/tool/aicall")
    const router = {
      providerID: ProviderID.make("openrouter"),
      id: ModelID.make("openrouter/auto-beta"),
      api: { id: "openrouter/auto-beta", npm: "@openrouter/ai-sdk-provider", url: "https://openrouter.ai/api/v1" },
      parameters: undefined,
      model_type: "chat" as const,
      cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      limit: { context: 2000000, output: 0 },
    }
    const result = requestEnvelope(router, "hello")
    expect(result).toContain("cost: UNKNOWN (router)")
    expect(result).not.toContain("cost: free")
  })
})

describe("aicall empty completion (2026-10-20)", () => {
  test("an empty completion is a named failure, not an empty answer", async () => {
    const { emptyCompletionReport } = await import("../../src/tool/aicall")
    const report = emptyCompletionReport(
      {
        providerID: ProviderID.make("openrouter"),
        id: ModelID.make("minimax/minimax-m3.1-flash:free"),
      },
      "ENVELOPE-LINE",
    )

    expect(report.title).toContain("FAILED (empty completion)")
    expect(report.output).toContain("AICALL FAILED (empty completion)")
    expect(report.output).toContain("ENVELOPE-LINE")
    expect(report.output).toContain("max_tokens")
    expect(report.metadata.model.modelID).toBe(ModelID.make("minimax/minimax-m3.1-flash:free"))
  })

  test("whitespace-only text counts as empty, real text does not", async () => {
    const { isEmptyCompletion } = await import("../../src/tool/aicall")
    expect(isEmptyCompletion("")).toBe(true)
    expect(isEmptyCompletion("   \n\t ")).toBe(true)
    expect(isEmptyCompletion(undefined)).toBe(true)
    expect(isEmptyCompletion("да")).toBe(false)
  })
})
