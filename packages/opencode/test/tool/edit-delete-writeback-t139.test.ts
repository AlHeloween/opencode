/**
 * t139 — the DELETE must leave the file on disk EXACTLY as intended, and the result must describe the file that is
 * really there.
 *
 * The incident (t137, `plans_completed/2026-10-22_edit-window-label-caller.md:90`): a line was deleted through the
 * documented empty `newString`, and `packages/opencode/src/tool/edit.ts` came back with its last two lines DUPLICATED
 * after a stray `)` — four junk lines and a syntax error at `edit.ts:986` — while the tool reported the write as done.
 * The tool's own report and the disk disagreed, and only the LSP noticed:
 *
 *   ERROR [986:1] Declaration or statement expected.      <- the file on disk: 989 lines
 *   Addresses for … (the file is now 985 lines)           <- the tool's model: 985 lines
 *
 * TWO properties are pinned here, because the incident has two halves:
 *
 * 1. **THE FILE ON DISK IS THE INTENDED TEXT.** A delete makes the file SHORTER; every case reads the file BACK and
 *    compares it byte for byte — the artefact, not the tool's opinion of it.
 * 2. **THE RESULT IS BUILT FROM WHAT IS ON DISK.** The report must name the file's REAL line count, and when the file on
 *    disk is not what the tool wrote, the tool must SAY so instead of claiming a clean success. A silent corruption
 *    reported as success is worse than any refusal (owner, 2026-10-18).
 *
 * The fixtures are `.txt` ON PURPOSE: the incident ran on a `.ts` file inside the repository, where a formatter is
 * enabled — and a formatter REWRITES the file, so the expected bytes would not be the bytes the tool wrote. A `.txt`
 * fixture has no formatter, so the bytes on disk are the bytes under test.
 */
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

