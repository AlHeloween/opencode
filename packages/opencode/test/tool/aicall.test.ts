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
