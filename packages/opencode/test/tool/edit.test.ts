import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { EditTool } from "../../src/tool/edit"
import { chainHash, hashLabel } from "../../src/tool/read"
import * as TextCodec from "../../src/util/text-codec"
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
    // INCLUSIVE (plan 2026-10-04_edit-inclusive-span): the span's FIRST line's own label.
    fromHash: hashLabel(chain[span.line - 1]!),
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
              { insertAfter: hashLabel(0), newString: "Y" },
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

/**
 * ENCODINGS AND ENDINGS ON THE WRITE PATH (plan H9d). Every case reads the written BYTES back — the layer the
 * claim lives on: a BOM, a UTF-16 byte order or a CRLF is invisible in a decoded string, so a string read-back
 * would stay green through exactly the regressions these cases exist for.
 */
describe("tool.edit — encodings and endings, read back as BYTES", () => {
  const putBytes = (file: string, bytes: Uint8Array) => Effect.promise(() => fs.writeFile(file, bytes))
  const readBytes = (file: string) => Effect.promise(async () => new Uint8Array(await fs.readFile(file)))
  const BOM8 = [0xef, 0xbb, 0xbf]
  const utf8 = (text: string, bom = false) => new Uint8Array([...(bom ? BOM8 : []), ...Buffer.from(text, "utf-8")])
  const utf16le = (text: string) => new Uint8Array([0xff, 0xfe, ...Buffer.from(text, "utf16le")])

  it.live("a UTF-8 BOM file: the address resolves, and the BOM is kept", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const text = "alpha\nbeta\n"
      const file = `${dir}/bom.txt`
      yield* putBytes(file, utf8(text, true))

      const result = yield* edit(dir, oneFile(file, text, [{ line: 2, newString: "BETA" }]))

      expect(yield* readBytes(file)).toEqual(utf8("alpha\nBETA\n", true))
      expect(result.output).not.toContain("converted")
    }),
  )

  it.live("a UTF-16 LE file stays UTF-16 LE, with every script intact", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const text = "Hello\r\n你好\r\nനമസ്കാരം\r\n"
      const file = `${dir}/multi.txt`
      yield* putBytes(file, utf16le(text))

      yield* edit(dir, oneFile(file, text, [{ line: 2, newString: "Привет · Selamat pagi" }]))

      expect(yield* readBytes(file)).toEqual(utf16le("Hello\r\nПривет · Selamat pagi\r\nനമസ്കാരം\r\n"))
    }),
  )

  it.live("an ANSI file is converted to UTF-8 BOM + CRLF on save, and the output NAMES the conversion", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      // "one\nS := 'Привет';\n" in windows-1251 — the untouched line 2 is the one the old path destroyed.
      const bytes = new Uint8Array([...Buffer.from("one\nS := '"), 0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, ...Buffer.from("';\n")])
      const file = `${dir}/legacy.txt`
      yield* putBytes(file, bytes)
      const page = TextCodec.hostCodePage()
      const decoded = new TextDecoder(page ?? "utf-8").decode(bytes)

      const result = yield* edit(dir, oneFile(file, decoded, [{ line: 1, newString: "ONE" }])).pipe(Effect.exit)

      // No host code page: the file cannot be read honestly, so it must be refused and left as it was.
      if (page === undefined) {
        expect(String(result)).toContain("Cannot decode")
        expect(yield* readBytes(file)).toEqual(bytes)
        return
      }
      expect(String(result)).toContain(`ANSI ${page}`)
      expect(String(result)).toContain("UTF-8 with BOM, CRLF")
      expect(yield* readBytes(file)).toEqual(utf8(TextCodec.normalizeEndings(decoded, "\r\n").replace("one", "ONE"), true))
    }),
  )

  it.live("a Delphi file is normalised WHOLE to UTF-8 BOM + CRLF, and the agent is told what changed", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const text = "unit A;\ninterface\nend.\n"
      const file = `${dir}/Unit1.pas`
      yield* putBytes(file, utf8(text))

      const result = yield* edit(dir, oneFile(file, text, [{ line: 2, newString: "implementation" }]))

      expect(yield* readBytes(file)).toEqual(utf8("unit A;\r\nimplementation\r\nend.\r\n", true))
      expect(result.output).toContain("UTF-8, LF")
      expect(result.output).toContain("UTF-8 with BOM, CRLF")
    }),
  )

  it.live("a Delphi file ALREADY in UTF-8 BOM + CRLF is edited without a conversion notice", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const text = "unit A;\r\ninterface\r\n"
      const file = `${dir}/Unit2.pas`
      yield* putBytes(file, utf8(text, true))

      const result = yield* edit(dir, oneFile(file, text, [{ line: 2, newString: "implementation" }]))

      expect(yield* readBytes(file)).toEqual(utf8("unit A;\r\nimplementation\r\n", true))
      expect(result.output).not.toContain("converted")
    }),
  )

  it.live("a NEW Delphi file is written as UTF-8 BOM + CRLF whatever the agent sent", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/Unit3.pas`

      const result = yield* edit(dir, { files: [{ filePath: file, content: "unit B;\nend.\n" }] })

      expect(yield* readBytes(file)).toEqual(utf8("unit B;\r\nend.\r\n", true))
      expect(result.output).toContain("UTF-8 with BOM, CRLF")
    }),
  )

  // H10 — the hole closes BY CONSTRUCTION: the address is over the DECODED text, so an edit is only ever applied
  // in the page the model READ the file in. A different page does not resolve — a refusal, never a conversion
  // of garbage.
  it.live("a GBK file edited with `encoding: gbk` is converted from GBK, every character intact", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const gbk = new Uint8Array([0x61, 0x0a, 0xc4, 0xe3, 0xba, 0xc3, 0x0a]) // "a\n你好\n" in GBK
      const file = `${dir}/legacy.txt`
      yield* putBytes(file, gbk)

      const result = yield* edit(dir, {
        files: [{ filePath: file, encoding: "gbk", edits: addresses("a\n你好\n", [{ line: 1, newString: "A" }]) }],
      })

      expect(yield* readBytes(file)).toEqual(utf8("A\r\n你好\r\n", true))
      expect(result.output).toContain("ANSI gbk")
    }),
  )

  it.live("addresses read in ONE page do not resolve in ANOTHER — the file is left untouched", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const gbk = new Uint8Array([0x61, 0x0a, 0xc4, 0xe3, 0xba, 0xc3, 0x0a])
      const file = `${dir}/legacy.txt`
      yield* putBytes(file, gbk)

      // Read as GBK (line 2 is «你好»), edited as windows-1252: line 2 is different text there, so its hash
      // — and every hash after it — is not in the file the edit decoded.
      const failed = yield* edit(dir, {
        files: [
          {
            filePath: file,
            encoding: "windows-1252",
            edits: addresses("a\n你好\n", [{ line: 2, to: 2, newString: "x" }]),
          },
        ],
      }).pipe(Effect.exit)

      expect(String(failed)).toContain("not in this file")
      expect(yield* readBytes(file)).toEqual(gbk)
    }),
  )

  it.live("an unknown code page label is refused, naming the entry", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/legacy.txt`
      yield* putBytes(file, new Uint8Array([0x61, 0x0a]))

      const failed = yield* edit(dir, {
        files: [{ filePath: file, encoding: "klingon", edits: [{ insertAfter: hashLabel(0), newString: "x" }] }],
      }).pipe(Effect.exit)

      expect(String(failed)).toContain("files[0]")
      expect(String(failed)).toContain("not a code page")
    }),
  )

  it.live("a BINARY file is refused — the seed address resolves in ANY file, so the guard must be the tool's", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const bytes = new Uint8Array([0x41, 0x00, 0x42, 0x0a, 0x43])
      const file = `${dir}/blob.txt`
      yield* putBytes(file, bytes)

      const failed = yield* edit(dir, {
        files: [{ filePath: file, edits: [{ insertAfter: hashLabel(0), newString: "X" }] }],
      }).pipe(Effect.exit)

      expect(String(failed)).toContain("binary")
      expect(yield* readBytes(file)).toEqual(bytes)
    }),
  )
})
