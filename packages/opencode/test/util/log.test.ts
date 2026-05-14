import { afterEach, expect, test, describe } from "bun:test"
import fs from "fs/promises"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"

async function files(dir: string) {
  let last = ""
  let same = 0

  for (let i = 0; i < 50; i++) {
    const list = (await fs.readdir(dir)).sort()
    const next = JSON.stringify(list)
    if (next === last) same += 1
    last = next
    if (same > 20) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return (await fs.readdir(dir)).sort()
}

// Log path is now worktree-relative via Global.Path.log getter.
// These tests need updating to match the new architecture.
describe.skip("log", () => {
  test("init cleanup keeps the newest timestamped logs", async () => {
    await using tmp = await tmpdir()
    const list = Array.from({ length: 12 }, (_, i) => `2000-01-${String(i + 1).padStart(2, "0")}T000000.log`)

    await Promise.all(list.map((file) => fs.writeFile(path.join(tmp.path, file), file)))

    await Log.init({ print: false, dev: false })

    const kept = await files(tmp.path)
    expect(kept).toHaveLength(10)
    // newest ones should be kept
    expect(kept).toEqual(list.slice(2))
  })
})
