import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { readModelsCache } from "../../src/provider/models"

// Requirement (plan robot-installer B4, measured 2026-10-07): on a FRESH install the models cache does not exist yet;
// that is the expected first start, not a defect — yet the compiled robot printed «Bugs encountered (1): bug-0001
// failed to read models json» to a client after `providers login --key-stdin`. A missing cache is debug; a cache that
// exists and cannot be read stays a bug.

let dir: string
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "models-cache-"))
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const count = () => Log.bugReport().find((b) => b.message === "failed to read models json")?.count ?? 0

describe("readModelsCache", () => {
  test("a missing cache is the expected first start — no bug recorded", async () => {
    const before = count()
    expect(await readModelsCache(path.join(dir, "models.json"))).toBeUndefined()
    expect(count()).toBe(before)
  })

  test("a cache that exists but is broken is still a bug", async () => {
    const file = path.join(dir, "broken.json")
    await fs.writeFile(file, "{ not json")
    const before = count()
    expect(await readModelsCache(file)).toBeUndefined()
    expect(count()).toBe(before + 1)
  })
})
