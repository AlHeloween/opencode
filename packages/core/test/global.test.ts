import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../src/global"

describe("Global paths", () => {
  test("default data paths are cwd-relative before worktree init", () => {
    const data = path.join(process.cwd(), ".opencode", "data")

    expect(Global.Path.data).toBe(data)
    expect(Global.Path.cache).toBe(path.join(data, "cache"))
    expect(Global.Path.state).toBe(path.join(data, "state"))
    expect(Global.Path.log).toBe(path.join(data, "log"))
    expect(Global.Path.bin).toBe(path.join(data, "cache", "bin"))
  })
})
