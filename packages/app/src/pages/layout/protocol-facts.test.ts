import { describe, expect, test } from "bun:test"
import {
  acceptProtocolFact,
  connectionBadge,
  protocolLabel,
  protocolPinned,
  protocolRow,
} from "./protocol-facts"

const CURRENT = {
  requestID: "req_1",
  sessionID: "ses_1",
  providerID: "deepseek",
  modelID: "deepseek-chat",
  assistantCreatedAt: 1_000,
}

const FACT = {
  requestID: "req_1",
  providerID: "deepseek",
  modelID: "deepseek-chat",
  protocol: "h2",
  pinned: null as string | null,
  at: 2_000,
}

describe("protocolRow", () => {
  test("names the rung of the current turn's fact", () => {
    expect(protocolRow({ req_1: FACT }, CURRENT)).toBe("h2")
  })
  test("unknown when no fact, never blank", () => {
    expect(protocolRow({}, CURRENT)).toBe("unknown")
    expect(protocolRow({}, CURRENT).length).toBeGreaterThan(0)
  })
  test("a fact for another provider or model does not answer", () => {
    expect(protocolRow({ req_1: { ...FACT, providerID: "other" } }, CURRENT)).toBe("unknown")
    expect(protocolRow({ req_1: { ...FACT, modelID: "other" } }, CURRENT)).toBe("unknown")
  })
  test("a stale fact (before the turn started) does not answer", () => {
    expect(protocolRow({ req_1: { ...FACT, at: 500 } }, CURRENT)).toBe("unknown")
  })
  test("a non-rung protocol reads as unknown", () => {
    expect(protocolRow({ req_1: { ...FACT, protocol: "warp" } }, CURRENT)).toBe("unknown")
  })
})

describe("protocolPinned", () => {
  test("returns the pinned rung when present", () => {
    expect(protocolPinned({ req_1: { ...FACT, pinned: "h2" } }, CURRENT)).toBe("h2")
  })
  test("undefined without a pin", () => {
    expect(protocolPinned({ req_1: FACT }, CURRENT)).toBeUndefined()
    expect(protocolPinned({}, CURRENT)).toBeUndefined()
  })
})

describe("protocolLabel", () => {
  test("a configured mode names the cell", () => {
    expect(protocolLabel("h2", "h3")).toBe("⇅ h2")
  })
  test("auto shows the pin when the route is pinned", () => {
    expect(protocolLabel("auto", "h2", "h2")).toBe("⇅ h2")
  })
  test("auto wraps the measured rung only while unpinned", () => {
    expect(protocolLabel("auto", "h2")).toBe("⇅ auto(h2)")
  })
  test("never empty: auto without a measurement reads auto(unknown)", () => {
    expect(protocolLabel("auto", undefined)).toBe("⇅ auto(unknown)")
    expect(protocolLabel(undefined, undefined)).toBe("⇅ auto(unknown)")
  })
})

describe("connectionBadge", () => {
  test("a warm pool reads connected", () => {
    expect(connectionBadge(3)).toBe("●")
  })
  test("zero or missing reads disconnected, never blank", () => {
    expect(connectionBadge(0)).toBe("○")
    expect(connectionBadge(undefined)).toBe("○")
  })
})

describe("acceptProtocolFact", () => {
  test("accepts a well-formed bus payload", () => {
    const fact = acceptProtocolFact({
      requestID: "req_1",
      providerID: "deepseek",
      modelID: "deepseek-chat",
      protocol: "h2",
      at: 2_000,
    })
    expect(fact?.protocol).toBe("h2")
  })
  test("rejects payloads that cannot answer", () => {
    expect(acceptProtocolFact({ providerID: "x", modelID: "y", protocol: "h2", at: 1 })).toBeUndefined()
    expect(acceptProtocolFact({ requestID: "r", providerID: "x", modelID: "y", protocol: "warp", at: 1 })).toBeUndefined()
    expect(acceptProtocolFact({ requestID: "r", providerID: "x", modelID: "y", protocol: "h2" })).toBeUndefined()
    expect(acceptProtocolFact(null)).toBeUndefined()
  })
})
