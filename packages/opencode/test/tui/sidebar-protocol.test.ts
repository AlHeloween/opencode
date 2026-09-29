import { describe, expect, test } from "bun:test"
import { protocolLabel, protocolPinned, protocolRow, type LastProtocol } from "@/cli/cmd/tui/feature-plugins/sidebar/protocol-row"

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

  test("reports the pinned rung of the SAME turn, and refuses everything else", () => {
    const pinned = { ...fact, pinned: "h2" }
    expect(protocolPinned({ [pinned.requestID]: pinned }, deepseek)).toBe("h2")
    // No pin on the event (an explicitly configured protocol pins nothing, the adapter sends null).
    expect(protocolPinned({ [fact.requestID]: fact }, deepseek)).toBeUndefined()
    expect(protocolPinned({ [fact.requestID]: { ...fact, pinned: null } }, deepseek)).toBeUndefined()
    // A policy written into the field is not a rung.
    expect(protocolPinned({ [fact.requestID]: { ...fact, pinned: "auto" } }, deepseek)).toBeUndefined()
    // Scoped exactly like protocolRow: another turn, provider or a staler turn cannot answer.
    expect(protocolPinned({ [fact.requestID]: pinned }, { ...deepseek, requestID: "msg_turn_3" })).toBeUndefined()
    expect(protocolPinned({ [fact.requestID]: pinned }, { ...deepseek, providerID: "openrouter" })).toBeUndefined()
    expect(protocolPinned({ [fact.requestID]: pinned }, { ...deepseek, assistantCreatedAt: 300 })).toBeUndefined()
  })
})

describe("protocol cell label", () => {
  test("auto wraps the measured transport", () => {
    expect(protocolLabel("auto", "h2")).toBe("auto(h2)")
    expect(protocolLabel(undefined, "h3")).toBe("auto(h3)")
    expect(protocolLabel("auto", "unknown")).toBe("auto(unknown)")
    expect(protocolLabel("auto", undefined)).toBe("auto(unknown)")
  })

  test("a fixed protocol is shown as itself", () => {
    expect(protocolLabel("h2", "h3")).toBe("h2")
    expect(protocolLabel("http/1.1", "unknown")).toBe("http/1.1")
  })

  test("a PINNED rung IS the setting, so it loses the auto() wrapper (owner, 2026-09-29)", () => {
    expect(protocolLabel("auto", "h2", "h2")).toBe("h2")
    expect(protocolLabel("auto", undefined, "h3")).toBe("h3")
    // Not every pin string is a rung: the honest wrapping stays when it is not.
    expect(protocolLabel("auto", "h2", "auto")).toBe("auto(h2)")
    // An explicitly configured protocol still wins over any pin.
    expect(protocolLabel("h3", "h2", "h2")).toBe("h3")
  })
})
