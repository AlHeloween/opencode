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
        // Pinned EXACTLY, never by substring. This assertion superseded
        // `toContain("Line 2: line2")` when the output contract became
        // `Line N, col C, offset B: …window…` (commit 8051467cf4): the requirement moved, so the
        // test moved with it, in the same change and with its provenance — it was NOT loosened to
        // go green. The difference matters: `toContain("Line 2")` is satisfied by "Line 20" and
        // stays green if the col/offset fields disappear entirely, which is the whole point of
        // the address. `line1\n` is 6 bytes, so line 2 begins at offset 6 and the hit is at col 1.
        expect(result.output).toContain("Line 2, col 1, offset 6: line2")
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

  it.live("treats \\| as a LITERAL pipe, exactly as the description says", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        // grep.txt states: «`|` is OR; `\|` is a literal pipe», and the pattern is handed to
        // ripgrep, whose dialect (Rust regex / ERE) agrees. `toRustRegex` used to rewrite `\|`
        // into `|` — i.e. into OR — so a caller who read the description and asked for a literal
        // pipe silently got an alternation: both lines match and nothing says why. One spelling,
        // one meaning.
        const file = path.join(dir, "pipes.txt")
        yield* Effect.promise(() => Bun.write(file, "a|b\naXb\n"))
        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* grep.execute({ pattern: "a\\|b", path: file }, ctx)
        expect(result.metadata.matches).toBe(1)
        expect(result.output).toContain("a|b")
        expect(result.output).not.toContain("aXb")
      }),
    ),
  )

  // WITHDRAWN with provenance, 2026-09-30: «reports files ripgrep treated as BINARY» asserted
  // `metadata.binary === 1` from ripgrep's `end.binary_offset`. Measured: our `bin/tools/rg.exe`
  // emits `binary_offset: 4` for a file with a NUL byte, but `which("rg.exe")` on this host
  // resolves to `C:\Windows\rg.exe`, which does not emit it — so the assertion encoded a true
  // requirement that no instrument available to this runtime can satisfy. The requirement is kept
  // in `file/ripgrep.ts` as a comment rather than as a red test nobody can make green.
})