setDefaultTimeout(30_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const ctx = {
  sessionID: SessionID.make("ses_test-t139"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const layers = Layer.mergeAll(
  Agent.defaultLayer,
  AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Format.defaultLayer,
  Bus.layer,
  LSP.defaultLayer,
  Truncate.defaultLayer,
)

const it = testEffect(layers)

/**
 * A formatter that REWRITES the file and then reports that no formatter ran — the shape of a file that is not what the
 * tool wrote, produced inside the tool's own flow, in a known place.
 */
const rewritingFormat = Layer.effect(
  Format.Service,
  Effect.succeed(
    Format.Service.of({
      init: () => Effect.void,
      status: () => Effect.succeed([]),
      file: (filepath: string) => Effect.promise(() => fs.appendFile(filepath, ")\n")).pipe(Effect.as(false)),
    }),
  ),
)

const itRewriting = testEffect(Layer.mergeAll(layers, rewritingFormat))

/** The tool, driven through its real layers. */
const edit = Effect.fn("EditTest.edit")(function* (dir: string, args: unknown) {
  const info = yield* EditTool
  const tool = yield* info.init()
  return yield* provideInstance(dir)(tool.execute(args as never, ctx))
})

const put = (file: string, content: string) => Effect.promise(() => fs.writeFile(file, content))
const readBack = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

/**
 * Addresses for spans named by LINE NUMBERS, computed with the SAME chain the tool uses — the test states a line, and
 * the tool sees a hash.
 */
const addresses = (content: string, spans: { line: number; to?: number; newString: string }[]) => {
  const lines = content.split("\n")
  const chain: number[] = []
  let running = 0
  for (const line of lines) chain.push((running = chainHash(running, line.endsWith("\r") ? line.slice(0, -1) : line)))
  return spans.map((span) => ({
    fromHash: hashLabel(chain[span.line - 1]!),
    ...(span.to === undefined ? {} : { toHash: hashLabel(chain[span.to - 1]!) }),
    newString: span.newString,
  }))
}

/** A file whose lines are DISTINCTIVE, so a surviving tail is visible in the failure message. */
const body = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n") + "\n"

/** The t137 shape: a file of the incident's scale, with the endings the repository's files carry. */
const bigLines = (count: number) => Array.from({ length: count }, (_, i) => `const line${i + 1} = ${i}`)
const big = (count: number, ending: string) => bigLines(count).join(ending) + ending
const bigWithout = (count: number, skip: number, ending: string) =>
  bigLines(count)
    .filter((_, i) => i !== skip - 1)
    .join(ending) + ending

describe("tool.edit — the delete leaves the file on disk exactly as intended", () => {
  it.live("a delete of the LAST line leaves the file byte-for-byte as intended", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = body(20)
      const file = `${dir}/a.txt`
      yield* put(file, content)

      yield* edit(dir, {
        files: [{ filePath: file, edits: addresses(content, [{ line: 20, newString: "" }]) }],
      })

      // The file, read back — the artefact, not the tool's model of it.
      expect(yield* readBack(file)).toBe(body(19))
    }),
  )

  it.live("a delete of the line BEFORE the end leaves the file byte-for-byte as intended", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = body(20)
      const file = `${dir}/b.txt`
      yield* put(file, content)

      yield* edit(dir, {
        files: [{ filePath: file, edits: addresses(content, [{ line: 19, newString: "" }]) }],
      })

      expect(yield* readBack(file)).toBe(
        body(20)
          .split("\n")
          .filter((_, i) => i !== 18)
          .join("\n"),
      )
    }),
  )

  it.live("a delete in the MIDDLE leaves the file byte-for-byte as intended", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = body(20)
      const file = `${dir}/c.txt`
      yield* put(file, content)

      yield* edit(dir, {
        files: [{ filePath: file, edits: addresses(content, [{ line: 10, newString: "" }]) }],
      })

      expect(yield* readBack(file)).toBe(
        body(20)
          .split("\n")
          .filter((_, i) => i !== 9)
          .join("\n"),
      )
    }),
  )

  it.live("a BATCH of deletes leaves every file byte-for-byte as intended", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const first = body(20)
      const second = body(12)
      const a = `${dir}/d.txt`
      const b = `${dir}/e.txt`
      yield* put(a, first)
      yield* put(b, second)

      yield* edit(dir, {
        files: [
          { filePath: a, edits: addresses(first, [{ line: 20, newString: "" }]) },
          { filePath: b, edits: addresses(second, [{ line: 3, newString: "" }]) },
        ],
      })

      expect(yield* readBack(a)).toBe(body(19))
      expect(yield* readBack(b)).toBe(
        body(12)
          .split("\n")
          .filter((_, i) => i !== 2)
          .join("\n"),
      )
    }),
  )

  it.live("a delete in a file of the t137 shape (986 lines, CRLF) lands byte-for-byte", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = big(986, "\r\n")
      const file = `${dir}/big-crlf.txt`
      yield* put(file, content)

      yield* edit(dir, {
        files: [{ filePath: file, edits: addresses(content, [{ line: 934, newString: "" }]) }],
      })

      expect(yield* readBack(file)).toBe(bigWithout(986, 934, "\r\n"))
    }),
  )

  it.live("a delete of the LAST line of that shape lands byte-for-byte", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = big(986, "\r\n")
      const file = `${dir}/big-crlf-end.txt`
      yield* put(file, content)

      yield* edit(dir, {
        files: [{ filePath: file, edits: addresses(content, [{ line: 986, newString: "" }]) }],
      })

      expect(yield* readBack(file)).toBe(bigWithout(986, 986, "\r\n"))
    }),
  )

  it.live("the same delete in a .ts file (a formatter is enabled there) lands byte-for-byte", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = big(986, "\n")
      const file = `${dir}/big.ts`
      yield* put(file, content)

      yield* edit(dir, {
        files: [{ filePath: file, edits: addresses(content, [{ line: 934, newString: "" }]) }],
      })

      expect(yield* readBack(file)).toBe(bigWithout(986, 934, "\n"))
    }),
  )
})

describe("tool.edit — the result is built from the file ON DISK", () => {
  itRewriting.live("a file that is not what the tool wrote is NAMED, not swallowed", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "one\ntwo\nthree\nfour\n"
      const file = `${dir}/target.txt`
      yield* put(file, content)

      const result = yield* edit(dir, {
        files: [{ filePath: file, edits: addresses(content, [{ line: 2, newString: "" }]) }],
      })

      // The file now holds what the rewriting writer put there.
      expect(yield* readBack(file)).toBe("one\nthree\nfour\n)\n")

      // The tool must NOT claim a clean success over a file it did not write.
      expect(result.output).not.toContain("Edit applied successfully.")
      // …and it must NAME the divergence, so the model knows its next address is a guess.
      expect(result.output).toContain("the file on disk is not what was written")
      // The report describes the file that is really there (4 lines), not the one the tool meant to write (3).
      expect(result.output).toContain("the file is now 4 lines")
    }),
  )
})
