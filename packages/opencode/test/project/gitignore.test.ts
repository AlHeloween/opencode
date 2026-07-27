import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import { ensureRuntimeDataIgnored, isRuntimeDataPath } from "@/project/gitignore"

const live = AppFileSystem.layer.pipe(Layer.provide(NodeFileSystem.layer))

describe("ProjectGitignore", () => {
  test("adds every default ignore when one already exists and stays idempotent", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gitignore-"))
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* AppFileSystem.Service
          const file = path.join(worktree, ".gitignore")
          yield* fs.writeFileString(file, ".temp\n")

          yield* ensureRuntimeDataIgnored(fs, worktree)
          yield* ensureRuntimeDataIgnored(fs, worktree)

          expect(yield* fs.readFileString(file)).toBe(".temp\n.opencode/data\n.codegraph\n/config.json\n")
        }).pipe(Effect.provide(live)),
      )
    } finally {
      await fs.rm(worktree, { recursive: true, force: true })
    }
  })

  test("adds all entries to an empty file and accepts existing root and legacy config ignores", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gitignore-"))
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* AppFileSystem.Service
          const file = path.join(worktree, ".gitignore")

          yield* ensureRuntimeDataIgnored(fs, worktree)
          expect(yield* fs.readFileString(file)).toBe(".opencode/data\n.temp\n.codegraph\n/config.json\n")

          yield* fs.writeFileString(file, "/config.json\n")
          yield* ensureRuntimeDataIgnored(fs, worktree)
          expect(yield* fs.readFileString(file)).toBe("/config.json\n.opencode/data\n.temp\n.codegraph\n")

          yield* fs.writeFileString(file, "config.json\n")
          yield* ensureRuntimeDataIgnored(fs, worktree)
          expect(yield* fs.readFileString(file)).toBe("config.json\n.opencode/data\n.temp\n.codegraph\n")
        }).pipe(Effect.provide(live)),
      )
    } finally {
      await fs.rm(worktree, { recursive: true, force: true })
    }
  })

  test("recognizes root config as a local runtime path", () => {
    expect(isRuntimeDataPath("config.json")).toBe(true)
    expect(isRuntimeDataPath("nested/config.json")).toBe(false)
  })
})
