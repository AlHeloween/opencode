import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Database } from "@/storage/db"

describe("Database.Path", () => {
  test("returns opencode.db path", () => {
    expect(Database.Path).toBe(path.join(Global.Path.data, "opencode.db"))
  })
})
