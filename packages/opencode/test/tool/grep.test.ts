import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
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

const root = path.join(__dirname, "../..")

describe("tool.grep", () => {
  it.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(root)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(root, "src/tool"),
            include: "*.ts",
          },
          ctx,
        ),
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("Found")
    }),
  )

  it.live("no matches returns correct output", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "test.txt"), "hello world"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "xyznonexistentpatternxyz123",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No matches found")
      }),
    ),
  )

  it.live("finds matches in tmp instance", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => Bun.write(path.join(dir, "test.txt"), "line1\nline2\nline3"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "line",
            path: dir,
          },
          ctx,
        )
        expect(result.metadata.matches).toBeGreaterThan(0)
      }),
    ),
  )

  it.live("supports exact file paths", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = path.join(dir, "test.txt")
        yield* Effect.promise(() => Bun.write(file, "line1\nline2\nline3"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute(
          {
            pattern: "line2",
            path: file,
          },
          ctx,
        )
        expect(result.metadata.matches).toBe(1)
        expect(result.output).toContain(file)
        expect(result.output).toContain("Line 2")
        expect(result.output).toContain("line2")
      }),
    ),
  )

  it.live("reports line, column, offset and a BOUNDED window around the match", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // One 5 921-char line with the match at char 5 000 — the shape of a minified
        // bundle, where a single line is megabytes. The previous implementation printed
        // `substring(0, MAX_LINE_LENGTH)`, anchored at the LINE START, so for this input
        // it emitted 2 000 chars that did NOT contain the match while still reporting
        // one. An absence and a false presence from the same anchor error.
        const file = path.join(dir, "bundle.js")
        const content = "x".repeat(5000) + "NEEDLE_IN_THE_DEEP" + "y".repeat(900) + "\nsecond\n"
        yield* Effect.promise(() => Bun.write(file, content))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute({ pattern: "NEEDLE_IN_THE_DEEP", path: file }, ctx)

        expect(result.metadata.matches).toBe(1)
        // the match itself must be IN the output
        expect(result.output).toContain("NEEDLE_IN_THE_DEEP")
        // and the window must be bounded, not the 5 000 chars that precede it
        const line = result.output.split("\n").find((l) => l.includes("NEEDLE_IN_THE_DEEP"))
        expect(line).toBeDefined()
        expect(line!.length).toBeLessThan(700)
        // the address, not a verdict: line, column and the match's byte offset in the file
        expect(line).toContain("Line 1")
        expect(line).toContain("col 5001")
        expect(line).toContain("offset 5000")
        // a clip is SHOWN, never implied
        expect(line).toContain("\u2026")
      }),
    ),
  )
})
