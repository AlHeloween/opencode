import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

/**
 * opencode-go long-lived cache (A+B): per-session key + 24h retention (S1)
 * and system-stable breakpoints for non-GLM (S2, GLM skipped).
 * Canon: pi-opencode-go-cache (key + 24h + breakpoints, ceilings 1h/24h),
 * Z.AI implicit caching (no knobs), Novita no-marker regression intact.
 */

const baseModel = {
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 1000000, output: 131072 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-08-26",
} as any

const goModel = (id: string) => ({
  ...baseModel,
  id: `opencode-go/${id}`,
  providerID: "opencode-go",
  api: { id, url: "https://opencode.ai/inference/go/v1", npm: "@ai-sdk/openai-compatible" },
})

// Zen path: same backend as go (owner 2026-10-14), different providerID string.
const zenModel = (id: string) => ({
  ...baseModel,
  id: `opencode/${id}`,
  providerID: "opencode",
  api: { id, url: "https://opencode.ai/inference/v1", npm: "@ai-sdk/openai-compatible" },
})

describe("opencode-go long-lived cache", () => {
  test("S1: options() sets key + 24h retention without opt-in", () => {
    const result = ProviderTransform.options({
      model: goModel("deepseek-v4-flash"),
      sessionID: "ses_test",
      providerOptions: {},
    })
    expect(result.prompt_cache_key).toBe("ses_test:opencode-go/deepseek-v4-flash")
    expect(result.prompt_cache_retention).toBe("24h")
  })

  test("S1: GLM also gets key + retention (markers are separate)", () => {
    const result = ProviderTransform.options({
      model: goModel("glm-5.3-flash"),
      sessionID: "ses_test",
      providerOptions: {},
    })
    expect(result.prompt_cache_key).toBe("ses_test:opencode-go/glm-5.3-flash")
    expect(result.prompt_cache_retention).toBe("24h")
  })

  test("S1: retention survives providerOptions packaging under opencode-go namespace", () => {
    const packaged = ProviderTransform.providerOptions(goModel("deepseek-v4-flash"), {
      prompt_cache_key: "ses_x:deepseek-v4-flash",
      prompt_cache_retention: "24h",
      top_p: 0.95,
    })
    expect(packaged["opencode-go"].prompt_cache_key).toBe("ses_x:deepseek-v4-flash")
    expect(packaged["opencode-go"].prompt_cache_retention).toBe("24h")
    expect(packaged["opencode-go"].top_p).toBe(0.95)
  })

  test("S2: non-GLM system messages get ttl 1h breakpoints", () => {
    const msgs = [
      { role: "system", content: "stable-1" },
      { role: "system", content: "stable-2" },
      { role: "user", content: "hi" },
    ] as any[]
    const result = ProviderTransform.message(msgs, goModel("deepseek-v4-flash"), {}) as any[]
    expect(result[0].providerOptions?.openaiCompatible?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
    expect(result[1].providerOptions?.openaiCompatible?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
    expect(JSON.stringify(result[2])).not.toContain("cache_control")
  })

  test("S2: stale markers are stripped before re-stamping (no accumulation)", () => {
    const stale = { openaiCompatible: { cache_control: { type: "ephemeral", ttl: "5m" } } }
    const first = ProviderTransform.message(
      [
        { role: "system", content: "s1", providerOptions: JSON.parse(JSON.stringify(stale)) },
        { role: "user", content: "hi" },
      ] as any[],
      goModel("mimo-v2.6-flash"),
      {},
    ) as any[]
    const second = ProviderTransform.message(first, goModel("mimo-v2.6-flash"), {}) as any[]
    expect(second[0].providerOptions?.openaiCompatible?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
    expect(JSON.stringify(second).split("cache_control").length - 1).toBe(1)
  })

  test("S2: GLM models are skipped (gateway does not strip, GLM 400s)", () => {
    for (const id of ["glm-5.3-flash", "glm-5.3", "zhipu-glm-4"]) {
      const result = ProviderTransform.message(
        [
          { role: "system", content: "stable" },
          { role: "user", content: "hi" },
        ] as any[],
        goModel(id),
        {},
      ) as any[]
      expect(JSON.stringify(result)).not.toContain("cache_control")
    }
  })

  test("regression intact: novita-ai openai-compatible still gets no markers", () => {
    const novita = {
      ...baseModel,
      id: "novita-ai/zai-org/glm-5.3-flash",
      providerID: "novita-ai",
      api: { id: "zai-org/glm-5.3-flash", url: "https://api.novita.ai/openai", npm: "@ai-sdk/openai-compatible" },
    }
    const result = ProviderTransform.message(
      [
        { role: "system", content: "stable" },
        { role: "user", content: "hi" },
      ] as any[],
      novita,
      {},
    ) as any[]
    expect(JSON.stringify(result)).not.toContain("cache_control")
  })
})

describe("opencode (zen) — same backend, same treatment", () => {
  test("S1-zen: options() sets key + 24h retention without opt-in", () => {
    const result = ProviderTransform.options({
      model: zenModel("muse-spark-1.3-contributor-free"),
      sessionID: "ses_test",
      providerOptions: {},
    })
    expect(result.prompt_cache_key).toBe("ses_test:opencode/muse-spark-1.3-contributor-free")
    expect(result.prompt_cache_retention).toBe("24h")
  })

  test("S2-zen: non-GLM system messages get ttl 1h breakpoints", () => {
    const result = ProviderTransform.message(
      [
        { role: "system", content: "stable" },
        { role: "user", content: "hi" },
      ] as any[],
      zenModel("muse-spark-1.3-contributor-free"),
      {},
    ) as any[]
    expect(result[0].providerOptions?.openaiCompatible?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
  })

  test("S2-zen: GLM models are skipped", () => {
    const result = ProviderTransform.message(
      [
        { role: "system", content: "stable" },
        { role: "user", content: "hi" },
      ] as any[],
      zenModel("glm-5.3-flash"),
      {},
    ) as any[]
    expect(JSON.stringify(result)).not.toContain("cache_control")
  })
})
