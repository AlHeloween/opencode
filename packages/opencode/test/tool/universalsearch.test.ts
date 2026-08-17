import { describe, expect, test } from "bun:test"
import { researcherWebOnly } from "@/tool/universalsearch"

describe("tool.universalsearch", () => {
  test("researcher requires explicit web source before execution", () => {
    expect(researcherWebOnly("researcher_agent", { source: "web" })).toBe(true)
    expect(researcherWebOnly("researcher_agent", {})).toBe(false)
    expect(researcherWebOnly("researcher_agent", { source: "agent" })).toBe(false)
    expect(researcherWebOnly("researcher_agent", { source: "code" })).toBe(false)
    expect(researcherWebOnly("researcher_agent", { source: "hybrid" })).toBe(false)
    expect(researcherWebOnly("build_mode", {})).toBe(true)
  })
})
