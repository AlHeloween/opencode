import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { assertWindowsBuildPrerequisites } from "../../script/build-prerequisites"

const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture, { force: true, recursive: true })))
})

async function fixture(missing?: "core") {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-build-prerequisites-"))
  fixtures.push(root)
  const packageDir = path.join(root, "packages", "opencode")
  const files = [
    path.join(packageDir, "node_modules", "@opentui", "core", "package.json"),
    path.join(packageDir, "node_modules", "@opentui", "core-win32-x64", "package.json"),
    path.join(packageDir, "node_modules", "@parcel", "watcher", "package.json"),
    path.join(root, "packages", "opentui", "packages", "core-win32-x64", "opentui.dll"),
    path.join(root, "packages", "opentui", "packages", "core-win32-x64", "index.js"),
    path.join(root, "packages", "opentui", "packages", "core-win32-x64", "package.json"),
  ]

  await Promise.all(
    files
      .filter((file) => missing !== "core" || !file.endsWith(path.join("@opentui", "core", "package.json")))
      .map(async (file) => {
        await mkdir(path.dirname(file), { recursive: true })
        await writeFile(file, "fixture")
      }),
  )
  return { packageDir }
}

describe("assertWindowsBuildPrerequisites", () => {
  test("accepts an installed current-platform build layout", async () => {
    const input = await fixture()
    expect(() => assertWindowsBuildPrerequisites(input.packageDir)).not.toThrow()
  })

  test("reports a missing local prerequisite without running a package manager", async () => {
    const input = await fixture("core")
    expect(() => assertWindowsBuildPrerequisites(input.packageDir)).toThrow("@opentui/core")
  })
})
