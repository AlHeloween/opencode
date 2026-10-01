import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { ListTool } from "../../src/tool/ls"
import { Instance } from "../../src/project/instance"
import { Ripgrep } from "../../src/file/ripgrep"
import { SessionID, MessageID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as Tool from "../../src/tool/tool"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"

/**
 * The promise this file exists for: `ls.txt` says «Cap: 100 entries (truncation notice on overflow)».
 *
 * Measured 2026-10-01 by reading `ls.ts`: `truncated` was computed and written to `metadata` ONLY —
 * nothing appended a notice to `output`. A listing that silently drops entries cannot support
 * «absent», which is the project's own rule, and it is how `list` once reported 100 entries with no
 * hint that more existed.
 *
 * BOTH halves are asserted on purpose. A notice that always fires is a cry wolf; a listing that
 * truncates in silence is the defect. So the count is checked BEFORE the notice: «TRUNCATED» on a
 * listing nobody truncated would pass a one-sided test.
 */
setDefaultTimeout(30_000)

const ctx = {
  sessionID: SessionID.make("ses_test-list-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const run = Effect.fn("ListToolTest.run")(function* (
  args: Tool.InferParameters<typeof ListTool>,
  next: Tool.Context = ctx,
) {
  const info = yield* ListTool
  const tool = yield* info.init()
  return yield* tool.execute(args, next)
})

describe("tool.list — the truncation notice", () => {
  it.live("says so IN THE OUTPUT when the cap really cut the tree", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          Array.from({ length: 120 }, (_, i) => i),
          (i) =>
            Effect.promise(() =>
              fs.writeFile(path.join(dir, `f${String(i).padStart(3, "0")}.txt`), "x", "utf-8"),
            ),
          { concurrency: 16, discard: true },
        )

        const result = yield* run({ path: dir })

        // The cut is REAL first…
        expect(result.metadata.truncated).toBe(true)
        expect(result.metadata.count).toBe(100)
        // …and only then is the notice owed.
        expect(result.output).toContain("TRUNCATED")
      }),
    ),
  )

  it.live("stays silent when nothing was cut", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "only.txt"), "x", "utf-8"))

        const result = yield* run({ path: dir })

        expect(result.metadata.truncated).toBe(false)
        expect(result.output).not.toContain("TRUNCATED")
      }),
    ),
  )
})
