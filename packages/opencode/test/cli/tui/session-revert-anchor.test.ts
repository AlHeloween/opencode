import { describe, expect, test } from "bun:test"
import { revertAnchorID } from "@/cli/cmd/tui/routes/session/session-revert"

const msgs = [
  { id: "u1", role: "user" },
  { id: "a1", role: "assistant" },
  { id: "u2", role: "user" },
  { id: "a2", role: "assistant" },
]

describe("revertAnchorID (t98: dialog addresses the user anchor)", () => {
  test("a user target anchors to itself", () => {
    expect(revertAnchorID(msgs, "u2")).toBe("u2")
    expect(revertAnchorID(msgs, "u1")).toBe("u1")
  })
  test("an assistant target folds to its parent user", () => {
    expect(revertAnchorID(msgs, "a2")).toBe("u2")
    expect(revertAnchorID(msgs, "a1")).toBe("u1")
  })
  test("an assistant with no prior user anchors to itself (server fallback)", () => {
    expect(revertAnchorID([{ id: "a0", role: "assistant" }], "a0")).toBe("a0")
  })
  test("an unknown id passes through (server reports it, handler refuses)", () => {
    expect(revertAnchorID(msgs, "ghost")).toBe("ghost")
  })
})
