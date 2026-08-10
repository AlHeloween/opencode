import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { requestEnvelope } from "../../src/tool/aicall"

describe("aicall request envelope", () => {
  test("reports the direct provider request shape without prompt content", () => {
    const model: Pick<Provider.Model, "providerID" | "id" | "api"> = {
      providerID: ProviderID.make("deepseek"),
      id: ModelID.make("deepseek-v4-pro"),
      api: {
        id: "deepseek-v4-pro",
        npm: "@ai-sdk/deepseek",
        url: "https://api.deepseek.com",
      },
    }

    const result = requestEnvelope(model, "secret prompt")

    expect(result).toContain("provider: deepseek")
    expect(result).toContain("model: deepseek-v4-pro")
    expect(result).toContain("sdk: @ai-sdk/deepseek")
    expect(result).toContain("system: none (isolated aicall)")
    expect(result).toContain("tools: none (isolated aicall)")
    expect(result).toContain("user context: 13 chars")
    expect(result).not.toContain("secret prompt")
  })
})
