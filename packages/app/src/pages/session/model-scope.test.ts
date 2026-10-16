import { describe, expect, test } from "bun:test"
import { availableScopes, readScope } from "./model-scope"

describe("readScope", () => {
  test("passes through known scopes", () => {
    expect(readScope("session")).toBe("session")
    expect(readScope("global")).toBe("global")
  })
  test("garbage degrades to the fallback, never an unknown scope", () => {
    expect(readScope("worktree")).toBe("session")
    expect(readScope(undefined)).toBe("session")
    expect(readScope("{\"$ne\":1}")).toBe("session")
  })
})

describe("availableScopes", () => {
  test("an open session offers session and global", () => {
    expect(availableScopes(true)).toEqual(["session", "global"])
  })
  test("with no session only global is offered — session would land nowhere", () => {
    expect(availableScopes(false)).toEqual(["global"])
  })
})
