import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import fs from "fs/promises"
import { WriteTool } from "../../src/tool/write"
import { EditTool } from "../../src/tool/edit"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { LSP } from "@/lsp/lsp"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "../../src/bus"
import { Format } from "../../src/format"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Instruction } from "../../src/session/instruction"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

/**
 * File-level budget, never per-test whack-a-mole: every case here boots the LSP/format path that the
 * write tool drives, so a loaded machine pushes a single case past bun's 5 s default and reports a
 * TIMEOUT as a red. Measured 2026-09-21 in isolation: «preserves BOM when overwriting existing files»
 * 5760 ms and «returns relative path as title» 5233 ms, with no assertion failure anywhere in the
 * file — and in a 3-file run those timeouts cascaded into `ERR_STREAM_WRITE_AFTER_END` on tests that
 * ran while a timed-out case still held the LSP stream.
 */
setDefaultTimeout(30_000)

const ctx = {
  sessionID: SessionID.make("ses_test-write-session"),
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
    LSP.defaultLayer,
    AppFileSystem.defaultLayer,
    Bus.layer,
    Format.defaultLayer,
    Instruction.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const init = Effect.fn("WriteToolTest.init")(function* () {
  const info = yield* WriteTool
  return yield* info.init()
})

const run = Effect.fn("WriteToolTest.run")(function* (
  args: Tool.InferParameters<typeof WriteTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

describe("tool.write", () => {
  describe("new file creation", () => {
    it.live("writes content to new file", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "newfile.txt")
          const result = yield* run({ filePath: filepath, content: "Hello, World!" })

          expect(result.output).toContain("Wrote file successfully")
          expect(result.metadata.exists).toBe(false)

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("Hello, World!")
        }),
      ),
    )

    it.live("creates parent directories if needed", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "nested", "deep", "file.txt")
          yield* run({ filePath: filepath, content: "nested content" })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("nested content")
        }),
      ),
    )

    it.live("handles relative paths by resolving to instance directory", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          yield* run({ filePath: "relative.txt", content: "relative content" })

          const content = yield* Effect.promise(() => fs.readFile(path.join(dir, "relative.txt"), "utf-8"))
          expect(content).toBe("relative content")
        }),
      ),
    )
  })

  describe("existing file overwrite", () => {
    it.live("overwrites existing file content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "existing.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "old content", "utf-8"))
          const result = yield* run({ filePath: filepath, content: "new content" })

          expect(result.output).toContain("Wrote file successfully")
          expect(result.metadata.exists).toBe(true)

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("new content")
        }),
      ),
    )

    it.live("preserves BOM when overwriting existing files", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "existing.cs")
          const bom = String.fromCharCode(0xfeff)
          yield* Effect.promise(() => fs.writeFile(filepath, `${bom}using System;\n`, "utf-8"))

          yield* run({ filePath: filepath, content: "using Up;\n" })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content.charCodeAt(0)).toBe(0xfeff)
          expect(content.slice(1)).toBe("using Up;\n")
        }),
      ),
    )

    it.live("restores BOM after formatter strips it", () =>
      provideTmpdirInstance(
        (dir) =>
          Effect.gen(function* () {
            const filepath = path.join(dir, "formatted.cs")
            const bom = String.fromCharCode(0xfeff)
            yield* Effect.promise(() => fs.writeFile(filepath, `${bom}using System;\n`, "utf-8"))

            yield* run({ filePath: filepath, content: "using Up;\n" })

            const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
            expect(content.charCodeAt(0)).toBe(0xfeff)
            expect(content.slice(1)).toBe("using Up;\n")
          }),
        {
          config: {
            formatter: {
              stripbom: {
                extensions: [".cs"],
                command: [
                  "node",
                  "-e",
                  "const fs = require('fs'); const file = process.argv[1]; let text = fs.readFileSync(file, 'utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); fs.writeFileSync(file, text, 'utf8')",
                  "$FILE",
                ],
              },
            },
          },
        },
      ),
    )

    it.live("returns diff in metadata for existing files", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "file.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "old", "utf-8"))
          const result = yield* run({ filePath: filepath, content: "new" })

          expect(result.metadata).toHaveProperty("filepath", filepath)
          expect(result.metadata).toHaveProperty("exists", true)
        }),
      ),
    )
  })

  describe("file permissions", () => {
    it.live("sets file permissions when writing sensitive data", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "sensitive.json")
          yield* run({ filePath: filepath, content: JSON.stringify({ secret: "data" }) })

          if (process.platform !== "win32") {
            const stats = yield* Effect.promise(() => fs.stat(filepath))
            expect(stats.mode & 0o777).toBe(0o644)
          }
        }),
      ),
    )
  })

  describe("content types", () => {
    it.live("writes JSON content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "data.json")
          const data = { key: "value", nested: { array: [1, 2, 3] } }
          yield* run({ filePath: filepath, content: JSON.stringify(data, null, 2) })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(JSON.parse(content)).toEqual(data)
        }),
      ),
    )

    it.live("writes binary-safe content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "binary.bin")
          const content = "Hello\x00World\x01\x02\x03"
          yield* run({ filePath: filepath, content })

          const buf = yield* Effect.promise(() => fs.readFile(filepath))
          expect(buf.toString()).toBe(content)
        }),
      ),
    )

    it.live("writes empty content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "empty.txt")
          yield* run({ filePath: filepath, content: "" })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe("")

          const stats = yield* Effect.promise(() => fs.stat(filepath))
          expect(stats.size).toBe(0)
        }),
      ),
    )

    it.live("writes multi-line content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "multiline.txt")
          const lines = ["Line 1", "Line 2", "Line 3", ""].join("\n")
          yield* run({ filePath: filepath, content: lines })

          const content = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(content).toBe(lines)
        }),
      ),
    )

    it.live("handles different line endings", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "crlf.txt")
          const content = "Line 1\r\nLine 2\r\nLine 3"
          yield* run({ filePath: filepath, content })

          const buf = yield* Effect.promise(() => fs.readFile(filepath))
          expect(buf.toString()).toBe(content)
        }),
      ),
    )

    // H9d — the form of an OVERWRITE is the file's, not the agent's (owner, 2026-10-01: «анализ какие ендинги
    // отправил агент, а какие у файла и поправить … чтобы не было микширования, тоже самое с кодировкой»).
    // Read back as BYTES: a BOM, a byte order or a CRLF is invisible in a decoded string.
    it.live("overwriting a CRLF file fits the agent's LF content to CRLF", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "crlf-existing.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "a\r\nb\r\n"))
          yield* run({ filePath: filepath, content: "x\ny\n" })

          expect(yield* Effect.promise(() => fs.readFile(filepath, "latin1"))).toBe("x\r\ny\r\n")
        }),
      ),
    )

    it.live("overwriting a UTF-16 LE file keeps UTF-16 LE, every script intact", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "multi.txt")
          const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")])
          yield* Effect.promise(() => fs.writeFile(filepath, utf16("old\n")))
          yield* run({ filePath: filepath, content: "你好 · നമസ്കാരം · Привет\n" })

          expect(yield* Effect.promise(() => fs.readFile(filepath))).toEqual(utf16("你好 · നമസ്കാരം · Привет\n"))
        }),
      ),
    )

    it.live("a NEW Delphi file is written UTF-8 BOM + CRLF, and the output names it", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "Unit1.pas")
          const result = yield* run({ filePath: filepath, content: "unit A;\nend.\n" })

          const bytes = yield* Effect.promise(() => fs.readFile(filepath))
          expect(bytes).toEqual(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("unit A;\r\nend.\r\n")]))
          expect(result.output).toContain("UTF-8 with BOM, CRLF")
        }),
      ),
    )
  })

  describe("error handling", () => {
    it.live("throws error when OS denies write access", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const readonlyPath = path.join(dir, "readonly.txt")
          yield* Effect.promise(() => fs.writeFile(readonlyPath, "test", "utf-8"))
          yield* Effect.promise(() => fs.chmod(readonlyPath, 0o444))
          const exit = yield* run({ filePath: readonlyPath, content: "new content" }).pipe(Effect.exit)
          expect(exit._tag).toBe("Failure")
        }),
      ),
    )
  })

  describe("pre-write syntax validation", () => {
    it.live("rejects broken python without creating the file", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "broken.py")
          // Unclosed string / fused junk that tree-sitter marks as ERROR
          const bad = 'def foo(\n    print("unterminated\n'
          const result = yield* run({ filePath: filepath, content: bad })

          expect(result.output.startsWith("REJECTED —")).toBe(true)
          expect(result.metadata.diagnostics).toEqual({})
          expect(result.metadata.filediffs[0]!.file).toBe(filepath)

          const existed = yield* Effect.promise(() =>
            fs.access(filepath).then(
              () => true,
              () => false,
            ),
          )
          expect(existed).toBe(false)
        }),
      ),
    )

    it.live("writes valid python content", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "ok.py")
          const content = "def foo():\n    return 1\n"
          const result = yield* run({ filePath: filepath, content })

          expect(result.output).toContain("Wrote file successfully")
          const onDisk = yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))
          expect(onDisk).toBe(content)
        }),
      ),
    )
  })

  // The `looksLikeCodeFragment` guard and its two pinning cases were removed on 2026-09-29 (owner,
  // plan 2026-09-29_bash-tool-single-execution-path D2): the 0-byte `i+1).join(…)` artefact was a
  // cmd.exe REDIRECT from bash.test.ts's `fill()` under a bare `/c`, never a write call — a 0-byte
  // file is the redirect's signature, a write would have carried content. The cause is fixed in
  // bash.ts/cmd.ts (`/d /s /c "…"`) and pinned by test/tool/shell-exec-contract.test.ts.
  describe("file names with punctuation", () => {
    it.live("a real name with parentheses writes", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "docs", "Report (final).md")
          yield* Effect.promise(() => fs.mkdir(path.dirname(filepath), { recursive: true }))
          const result = yield* run({ filePath: filepath, content: "# ok" })
          expect(result.output).toContain("Wrote file successfully")
        }),
      ),
    )
  })

  describe("title generation", () => {
    it.live("returns relative path as title", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "src", "components", "Button.tsx")
          yield* Effect.promise(() => fs.mkdir(path.dirname(filepath), { recursive: true }))

          const result = yield* run({ filePath: filepath, content: "export const Button = () => {}" })
          expect(result.title).toEndWith(path.join("src", "components", "Button.tsx"))
        }),
      ),
    )
  })

  describe("write returns line addresses", () => {
    // t89: after a `write` the model receives no line labels, so its next `edit` guesses
    // `fromHash` and is refused. The write result must carry the same `addressReport`
    // `edit` returns, computed over the final on-disk text — so these tests use ONLY
    // the printed labels, never a recomputed hash.
    const printedLabels = (output: string) => {
      const out: { line: number; hash: string }[] = []
      for (const raw of output.split("\n")) {
        const m = /^(\d+)  ([0-9a-f]{8})(?:: .*)?$/.exec(raw)
        if (m) out.push({ line: Number(m[1]), hash: m[2]! })
      }
      return out
    }

    const readLabels = Effect.fn("WriteAddressTest.readLabels")(function* (filepath: string) {
      const info = yield* ReadTool
      const reader = yield* info.init()
      const result = yield* reader.execute({ filePath: filepath }, ctx)
      return printedLabels(result.output)
    })

    const editByLabel = Effect.fn("WriteAddressTest.editByLabel")(function* (
      filepath: string,
      fromHash: string,
      newString: string,
    ) {
      const info = yield* EditTool
      const editor = yield* info.init()
      return yield* editor.execute(
        { files: [{ filePath: filepath, edits: [{ fromHash, newString }] }] },
        ctx,
      )
    })

    it.live("new file: edit line 2 using ONLY the printed labels", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "labeled.txt")
          const written = yield* run({ filePath: filepath, content: "alpha\nbeta\ngamma\n" })

          expect(written.output).toContain("Addresses for")
          const labels = printedLabels(written.output)
          expect(labels.length).toBe(3)

          for (const label of labels) {
            const readBack = yield* readLabels(filepath)
            expect(readBack.find((item) => item.line === label.line)?.hash).toBe(label.hash)
          }

          const second = labels.find((item) => item.line === 2)!
          const edited = yield* editByLabel(filepath, second.hash, "BETA")
          expect(edited.output).toContain("Edit applied successfully")
          expect(yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))).toBe("alpha\nBETA\ngamma\n")
        }),
      ),
    )

    it.live("overwrite: edit a changed line by its printed label", () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const filepath = path.join(dir, "over.txt")
          yield* Effect.promise(() => fs.writeFile(filepath, "one\ntwo\nthree\n", "utf-8"))
          const written = yield* run({ filePath: filepath, content: "one\nTWO\nthree\n" })

          expect(written.output).toContain("Addresses for")
          const labels = printedLabels(written.output)
          const second = labels.find((item) => item.line === 2)
          expect(second?.hash).toMatch(/^[0-9a-f]{8}$/)

          const readBack = yield* readLabels(filepath)
          for (const label of labels) {
            expect(readBack.find((item) => item.line === label.line)?.hash).toBe(label.hash)
          }

          const edited = yield* editByLabel(filepath, second!.hash, "2")
          expect(edited.output).toContain("Edit applied successfully")
          expect(yield* Effect.promise(() => fs.readFile(filepath, "utf-8"))).toBe("one\n2\nthree\n")
        }),
      ),
    )
  })
})
