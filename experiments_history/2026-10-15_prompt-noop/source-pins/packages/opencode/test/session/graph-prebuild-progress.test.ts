import { expect, setDefaultTimeout, test } from "bun:test"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import { syncCodegraphIndex } from "@/session/graph-prebuild"
import { resolveCodegraphBin } from "@/config/codegraph-mcp-auto"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(20_000)

test.each(["complete", "cancel"])("codegraph sync leaves the event loop available: %s", async (mode) => {
  await using stand = await tmpdir()
  const fixture = path.resolve(import.meta.dir, "../mcp/fixture/held-graph-sync.ts")
  const binary = path.join(stand.path, process.platform === "win32" ? "codegraph.cmd" : "codegraph")
  await fs.writeFile(
    binary,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${fixture}"\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${fixture}'\n`,
    { mode: 0o755 },
  )
  const env = { ...process.env, PATH: stand.path + path.delimiter + process.env.PATH }
  expect(resolveCodegraphBin(env)?.toLowerCase()).toBe(binary.toLowerCase())
  let settled = false
  const controller = new AbortController()
  const pending = Effect.runPromise(syncCodegraphIndex(stand.path, env), { signal: controller.signal })
    .then(
      (result) => ({ result }),
      (error) => {
        console.debug("sync interrupted", String(error))
        return { interrupted: true }
      },
    )
    .finally(() => {
      settled = true
    })
  const deadline = Date.now() + 10_000
  while (!existsSync(path.join(stand.path, "sync-entered"))) {
    if (Date.now() > deadline) throw new Error("sync fixture did not start")
    await Bun.sleep(10)
  }
  const responsive = !settled
  if (mode === "cancel") {
    const { pid } = JSON.parse(await fs.readFile(path.join(stand.path, "sync-entered"), "utf8")) as { pid: number }
    controller.abort()
    expect(await pending).toEqual({ interrupted: true })
    expect(() => process.kill(pid, 0)).toThrow()
    expect(responsive).toBe(true)
    return
  }
  await fs.writeFile(path.join(stand.path, "sync-release"), "continue")
  const result = await pending
  expect(responsive).toBe(true)
  expect(result).toEqual({ result: true })
})
