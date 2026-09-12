import { describe, expect, test } from "bun:test"
import {
  variantDetail,
  variantDialogTitle,
  variantFamily,
  variantLabels,
} from "../../src/cli/cmd/tui/component/variant-dialog-state"

/** Build the shape the TUI actually holds: a synced provider model. */
function model(apiID: string) {
  return { api: { id: apiID } }
}

describe("variant dialog family gate", () => {
  test("recognizes the current DeepSeek model, which the retired literal missed", () => {
    // `deepseek-flash` (DeepSeek-V4.1-Flash, 2026-09-10) has no `deepseek-v4`
    // substring — the exact regression this gate exists to prevent.
    expect(variantFamily(model("deepseek-flash"))).toBe("deepseek")
    expect(variantFamily(model("deepseek-v4-flash"))).toBe("deepseek")
    expect(variantFamily(model("deepseek-v4-pro"))).toBe("deepseek")
    expect(variantFamily(model("deepseek/deepseek-v4.1-flash"))).toBe("deepseek")
    expect(variantFamily(model("deepseek-v4p1-flash"))).toBe("deepseek")
  })

  test("keeps retired aliases and other vendors out of the DeepSeek labels", () => {
    expect(variantFamily(model("deepseek-chat"))).toBeUndefined()
    expect(variantFamily(model("deepseek-reasoner"))).toBeUndefined()
    expect(variantFamily(model("deepseek-r1"))).toBeUndefined()
    expect(variantFamily(model("deepseek-v3"))).toBeUndefined()
    expect(variantFamily(model("deepseek-ocr"))).toBeUndefined()
    expect(variantFamily(model("claude-sonnet-4"))).toBeUndefined()
    expect(variantFamily(model("gpt-4"))).toBeUndefined()
  })

  test("still labels GLM, case-insensitively", () => {
    expect(variantFamily(model("glm-5.3"))).toBe("glm")
    expect(variantFamily(model("GLM-4.6"))).toBe("glm")
  })

  test("titles the DeepSeek dialog as a thinking-mode surface", () => {
    expect(variantDialogTitle("deepseek")).toBe("Select thinking mode")
    expect(variantDialogTitle("glm")).toBe("Select variant")
    expect(variantDialogTitle(undefined)).toBe("Select variant")
  })

  test("describes every key the engine emits for the family", () => {
    for (const key of ["off", "low", "high", "max"]) {
      expect(variantDetail("deepseek", key)?.description).toBeString()
    }
    expect(variantDetail("deepseek", "default")?.title).toBe("Default (Thinking)")
    // A key the family does not describe must fall through to the raw name,
    // so an unexpected engine variant still renders instead of crashing.
    expect(variantDetail("deepseek", "__unknown__")).toBeUndefined()
    expect(variantDetail(undefined, "high")).toBeUndefined()
    expect(variantLabels(undefined)).toBeUndefined()
  })

  test("degrades instead of throwing when the model is malformed (render safety)", () => {
    // Runs inside createMemo during render: a throw here takes down the TUI.
    expect(variantFamily(undefined)).toBeUndefined()
    expect(variantFamily({} as never)).toBeUndefined()
    expect(variantFamily({ api: {} } as never)).toBeUndefined()
    expect(variantFamily({ api: { id: null } } as never)).toBeUndefined()
    expect(variantFamily({ api: { id: 42 } } as never)).toBeUndefined()
  })
})
