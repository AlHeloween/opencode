import { describe, expect, test } from "bun:test"
import { describeProtocolCell, protocolCurrentFromMessages } from "./protocol-cell"

const assistant = (over: Record<string, unknown> = {}) => ({
  id: "msg_1",
  sessionID: "ses_1",
  role: "assistant",
  parentID: "req_9",
  providerID: "deepseek",
  modelID: "deepseek-chat",
  time: { created: 5_000 },
  ...over,
})

describe("protocolCurrentFromMessages", () => {
  test("maps the last assistant message onto the turn contract", () => {
    const current = protocolCurrentFromMessages("ses_1", [
      { id: "u1", role: "user" },
      assistant(),
    ])
    expect(current).toEqual({
      requestID: "req_9",
      sessionID: "ses_1",
      providerID: "deepseek",
      modelID: "deepseek-chat",
      assistantCreatedAt: 5_000,
    })
  })
  test("ignores user messages and later sessions", () => {
    expect(protocolCurrentFromMessages("ses_1", [{ id: "u1", role: "user" }])).toBeUndefined()
    expect(protocolCurrentFromMessages("ses_2", [assistant()])).toBeUndefined()
  })
  test("a message without linkage cannot answer", () => {
    expect(protocolCurrentFromMessages("ses_1", [assistant({ parentID: undefined })])).toBeUndefined()
  })
})

describe("describeProtocolCell", () => {
  const current = {
    requestID: "req_9",
    sessionID: "ses_1",
    providerID: "deepseek",
    modelID: "deepseek-chat",
    assistantCreatedAt: 5_000,
  }
  test("names the measured rung while unpinned", () => {
    expect(
      describeProtocolCell({
        facts: { req_9: { requestID: "req_9", providerID: "deepseek", modelID: "deepseek-chat", protocol: "h2", at: 6_000 } },
        current,
        configured: undefined,
      }).label,
    ).toBe("⇅ auto(h2)")
  })
  test("no turn yet reads auto(unknown), never blank", () => {
    const label = describeProtocolCell({ facts: {}, current: undefined, configured: undefined }).label
    expect(label).toBe("⇅ auto(unknown)")
    expect(label.length).toBeGreaterThan(0)
  })
  test("a pinned route names the pin", () => {
    expect(
      describeProtocolCell({
        facts: {
          req_9: { requestID: "req_9", providerID: "deepseek", modelID: "deepseek-chat", protocol: "h3", pinned: "h3", at: 6_000 },
        },
        current,
        configured: undefined,
      }).label,
    ).toBe("⇅ h3")
  })
})
