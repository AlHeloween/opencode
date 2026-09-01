import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"

const agentTs = path.resolve(import.meta.dir, "../../src/agent/agent.ts")

describe("agent identity prompts", () => {
  test("agent generate streamObject logs errors instead of swallowing them", () => {
    const text = fs.readFileSync(agentTs, "utf8")
    expect(text).not.toMatch(/onError:\s*\(\)\s*=>\s*\{\s*\}/)
    expect(text).toMatch(/onError:\s*\(error\)\s*=>\s*\{/)
    expect(text).toContain("streamObject agent generate failed")
  })
})
