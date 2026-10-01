import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { EditTool } from "../../src/tool/edit"
import { chainHash, hashLabel } from "../../src/tool/read"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "@/lsp/lsp"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Format } from "../../src/format"
import { Truncate } from "@/tool/truncate"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/**
 * `edit` DRIVEN THROUGH ITS REAL LAYERS, as a BATCH (plan 2026-10-01_hash-addressed-edits, H6).
 *
 * The surface is one entry per file, and one file with one change is the same shape with one entry — so the
 * cases below read as «what a batch must do», not as «what a single edit must do plus a batch add-on».
 *
 * The property this file exists for is the one an in-file refusal cannot show: a failure in the SECOND file
 * must leave the FIRST untouched. Resolving everything before writing anything is what buys that, and a test
 * that only ever batches one file would not see it.
 *
 * Named so the loss is not silent — the cases that did NOT survive the move to addresses: the cascade-stage
 * cases (the cascade left the editing path) and the `exact` / `from` / `to` / `expect` cases (superseded by
 * the address itself). What an address MEANS is asserted where it can be asserted exactly: `resolveEdits` in
 * `edit-exact.test.ts` and the chain in `read-address.test.ts`, both pure.
 */

// FILE-level budget, and it is not decoration: every case here boots the LSP/format stack, and `edit` itself
// carries a 5 s diagnostics budget (`DIAGNOSTICS_BUDGET`) that the code names as the thing which once made this
// suite time out against bun's 5 000 ms default.
setDefaultTimeout(30_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const ctx = {
  sessionID: SessionID.make("ses_test-edit"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const edit = Effect.fn("EditTest.edit")(function* (dir: string, args: unknown) {
  const info = yield* EditTool
  const tool = yield* info.init()
  // `unknown` at the boundary ON PURPOSE: every case below crosses the tool's own schema, so a shape the
  // schema rejects fails here for the right reason instead of being waved through by a friendlier cast.
  return yield* provideInstance(dir)(tool.execute(args as never, ctx))
})

const put = (file: string, content: string) => Effect.promise(() => fs.writeFile(file, content))
const readBack = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

/**
 * Addresses for spans named by LINE NUMBERS. Production gets these from `read`; a test would rather say «line
 * 3» than paste a hash — and computing them with the SAME chain the tool uses keeps the test honest about the
 * contract instead of inventing a second spelling of it.
 */
const addresses = (content: string, spans: { line: number; to?: number; newString: string }[]) => {
  const lines = content.split("\n")
  const chain: number[] = []
  let running = 0
  for (const line of lines) chain.push((running = chainHash(running, line.endsWith("\r") ? line.slice(0, -1) : line)))
  return spans.map((span) => ({
    fromHash: hashLabel(span.line === 1 ? 0 : chain[span.line - 2]!),
    ...(span.to === undefined ? {} : { toHash: hashLabel(chain[span.to - 1]!) }),
    newString: span.newString,
  }))
}

/** A batch of one — the shape a single-file edit is, since one change IS a package of one. */
const oneFile = (file: string, content: string, spans: { line: number; to?: number; newString: string }[]) => ({
  files: [{ filePath: file, edits: addresses(content, spans) }],
})

describe("tool.edit — a batch of addressed changes, through the real layers", () => {
  it.live("one entry is a batch of one: one file, one change, untouched lines byte-identical", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "alpha\nbeta\ngamma\ndelta\n"
      const file = `${dir}/a.txt`
      yield* put(file, content)

      const result = yield* edit(dir, oneFile(file, content, [{ line: 2, to: 3, newString: "X" }]))

      expect(result.output).toContain("Edit applied successfully")
      expect(yield* readBack(file)).toBe("alpha\nX\ndelta\n")
    }),
  )

  it.live("two entries in ONE file, resolved against the ORIGINAL — the second is not moved by the first", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "one\ntwo\nthree\n"
      const file = `${dir}/b.txt`
      yield* put(file, content)

      yield* edit(dir, {
        files: [
          {
            filePath: file,
            edits: addresses(content, [
              { line: 2, newString: "SECOND-A\nSECOND-B" },
              { line: 3, newString: "THIRD" },
            ]),
          },
        ],
      })

      expect(yield* readBack(file)).toBe("one\nSECOND-A\nSECOND-B\nTHIRD\n")
    }),
  )

  it.live("a BATCH ACROSS TWO FILES lands in ONE call", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const first = "alpha\nbeta\n"
      const second = "one\ntwo\n"
      const a = `${dir}/a.txt`
      const b = `${dir}/b.txt`
      yield* put(a, first)
      yield* put(b, second)

      const result = yield* edit(dir, {
        files: [
          { filePath: a, edits: addresses(first, [{ line: 1, newString: "ALPHA" }]) },
          { filePath: b, edits: addresses(second, [{ line: 2, newString: "TWO" }]) },
        ],
      })

      expect(result.output).toContain("2 files")
      expect(yield* readBack(a)).toBe("ALPHA\nbeta\n")
      expect(yield* readBack(b)).toBe("one\nTWO\n")
    }),
  )

  it.live("a failure in the SECOND file writes NOTHING — the FIRST file is untouched", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const first = "alpha\nbeta\n"
      const second = "one\ntwo\n"
      const a = `${dir}/a.txt`
      const b = `${dir}/b.txt`
      yield* put(a, first)
      yield* put(b, second)

      const failed = yield* edit(dir, {
        files: [
          // This entry WOULD resolve on its own. The point of the case is that it must not be applied anyway.
          { filePath: a, edits: addresses(first, [{ line: 1, newString: "ALPHA" }]) },
          { filePath: b, edits: [{ fromHash: "deadbeef", newString: "TWO" }] },
        ],
      }).pipe(Effect.exit)

      expect(String(failed)).toContain("not in this file")
      expect(yield* readBack(a)).toBe(first)
      expect(yield* readBack(b)).toBe(second)
    }),
  )

  it.live("the SAME file twice in one call is refused — one entry carries all of a file's changes", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "one\ntwo\n"
      const file = `${dir}/c.txt`
      yield* put(file, content)

      const failed = yield* edit(dir, {
        files: [
          { filePath: file, edits: addresses(content, [{ line: 1, newString: "X" }]) },
          { filePath: file, edits: addresses(content, [{ line: 2, newString: "Y" }]) },
        ],
      }).pipe(Effect.exit)

      expect(String(failed)).toContain("name the same file")
      expect(yield* readBack(file)).toBe(content)
    }),
  )

  it.live("an address that does not resolve writes NOTHING — the refusal is total", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "keep\nme\n"
      const file = `${dir}/d.txt`
      yield* put(file, content)

      const failed = yield* edit(dir, {
        files: [
          {
            filePath: file,
            edits: [
              { fromHash: "deadbeef", newString: "X" },
              { fromHash: hashLabel(0), newString: "Y" },
            ],
          },
        ],
      }).pipe(Effect.exit)

      expect(String(failed)).toContain("not in this file")
      expect(yield* readBack(file)).toBe(content)
    }),
  )

  it.live("CRLF survives: the address resolves and the file keeps its OWN line endings", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "alpha\r\nbeta\r\n"
      const file = `${dir}/e.txt`
      yield* put(file, content)

      yield* edit(dir, oneFile(file, content, [{ line: 2, newString: "BETA" }]))

      expect(yield* readBack(file)).toBe("alpha\r\nBETA\r\n")
    }),
  )

  it.live("`content` creates a file, and refuses to overwrite an existing one", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/f.txt`

      yield* edit(dir, { files: [{ filePath: file, content: "hello\n" }] })
      expect(yield* readBack(file)).toBe("hello\n")

      const refused = yield* edit(dir, { files: [{ filePath: file, content: "other\n" }] }).pipe(Effect.exit)
      expect(String(refused)).toContain("already exists")
      expect(yield* readBack(file)).toBe("hello\n")
    }),
  )

  it.live("an entry with NEITHER `edits` nor `content` is refused by the tool's guard, which NAMES the entry", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/g.txt`
      yield* put(file, "alpha\n")

      const failed = yield* edit(dir, { files: [{ filePath: file }] }).pipe(Effect.exit)

      expect(String(failed)).toContain("pass `edits`")
      expect(String(failed)).toContain("files[0]")
    }),
  )
})
