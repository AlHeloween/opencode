import { describe, expect, test } from "bun:test"
import { describeModelCell } from "./model-cell"

describe("describeModelCell", () => {
  test("names agent, model and variant", () => {
    expect(
      describeModelCell({ agent: "build", providerID: "deepseek", modelID: "deepseek-chat", variant: "high" }).label,
    ).toBe("build · deepseek/deepseek-chat · high")
  })
  test("variant is omitted when unset", () => {
    expect(describeModelCell({ agent: "build", providerID: "deepseek", modelID: "deepseek-chat" }).label).toBe(
      "build · deepseek/deepseek-chat",
    )
  })
  test("missing agent or model reads unknown, never blank", () => {
    expect(describeModelCell({}).label).toBe("unknown · unknown")
    expect(describeModelCell({ agent: "build" }).label).toBe("build · unknown")
    expect(describeModelCell({ providerID: "a", modelID: "b" }).label).toBe("unknown · a/b")
  })
})
