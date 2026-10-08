import { describe, expect, test } from "bun:test"
import { describeMcpStatus } from "../../src/cli/cmd/tui/component/mcp-dialog-state"

/**
 * The /mcps row description is the only place a user learns WHICH key acts on a state:
 * `needs_auth` is useless without «ctrl+a» next to it. These are the three exact spellings
 * the server emits (`src/mcp/index.ts:74-97`); the rest must pass through untouched.
 */
describe("describeMcpStatus", () => {
  test("names the action key for both auth states", () => {
    expect(describeMcpStatus({ status: "needs_auth" })).toBe("needs authentication — ctrl+a")
    expect(describeMcpStatus({ status: "needs_client_registration" })).toBe(
      "needs client registration — ctrl+a",
    )
  })

  test("surfaces the server's failure text, and says so when it is missing", () => {
    expect(describeMcpStatus({ status: "failed", error: "connect ECONNREFUSED" })).toBe(
      "failed: connect ECONNREFUSED",
    )
    expect(describeMcpStatus({ status: "failed" })).toBe("failed: unknown error")
  })

  test("passes through the plain states unchanged", () => {
    expect(describeMcpStatus({ status: "connected" })).toBe("connected")
    expect(describeMcpStatus({ status: "disabled" })).toBe("disabled")
  })

  test("degrades an unknown status to its own string instead of throwing", () => {
    // This runs inside a createMemo while rendering — a throw here kills the TUI,
    // so an unrecognized future status must render SOMETHING.
    expect(describeMcpStatus({ status: "reconnecting" })).toBe("reconnecting")
  })
})
