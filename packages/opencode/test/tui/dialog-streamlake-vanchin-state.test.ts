import { describe, expect, test } from "bun:test"
import {
  STREAMLAKE_VANCHIN_CATALOG_SOURCE,
  STREAMLAKE_VANCHIN_MODELS,
  STREAMLAKE_VANCHIN_PAYG_BASE_URL,
  STREAMLAKE_VANCHIN_PROVIDER_ID,
  streamLakeVanchinConfig,
  streamLakeVanchinEndpointID,
} from "../../src/cli/cmd/tui/component/dialog-streamlake-vanchin-state"

describe("StreamLake Vanchin setup", () => {
  test("accepts only a trimmed inference endpoint ID", () => {
    expect(streamLakeVanchinEndpointID(" ep-x7d49z-1787019286684713063 ")).toBe("ep-x7d49z-1787019286684713063")
    expect(streamLakeVanchinEndpointID("kat-coder-pro-v2.5")).toBeUndefined()
    expect(streamLakeVanchinEndpointID("ep_abc")).toBeUndefined()
  })

  test("carries official multimodal model capabilities into the provider picker", () => {
    const profile = STREAMLAKE_VANCHIN_MODELS.find((model) => model.name === "Kimi-K2.6")
    expect(profile).toEqual({
      name: "Kimi-K2.6",
      category: "Multimodal",
      reasoning: false,
      tool_call: true,
      limit: { context: 262144, output: 262144 },
      modalities: { input: ["text", "image", "video"], output: ["text"] },
    })
    expect(STREAMLAKE_VANCHIN_CATALOG_SOURCE).toBe(
      "https://www.streamlake.com/document/WANQING/mdrax1ixkgpgh1ms1na",
    )
  })

  test("adds one endpoint profile without a key or invented capabilities", () => {
    const endpointID = "ep-x7d49z-1787019286684713063"
    const profile = STREAMLAKE_VANCHIN_MODELS.find((model) => model.name === "GLM-5.3")
    if (!profile) throw new Error("GLM-5.3 must be present in the Vanchin catalog")
    expect(streamLakeVanchinConfig(endpointID, profile)).toEqual({
      provider: {
        [STREAMLAKE_VANCHIN_PROVIDER_ID]: {
          models: {
            [endpointID]: {
              name: "GLM-5.3",
              reasoning: true,
              options: { enable_thinking: true },
              limit: { context: 1024000 },
              modalities: { input: ["text"], output: ["text"] },
            },
          },
        },
      },
    })
    expect(STREAMLAKE_VANCHIN_PAYG_BASE_URL).toBe("https://vanchin.streamlake.ai/api/gateway/v1/endpoints")
  })
})