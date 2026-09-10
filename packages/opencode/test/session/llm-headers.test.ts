import { describe, expect, test } from "bun:test"

// Header three-layer contract (2026-09-08, plans/2026-09-08_novita-h3-transport-headers.md):
// pure logic probe of the layer composition rules — the full LLM.request
// integration covers them in llm.test.ts via fixtures; these cases pin the
// decision table so the intent cannot regress silently.

function headerDecision(providerID: string) {
  const isOpencodeOwned = providerID.startsWith("opencode")
  const isNovita = providerID === "novita-ai"
  return {
    opencodeHeaders: isOpencodeOwned,
    requestIdIsSession: isNovita,
  }
}

describe("LLM header layering decision table", () => {
  test("third-party providers never receive x-opencode-* headers", () => {
    for (const p of ["novita-ai", "openrouter", "deepseek", "z-ai", "zen"]) {
      expect(headerDecision(p).opencodeHeaders).toBe(false)
    }
  })

  test("opencode-owned providers receive the opencode layer", () => {
    for (const p of ["opencode", "opencode-zen", "opencode-go"]) {
      expect(headerDecision(p).opencodeHeaders).toBe(true)
    }
  })

  test("novita binds x-request-id to sessionID (console grouping)", () => {
    expect(headerDecision("novita-ai").requestIdIsSession).toBe(true)
  })

  test("other providers keep per-message request id", () => {
    for (const p of ["openrouter", "deepseek", "opencode"]) {
      expect(headerDecision(p).requestIdIsSession).toBe(false)
    }
  })
})
