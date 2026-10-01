import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { CompareTool } from "../../src/tool/compare"
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
 * `compare` had NO test file at all while its description made three claims a reader acts on:
 * differences are decided by SIZE and MTIME; `same` is listed only under `verbose`; the noise list is
 * fixed and not configurable.
 *
 * The middle claim is the load-bearing one, and it is the sentence CORRECTED on 2026-10-01 from a
 * false «same — identical»: two byte-identical files whose timestamps differ report as `changed`, so
 * `same` never means «same content». Nothing pinned either the true or the false version until now,
 * which is exactly how the false one survived.
 *
 * The timestamps are SET, not hoped for. Two files written in sequence usually differ, but «usually»
 * is the clock talking — this file would then be measuring mtime granularity, not the tool.
 */
setDefaultTimeout(30_000)

const ctx = {
  sessionID: SessionID.make("ses_test-compare-session"),
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

const run = Effect.fn("CompareToolTest.run")(function* (
  args: Tool.InferParameters<typeof CompareTool>,
  next: Tool.Context = ctx,
) {
  const info = yield* CompareTool
  const tool = yield* info.init()
  return yield* tool.execute(args, next)
})

const T = new Date("2026-01-02T03:04:05Z")
const LATER = new Date("2026-01-02T03:04:06Z")
const BYTES = "identical bytes\n"

const pair = (dir: string) =>
  Effect.promise(async () => {
    const a = path.join(dir, "a")
    const b = path.join(dir, "b")
    await fs.mkdir(a, { recursive: true })
    await fs.mkdir(b, { recursive: true })
    return { a, b }
  })

describe("tool.compare — differences are metadata, never content", () => {
  it.live("calls two byte-identical files `changed` when their mtimes differ, and never `same`", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const { a, b } = yield* pair(dir)
        yield* Effect.promise(() => fs.writeFile(path.join(a, "twin.txt"), BYTES, "utf-8"))
        yield* Effect.promise(() => fs.writeFile(path.join(b, "twin.txt"), BYTES, "utf-8"))
        yield* Effect.promise(() => fs.utimes(path.join(a, "twin.txt"), T, T))
        yield* Effect.promise(() => fs.utimes(path.join(b, "twin.txt"), LATER, LATER))

        const result = yield* run({ pathA: a, pathB: b })

        // The claim, in the tool's own counters: identical bytes, different stamp, nothing read.
        expect(result.metadata.changed).toBe(1)
        expect(result.metadata.same).toBe(0)
        // …and the reader is told so in the listing, not only in metadata a caller may ignore.
        expect(result.output).toContain("--- Changed (1) ---")
        expect(result.output).toContain("twin.txt")
      }),
    ),
  )

  it.live("counts a twin as `same` and lists it ONLY under `verbose`", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const { a, b } = yield* pair(dir)
        yield* Effect.promise(() => fs.writeFile(path.join(a, "twin.txt"), BYTES, "utf-8"))
        yield* Effect.promise(() => fs.writeFile(path.join(b, "twin.txt"), BYTES, "utf-8"))
        yield* Effect.promise(() => fs.utimes(path.join(a, "twin.txt"), T, T))
        yield* Effect.promise(() => fs.utimes(path.join(b, "twin.txt"), T, T))

        const quiet = yield* run({ pathA: a, pathB: b })
        expect(quiet.metadata.same).toBe(1)
        expect(quiet.metadata.changed).toBe(0)
        // Counted, but not listed: the file name appears NOWHERE in the quiet output — which is also
        // what lets the line below mean something.
        expect(quiet.output).not.toContain("twin.txt")
        expect(quiet.output).toContain("Directories are identical.")

        const loud = yield* run({ pathA: a, pathB: b, verbose: true })
        expect(loud.output).toContain("--- Identical (1) ---")
        expect(loud.output).toContain("twin.txt")
      }),
    ),
  )

  it.live("skips its fixed noise list — a file under node_modules is not reported at all", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const { a, b } = yield* pair(dir)
        yield* Effect.promise(() => fs.mkdir(path.join(a, "node_modules", "pkg"), { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(a, "node_modules", "pkg", "x.js"), BYTES, "utf-8"))
        yield* Effect.promise(() => fs.writeFile(path.join(a, "kept.txt"), BYTES, "utf-8"))

        const result = yield* run({ pathA: a, pathB: b })

        // Both halves: the noise is gone AND the ordinary file beside it is still counted — a walk
        // that returned nothing at all would satisfy the absence alone.
        expect(result.output).not.toContain("x.js")
        expect(result.metadata.onlyA).toBe(1)
        expect(result.output).toContain("kept.txt")
      }),
    ),
  )
})
