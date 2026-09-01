import { describe, expect, test } from "bun:test"
import { researcherWebOnly, resolveSearchSource } from "@/tool/universalsearch"

describe("tool.universalsearch", () => {
  test("omitted source defaults to web", () => {
    expect(resolveSearchSource({})).toBe("web")
    expect(resolveSearchSource({ source: "code" })).toBe("code")
    expect(resolveSearchSource({ source: "agent" })).toBe("agent")
  })

  test("researcher may use default or explicit web, not other sources", () => {
    expect(researcherWebOnly("researcher_agent", { source: "web" })).toBe(true)
    expect(researcherWebOnly("researcher_agent", {})).toBe(true)
    expect(researcherWebOnly("researcher_agent", { source: "agent" })).toBe(false)
    expect(researcherWebOnly("researcher_agent", { source: "code" })).toBe(false)
    expect(researcherWebOnly("researcher_agent", { source: "hybrid" })).toBe(false)
    expect(researcherWebOnly("build_mode", {})).toBe(true)
  })
})
