import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { MessageID, SessionID } from "../../src/session/schema"
import { TreeDiffTool, diffTrees, gitNoIndexArgs } from "../../src/tool/treediff"
import { Truncate } from "../../src/tool/truncate"
import type { Tool } from "../../src/tool/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer))

async function trees() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-treediff-"))
  const left = path.join(root, "left")
  const right = path.join(root, "right")
  await Promise.all([fs.mkdir(left), fs.mkdir(right)])
  await Promise.all([
    Bun.write(path.join(left, "same.txt"), "same\n"),
    Bun.write(path.join(right, "same.txt"), "same\n"),
    Bun.write(path.join(left, "changed.txt"), "before\n"),
    Bun.write(path.join(right, "changed.txt"), "after\nmore\n"),
    Bun.write(path.join(left, "left-only.txt"), "left\n"),
    Bun.write(path.join(right, "right-only.txt"), "right\n"),
  ])
  return { root, left, right }
}

describe("tool.treediff", () => {
  it.live(
    "resolves relative directory trees and returns tool metadata",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const left = path.join(dir, "left")
          const right = path.join(dir, "right")
          yield* Effect.promise(() => Promise.all([fs.mkdir(left), fs.mkdir(right)]))
          yield* Effect.promise(() => Promise.all([Bun.write(path.join(left, "x.txt"), "left\n"), Bun.write(path.join(right, "x.txt"), "right\n")]))
          const requests: unknown[] = []
          const ctx: Tool.Context = {
            sessionID: SessionID.make("ses_treediff"),
            messageID: MessageID.make(""),
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => Effect.void,
            ask: (request) => Effect.sync(() => void requests.push(request)),
          }
          const info = yield* TreeDiffTool
          const tool = yield* info.init()
          const result = yield* tool.execute({ pathA: "left", pathB: "right", mode: "names" }, ctx)
          expect(result.metadata.different).toBe(true)
          expect(result.output).toContain("x.txt")
          expect(requests).toHaveLength(1)
          const missing = yield* tool.execute({ pathA: "left", pathB: "missing", mode: "names" }, ctx)
          expect(missing.metadata.error).toContain("directory not found")
          expect(missing.output).toContain("tree diff failed")
        }),
      ),
    15_000,
  )

  test("treats Git's difference exit code as a successful names result", async () => {
    const fixture = await trees()
    try {
      const result = await diffTrees({ pathA: fixture.left, pathB: fixture.right, mode: "names" })
      expect(result.different).toBe(true)
      expect(result.output).toContain("changed.txt")
      expect(result.output).toContain("left-only.txt")
      expect(result.output).toContain("right-only.txt")
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true })
    }
  })

  test("returns numstat and a bounded unified patch for arbitrary directories", async () => {
    const fixture = await trees()
    try {
      const [numstat, patch] = await Promise.all([
        diffTrees({ pathA: fixture.left, pathB: fixture.right, mode: "numstat" }),
        diffTrees({ pathA: fixture.left, pathB: fixture.right, mode: "patch", context: 0 }),
      ])
      expect(numstat.output).toContain("changed.txt")
      expect(patch.output).toContain("@@")
      expect(patch.output).toContain("-before")
      expect(patch.output).toContain("+after")
      const args = gitNoIndexArgs({ pathA: "a", pathB: "b", mode: "patch", context: 999 })
      expect(args).toContain("--unified=100")
      expect(args).toContain("--no-textconv")
      expect(args).toContain("--")
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true })
    }
  })

})
