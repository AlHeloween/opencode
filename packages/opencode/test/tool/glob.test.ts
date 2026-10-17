import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { GlobTool } from "../../src/tool/glob"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.glob", () => {
  it.live("matches files from a directory path", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "a.ts"), "export const a = 1\n"))
        yield* Effect.promise(() => Bun.write(path.join(dir, "b.txt"), "hello\n"))
        const info = yield* GlobTool
        const glob = yield* info.init()
        const result = yield* glob.execute(
          {
            pattern: "*.ts",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.count).toBe(1)
        expect(result.output).toContain(path.join(dir, "a.ts"))
        expect(result.output).not.toContain(path.join(dir, "b.txt"))
      }),
    ),
  )

  it.live("rejects exact file paths", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "a.ts")
        yield* Effect.promise(() => Bun.write(file, "export const a = 1\n"))
        const info = yield* GlobTool
        const glob = yield* info.init()
        const exit = yield* glob
          .execute(
            {
              pattern: "*.ts",
              path: file,
            },
            ctx,
          )
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = Cause.squash(exit.cause)
          expect(err instanceof Error ? err.message : String(err)).toContain("glob path must be a directory")
        }
      }),
    ),
  )
  // t85: path-less glob at worktree root must skip heavy data dirs.
  it.live("excludes heavy data dirs on worktree-root-wide glob", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const mkdirp = (p: string) =>
          Effect.promise(() => import("node:fs/promises").then((m) => m.mkdir(p, { recursive: true })))
        yield* Effect.promise(() => Bun.write(path.join(dir, "keep.ts"), "export const k = 1\n"))
        const heavies = [".opencode/data/skip.ts", "logs/skip.ts", "node_modules/skip.ts"]
        for (const rel of heavies) {
          const full = path.join(dir, rel)
          yield* mkdirp(path.dirname(full))
          yield* Effect.promise(() => Bun.write(full, "export const h = 1\n"))
        }
        const info = yield* GlobTool
        const glob = yield* info.init()
        const rootWide = yield* glob.execute({ pattern: "*.ts" }, ctx)
        expect(rootWide.output).toContain(path.join(dir, "keep.ts"))
        for (const rel of heavies) {
          expect(rootWide.output).not.toContain(path.join(dir, rel))
        }
        const named = yield* glob.execute({ pattern: "*.ts", path: path.join(dir, "logs") }, ctx)
        expect(named.output).toContain(path.join(dir, "logs", "skip.ts"))
      }),
    ),
  )
})
