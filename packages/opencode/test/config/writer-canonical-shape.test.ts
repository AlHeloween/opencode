import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"

// 2026-09-02 (Alexander): the routing dialog wrote the SAME setting to TWO
// positions — global scope → top-level agent.<name>.routing
// (writeGlobalAgentField), worktree scope → agent.<name>.options.routing
// (PATCH /config). The runtime reads options.routing only; the duplicate
// silently shadowed and both blocks coexisted in the user's config forever.
// This tripwire keeps every routing writer on the ONE canonical shape —
// reintroducing a second spelling fails CI, not the user's config file.

const local = readFileSync(
  path.join(import.meta.dir, "../../src/cli/cmd/tui/context/local.tsx"),
  "utf-8",
)

describe("routing writer canonical shape (source contract)", () => {
  test("writeGlobalAgentField never writes top-level agent routing", () => {
    expect(local).not.toMatch(/agentConfig\.routing\s*=/)
  })

  test("global branch writes options.routing", () => {
    expect(local).toMatch(/\{\s*options:\s*\{\s*routing\s*\}\s*\}/)
  })

  test("worktree branch patches options.routing", () => {
    expect(local).toMatch(/options:\s*\{\s*routing:\s*routing \?\? null\s*\}/)
  })
})
