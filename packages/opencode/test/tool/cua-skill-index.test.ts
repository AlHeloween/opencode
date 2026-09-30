import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { cuaSkillIndex } from "../../src/tool/cua"

// The robot reads its own cua skill pack (Skills/cua-robot), not the vendor's networked one
// (plans/2026-09-30_cua-robot-skill-pack.md, K3). Real repository files — no fixture copy.
const worktree = path.resolve(import.meta.dir, "../../../..")
const pack = "external/cua/libs/cua-driver/rust/Skills/cua-robot"

describe("cua skill index", () => {
  test("lists the robot pack and nothing from the vendor pack", () => {
    const index = cuaSkillIndex(worktree)
    for (const file of ["SKILL.md", "WINDOWS.md", "TIERS.md", "RUNTIME.md", "DATA_ENTRY.md"])
      expect(index).toContain(`${pack}/${file}`)
    expect(index).not.toContain("Skills/cua-driver/")
    expect(index.split("\n").every((line) => / — \S/.test(line))).toBe(true)
  })

  test("names the missing pack instead of returning an empty index", async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), "cua-skill-index-"))
    try {
      const index = cuaSkillIndex(empty)
      expect(index).toContain("not found")
      expect(index).toContain("cua-robot")
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})
