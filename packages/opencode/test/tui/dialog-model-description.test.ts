import { describe, expect, test } from "bun:test"
import { modelOptionDescription } from "../../src/cli/cmd/tui/component/dialog-model"

describe("modelOptionDescription", () => {
  test("the row shows the exact config ref — the 2026-10-12 free-space request", () => {
    // Owner: «есть свободное место чтобы еще отобразить провайдера
    // deepseek/deepseek.... opencode-go/mimo-v2.6-Flash».
    expect(modelOptionDescription("deepseek", "deepseek-flash")).toBe("deepseek/deepseek-flash")
    expect(modelOptionDescription("opencode-go", "mimo-v2.6-Flash")).toBe("opencode-go/mimo-v2.6-Flash")
  })

  test("a model id with slashes keeps them — only the first segment is the provider", () => {
    // `huggingface/zai-org/GLM-5.3-BF16` is one provider and one model (agentModelRef contract).
    expect(modelOptionDescription("huggingface", "zai-org/GLM-5.3-BF16")).toBe("huggingface/zai-org/GLM-5.3-BF16")
  })

  test("a starred row carries the marker: flat search has no Favorites section", () => {
    expect(modelOptionDescription("deepseek", "deepseek-flash", true)).toBe("deepseek/deepseek-flash ★")
  })
})
