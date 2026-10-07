import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveOwnTool } from "@/util/own-tool"

// Requirement (owner, 2026-10-07: «на бин указывают пути — но запуск робота делается из папки которая станет
// worktree»; plan robot-installer R1): the worktree is the folder the robot was started in (global.ts:8), so the
// robot's OWN tools must be found beside its executable, wherever it was started.

async function layout() {
  const root = await mkdtemp(path.join(os.tmpdir(), "own-tool-"))
  const exeDir = path.join(root, "install", "bin")
  const project = path.join(root, "client-project")
  await mkdir(project, { recursive: true })
  await mkdir(exeDir, { recursive: true })
  return { root, exeDir, project }
}

async function touch(file: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, "MZ")
}

const env = { PATH: "" } // no PATH: only the robot's own locations may answer

describe("resolveOwnTool — the robot's own tools resolve beside its executable", () => {
  test("installed robot started in a client project finds its tool beside the exe", async () => {
    const t = await layout()
    try {
      await touch(path.join(t.exeDir, "tools", "samply.exe"))
      const got = resolveOwnTool({ binary: "samply.exe", subdir: "tools", exeDir: t.exeDir, worktree: t.project, env })
      expect(got).toBe(path.join(t.exeDir, "tools", "samply.exe"))
    } finally {
      await rm(t.root, { recursive: true, force: true })
    }
  })

  test("the exe's own copy wins over a bin/ inside the project", async () => {
    const t = await layout()
    try {
      await touch(path.join(t.exeDir, "cua", "cua-driver.exe"))
      await touch(path.join(t.project, "bin", "cua", "cua-driver.exe"))
      const got = resolveOwnTool({ binary: "cua-driver.exe", subdir: "cua", exeDir: t.exeDir, worktree: t.project, env })
      expect(got).toBe(path.join(t.exeDir, "cua", "cua-driver.exe"))
    } finally {
      await rm(t.root, { recursive: true, force: true })
    }
  })

  test("running from source (the exe is bun, nothing beside it) falls back to {worktree}/bin/<subdir>", async () => {
    const t = await layout()
    try {
      await touch(path.join(t.project, "bin", "tools", "samply.exe"))
      const got = resolveOwnTool({ binary: "samply.exe", subdir: "tools", exeDir: t.exeDir, worktree: t.project, env })
      expect(got).toBe(path.join(t.project, "bin", "tools", "samply.exe"))
    } finally {
      await rm(t.root, { recursive: true, force: true })
    }
  })

  test("found nowhere: the bare name, so the spawn error names the missing tool", async () => {
    const t = await layout()
    try {
      const got = resolveOwnTool({ binary: "samply.exe", subdir: "tools", exeDir: t.exeDir, worktree: t.project, env })
      expect(got).toBe("samply.exe")
    } finally {
      await rm(t.root, { recursive: true, force: true })
    }
  })
})
