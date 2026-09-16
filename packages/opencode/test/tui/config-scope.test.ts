import { describe, expect, test } from "bun:test"
import {
  coerceScope,
  cycleScope,
  inheritLabel,
  parentScope,
  readScope,
  SCOPE_ORDER,
  type ConfigScope,
} from "../../src/cli/cmd/tui/component/config-scope"

describe("config scope", () => {
  test("the fall-through chain matches local.forAgent resolution", () => {
    expect(parentScope("session")).toBe("worktree")
    expect(parentScope("worktree")).toBe("global")
    expect(parentScope("global")).toBeUndefined()
  })

  test("a garbage KV value degrades to the fallback instead of rendering an unknown scope", () => {
    // kv.json is shared across processes and hand-editable.
    expect(readScope("worktree")).toBe("worktree")
    expect(readScope("project")).toBe("session")
    expect(readScope(undefined)).toBe("session")
    expect(readScope(null, "global")).toBe("global")
    expect(readScope(42, "worktree")).toBe("worktree")
  })

  test("cycling wraps at both ends of the supported list", () => {
    expect(cycleScope("global", 1)).toBe("worktree")
    expect(cycleScope("worktree", 1)).toBe("session")
    expect(cycleScope("session", 1)).toBe("global")
    expect(cycleScope("global", -1)).toBe("session")
    expect(cycleScope("session", -1)).toBe("worktree")
  })

  test("an unsupported current scope enters at the first supported layer, skipping none", () => {
    // /settings has no session layer; entering it from a shared scope of
    // "session" must not compute index -1 + direction.
    const settings: ConfigScope[] = ["global", "worktree"]
    expect(cycleScope("session", 1, settings)).toBe("global")
    expect(cycleScope("session", -1, settings)).toBe("global")
    expect(cycleScope("global", 1, settings)).toBe("worktree")
    expect(cycleScope("worktree", 1, settings)).toBe("global")
  })

  test("a dialog that cannot write a layer falls through to the nearest one it can", () => {
    const settings: ConfigScope[] = ["global", "worktree"]
    expect(coerceScope("session", settings)).toBe("worktree")
    expect(coerceScope("worktree", settings)).toBe("worktree")
    expect(coerceScope("global", settings)).toBe("global")
    // Global-only surface: session walks the whole chain rather than landing
    // on the list head by accident.
    expect(coerceScope("session", ["global"])).toBe("global")
  })

  test("an empty layer names where the value comes from", () => {
    expect(inheritLabel("session")).toBe("inherits from worktree")
    expect(inheritLabel("worktree")).toBe("inherits from global")
    expect(inheritLabel("global")).toBe("no config default")
  })

  test("the selector order is widest layer first", () => {
    expect([...SCOPE_ORDER]).toEqual(["global", "worktree", "session"])
  })
})
