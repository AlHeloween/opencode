import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { MemoryTool, Parameters } from "../../src/tool/memory"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test-memory"),
  messageID: MessageID.make("msg_test-memory"),
  agent: "reasoning",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

const run = Effect.fn("MemoryToolTest.run")(function* (args: Tool.InferParameters<typeof MemoryTool>) {
  const info = yield* MemoryTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

describe("tool.memory", () => {
  it.live(
    "reads an empty project-local notebook without creating it",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const result = yield* run({ action: "read" })

        expect(result.title).toBe("Memory (empty)")
        expect(result.output).toContain("No reasoning memory yet")
        expect(yield* Effect.promise(() => Bun.file(path.join(dir, ".opencode/data/memory/reasoning.md")).exists())).toBe(false)
      }),
    ),
  )

  it.live(
    "writes, appends, and reads the project-local notebook",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* run({ action: "write", content: "first insight" })
        yield* run({ action: "append", content: "second insight" })
        const result = yield* run({ action: "read" })

        expect(result.output).toBe("first insight\nsecond insight\n")
        expect(result.metadata.filepath).toBe(path.join(dir, ".opencode/data/memory/reasoning.md"))
      }),
    ),
  )

  it.live(
    "allows an explicit empty write to clear the notebook",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        yield* run({ action: "write", content: "existing insight" })
        yield* run({ action: "write", content: "" })

        expect((yield* run({ action: "read" })).output).toBe("")
      }),
    ),
  )

  it.effect("rejects unsupported actions", () =>
    Effect.gen(function* () {
      const exit = yield* Schema.decodeUnknownEffect(Parameters)({ action: "remove" }).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )
})
