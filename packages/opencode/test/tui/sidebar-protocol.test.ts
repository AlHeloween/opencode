import { describe, expect, test } from "bun:test"
import { protocolRow, type LastProtocol } from "@/cli/cmd/tui/feature-plugins/sidebar/protocol-row"

const deepseek = { requestID: "msg_turn_2", sessionID: "ses_current", providerID: "deepseek", modelID: "deepseek-flash", assistantCreatedAt: 100 }
const fact: LastProtocol = { ...deepseek, protocol: "h2", at: 200 }

describe("sidebar protocol row", () => {
  test("shows the factual transport after its event arrives before the assistant output", () => {
    expect(protocolRow({ [fact.requestID]: fact }, deepseek)).toBe("h2")
  })

  test("does not show another turn, provider, model or session's transport", () => {
    const events = { [fact.requestID]: fact }
    expect(protocolRow(events, { ...deepseek, requestID: "msg_turn_3" })).toBe("unknown")
    expect(protocolRow(events, { ...deepseek, providerID: "openrouter" })).toBe("unknown")
    expect(protocolRow(events, { ...deepseek, modelID: "other-model" })).toBe("unknown")
    expect(protocolRow(events, { ...deepseek, assistantCreatedAt: 300 })).toBe("unknown")
    expect(protocolRow({ ses_current: { ...fact, requestID: "ses_current" } }, deepseek)).toBe("unknown")
    expect(protocolRow({}, deepseek)).toBe("unknown")
  })

  test("Novita uses the session ID for x-request-id", () => {
    const novita = { ...deepseek, providerID: "novita-ai" }
    expect(protocolRow({ ses_current: { ...fact, requestID: "ses_current", providerID: "novita-ai" } }, novita)).toBe("h2")
    expect(protocolRow({ ses_current: { ...fact, requestID: "ses_current", providerID: "novita-ai" } }, { ...novita, assistantCreatedAt: 300 })).toBe("unknown")
  })

  test("does not call the auto policy a measured transport", () => {
    expect(protocolRow({}, deepseek)).toBe("unknown")
    expect(protocolRow({ msg_turn_2: { ...fact, protocol: "auto" } }, deepseek)).toBe("unknown")
  })
})
