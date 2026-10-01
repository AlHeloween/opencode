import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "@/lsp/lsp"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { Instruction } from "../../src/session/instruction"
import { ReadTool } from "../../src/tool/read"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { Filesystem } from "@/util/filesystem"
import * as TextCodec from "@/util/text-codec"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures")

// FILE-level, per AGENTS.md § Testing Convention — «bun's 5 s default turns a loaded machine into a red that
// says nothing about the code» — declared once here, never as per-test bumps.
//
// STATUS 2026-10-01, CORRECTED rather than left standing: this file produced NO verdict that afternoon and
// produces one NOW — `40 pass / 1 fail`, 41 tests, 64.7 s (`20261001T051356Z_91a08082`). The cause of the
// earlier silence is UNMEASURED: the conhost hypothesis below was never confirmed, and nothing here retires it
// by explaining it — the instrument simply answers again. What the silence COST is now visible, and it is the
// reason this status is worth stating at all: with the verdict withheld, a stale assertion (`10: line10`, the
// pre-address format) sat in this file unnoticed for as long as nobody could run it, and the first real run
// since surfaced it. A suite that cannot report is not a suite that is quiet.
setDefaultTimeout(20_000)

afterEach(async () => {
  await Instance.disposeAll()
})

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

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const init = Effect.fn("ReadToolTest.init")(function* () {
  const info = yield* ReadTool
  return yield* info.init()
})

const run = Effect.fn("ReadToolTest.run")(function* (
  args: Tool.InferParameters<typeof ReadTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const exec = Effect.fn("ReadToolTest.exec")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ReadTool>,
  next: Tool.Context = ctx,
) {
  return yield* provideInstance(dir)(run(args, next))
})

const fail = Effect.fn("ReadToolTest.fail")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ReadTool>,
  next: Tool.Context = ctx,
) {
  const exit = yield* exec(dir, args, next).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected read to fail")
})

const full = (p: string) => (process.platform === "win32" ? Filesystem.normalizePath(p) : p)
const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")
const put = Effect.fn("ReadToolTest.put")(function* (p: string, content: string | Buffer | Uint8Array) {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(p, content)
})
const load = Effect.fn("ReadToolTest.load")(function* (p: string) {
  const fs = yield* AppFileSystem.Service
  return yield* fs.readFileString(p)
})
const asks = () => {
  const items: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  return {
    items,
    next: {
      ...ctx,
      ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          items.push(req)
        }),
    },
  }
}

describe("tool.read external_directory permission", () => {
  it.live("allows reading absolute path inside project directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "test.txt"), "hello world")

      const result = yield* exec(dir, { filePath: path.join(dir, "test.txt") })
      expect(result.output).toContain("hello world")
    }),
  )

  it.live("allows reading file in subdirectory inside project directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "subdir", "test.txt"), "nested content")

      const result = yield* exec(dir, { filePath: path.join(dir, "subdir", "test.txt") })
      expect(result.output).toContain("nested content")
    }),
  )

  it.live("asks for external_directory permission when reading absolute path outside project", () =>
    Effect.gen(function* () {
      const outer = yield* tmpdirScoped()
      const dir = yield* tmpdirScoped({ git: true })
      yield* put(path.join(outer, "secret.txt"), "secret data")

      const { items, next } = asks()

      yield* exec(dir, { filePath: path.join(outer, "secret.txt") }, next)
      const ext = items.find((item) => item.permission === "external_directory")
      expect(ext).toBeDefined()
      expect(ext!.patterns).toContain(glob(path.join(outer, "*")))
    }),
  )

  if (process.platform === "win32") {
    it.live("normalizes read permission paths on Windows", () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        yield* put(path.join(dir, "test.txt"), "hello world")

        const { items, next } = asks()
        const target = path.join(dir, "test.txt")
        const alt = target
          .replace(/^[A-Za-z]:/, "")
          .replaceAll("\\", "/")
          .toLowerCase()

        yield* exec(dir, { filePath: alt }, next)
        const read = items.find((item) => item.permission === "read")
        expect(read).toBeDefined()
        expect(read!.patterns).toEqual([full(target)])
      }),
    )
  }

  it.live("asks for directory-scoped external_directory permission when reading external directory", () =>
    Effect.gen(function* () {
      const outer = yield* tmpdirScoped()
      const dir = yield* tmpdirScoped({ git: true })
      yield* put(path.join(outer, "external", "a.txt"), "a")

      const { items, next } = asks()

      yield* exec(dir, { filePath: path.join(outer, "external") }, next)
      const ext = items.find((item) => item.permission === "external_directory")
      expect(ext).toBeDefined()
      expect(ext!.patterns).toContain(glob(path.join(outer, "external", "*")))
    }),
  )

  it.live("asks for external_directory permission when reading relative path outside project", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })

      const { items, next } = asks()

      yield* fail(dir, { filePath: "../outside.txt" }, next)
      const ext = items.find((item) => item.permission === "external_directory")
      expect(ext).toBeDefined()
    }),
  )

  it.live("does not ask for external_directory permission when reading inside project", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped({ git: true })
      yield* put(path.join(dir, "internal.txt"), "internal content")

      const { items, next } = asks()

      yield* exec(dir, { filePath: path.join(dir, "internal.txt") }, next)
      const ext = items.find((item) => item.permission === "external_directory")
      expect(ext).toBeUndefined()
    }),
  )
})

describe("tool.read env file permissions", () => {
  const cases: [string, boolean][] = [
    [".env", true],
    [".env.local", true],
    [".env.production", true],
    [".env.development.local", true],
    [".env.example", false],
    [".envrc", false],
    ["environment.ts", false],
  ]

  for (const agentName of ["build", "plan"] as const) {
    describe(`agent=${agentName}`, () => {
      for (const [filename, shouldAsk] of cases) {
        it.live(`${filename} asks=${shouldAsk}`, () =>
          Effect.gen(function* () {
            const dir = yield* tmpdirScoped()
            yield* put(path.join(dir, filename), "content")

            const asked = yield* provideInstance(dir)(
              Effect.gen(function* () {
                const agent = yield* Agent.Service
                const info = yield* agent.get(agentName)
                let asked = false
                const next = {
                  ...ctx,
                  ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
                    Effect.sync(() => {
                      for (const pattern of req.patterns) {
                        const rule = Permission.evaluate(req.permission, pattern, info.permission)
                        if (rule.action === "ask" && req.permission === "read") {
                          asked = true
                        }
                        if (rule.action === "deny") {
                          throw new Permission.DeniedError({ ruleset: info.permission })
                        }
                      }
                    }),
                }

                yield* run({ filePath: path.join(dir, filename) }, next)
                return asked
              }),
            )

            expect(asked).toBe(shouldAsk)
          }),
        )
      }
    })
  }
})

describe("tool.read truncation", () => {
  it.live("truncates large file by bytes and sets truncated metadata", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const base = yield* load(path.join(FIXTURES_DIR, "models-api.json"))
      const target = 60 * 1024
      const content = base.length >= target ? base : base.repeat(Math.ceil(target / base.length))
      yield* put(path.join(dir, "large.json"), content)

      const result = yield* exec(dir, { filePath: path.join(dir, "large.json") })
      expect(result.metadata.truncated).toBe(true)
      expect(result.output).toContain("Output capped at")
      expect(result.output).toContain("Use offset=")
    }),
  )

  it.live("truncates by line count when limit is specified", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const lines = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n")
      yield* put(path.join(dir, "many-lines.txt"), lines)

      const result = yield* exec(dir, { filePath: path.join(dir, "many-lines.txt"), limit: 10 })
      expect(result.metadata.truncated).toBe(true)
      expect(result.output).toContain("Showing lines 1-10 of 100")
      expect(result.output).toContain("Use offset=11")
      expect(result.output).toContain("line0")
      expect(result.output).toContain("line9")
      expect(result.output).not.toContain("line10")
    }),
  )

  it.live("does not truncate small file", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "small.txt"), "hello world")

      const result = yield* exec(dir, { filePath: path.join(dir, "small.txt") })
      expect(result.metadata.truncated).toBe(false)
      expect(result.output).toContain("End of file")
    }),
  )

  it.live("respects offset parameter", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join("\n")
      yield* put(path.join(dir, "offset.txt"), lines)

      const result = yield* exec(dir, { filePath: path.join(dir, "offset.txt"), offset: 10, limit: 5 })

      // SUPERSEDES eight membership checks that pinned the PRE-ADDRESS format (`"10: line10"`). The requirement
      // moved — H2 gave every line a chained address — so the test moves in the same change, and it is pinned
      // MORE tightly than what it replaces: an EXACT list of the lines returned, address included. A shifted
      // window, a dropped address or a line that lost its prefix no longer satisfies it, where
      // `toContain("line10")` was happy either way.
      const shown = [...result.output.matchAll(/^(\d+) {2}([0-9a-f]{8}): (.*)$/gm)].map((match) => [match[1], match[3]])
      expect(shown).toEqual([
        ["10", "line10"],
        ["11", "line11"],
        ["12", "line12"],
        ["13", "line13"],
        ["14", "line14"],
      ])
    }),
  )

  it.live("throws when offset is beyond end of file", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const lines = Array.from({ length: 3 }, (_, i) => `line${i + 1}`).join("\n")
      yield* put(path.join(dir, "short.txt"), lines)

      const err = yield* fail(dir, { filePath: path.join(dir, "short.txt"), offset: 4, limit: 5 })
      expect(err.message).toContain("Offset 4 is out of range for this file (3 lines)")
    }),
  )

  it.live("allows reading empty file at default offset", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "empty.txt"), "")

      const result = yield* exec(dir, { filePath: path.join(dir, "empty.txt") })
      expect(result.metadata.truncated).toBe(false)
      expect(result.output).toContain("End of file - total 0 lines")
    }),
  )

  it.live("throws when offset > 1 for empty file", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "empty.txt"), "")

      const err = yield* fail(dir, { filePath: path.join(dir, "empty.txt"), offset: 2 })
      expect(err.message).toContain("Offset 2 is out of range for this file (0 lines)")
    }),
  )

  it.live("does not mark final directory page as truncated", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* Effect.forEach(
        Array.from({ length: 10 }, (_, i) => i),
        (i) => put(path.join(dir, "dir", `file-${i + 1}.txt`), `line${i}`),
        {
          concurrency: "unbounded",
        },
      )

      const result = yield* exec(dir, { filePath: path.join(dir, "dir"), offset: 6, limit: 5 })
      expect(result.metadata.truncated).toBe(false)
      expect(result.output).not.toContain("Showing 5 of 10 entries")
    }),
  )

  it.live("WRAPS a long line and says WHERE in it the reader is, instead of clipping it", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      // Two distinguishable halves, so «the end is reachable» is a claim the output can actually show —
      // `"x".repeat(3000)` would satisfy `toContain` on ANY 2000-character window of it.
      yield* put(path.join(dir, "long-line.txt"), "A".repeat(2000) + "B".repeat(1000))

      const result = yield* exec(dir, { filePath: path.join(dir, "long-line.txt") })

      // SUPERSEDES «truncates long lines», whose assertions were `toContain("(line truncated to 2000 chars)")`
      // and `output.length < 3000`. The requirement moved: the owner asked to know WHERE in the line the
      // reader is («в файле очень длинные строки то у тебя должен быть перенос строк. Для определения
      // позиции»), and a suffix saying «truncated» answers a different question. Every assertion below is at
      // least as tight, and the second one claims something the clipped form could NEVER show — the final
      // character of the line.
      expect(result.output).toContain("A".repeat(2000))
      expect(result.output).toContain("↳+2000: " + "B".repeat(1000))
      expect(result.output).not.toContain("line truncated")
      // ONE source line, ONE address: the wrap is not a second line, and the footer must still count 1.
      expect(result.output.match(/^\d+ {2}[0-9a-f]{8}: /gm)?.length).toBe(1)
      expect(result.output).toContain("End of file - total 1 lines")
    }),
  )

  it.live("image files set truncated to false", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
        "base64",
      )
      yield* put(path.join(dir, "image.png"), png)

      const result = yield* exec(dir, { filePath: path.join(dir, "image.png") })
      expect(result.metadata.truncated).toBe(false)
      expect(result.attachments).toBeDefined()
      expect(result.attachments?.length).toBe(1)
      expect(result.attachments?.[0]).not.toHaveProperty("id")
      expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
      expect(result.attachments?.[0]).not.toHaveProperty("messageID")
    }),
  )

  it.live("detects attachment media from file contents", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
      yield* put(path.join(dir, "image.bin"), jpeg)

      const result = yield* exec(dir, { filePath: path.join(dir, "image.bin") })
      expect(result.output).toBe("Image read successfully")
      expect(result.attachments?.[0].mime).toBe("image/jpeg")
      expect(result.attachments?.[0].url.startsWith("data:image/jpeg;base64,")).toBe(true)
    }),
  )

  it.live("large image files are properly attached without error", () =>
    Effect.gen(function* () {
      const result = yield* exec(FIXTURES_DIR, { filePath: path.join(FIXTURES_DIR, "large-image.png") })
      expect(result.metadata.truncated).toBe(false)
      expect(result.attachments).toBeDefined()
      expect(result.attachments?.length).toBe(1)
      expect(result.attachments?.[0].type).toBe("file")
      expect(result.attachments?.[0]).not.toHaveProperty("id")
      expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
      expect(result.attachments?.[0]).not.toHaveProperty("messageID")
    }),
  )

  it.live(".fbs files (FlatBuffers schema) are read as text, not images", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fbs = `namespace MyGame;

table Monster {
  pos:Vec3;
  name:string;
  inventory:[ubyte];
}

root_type Monster;`
      yield* put(path.join(dir, "schema.fbs"), fbs)

      const result = yield* exec(dir, { filePath: path.join(dir, "schema.fbs") })
      expect(result.attachments).toBeUndefined()
      expect(result.output).toContain("namespace MyGame")
      expect(result.output).toContain("table Monster")
    }),
  )
})

describe("tool.read loaded instructions", () => {
  it.live("loads AGENTS.md from parent directory and includes in metadata", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "subdir", "AGENTS.md"), "# Test Instructions\nDo something special.")
      yield* put(path.join(dir, "subdir", "nested", "test.txt"), "test content")

      const result = yield* exec(dir, { filePath: path.join(dir, "subdir", "nested", "test.txt") })
      expect(result.output).toContain("test content")
      expect(result.output).toContain("system-reminder")
      expect(result.output).toContain("Test Instructions")
      expect(result.metadata.loaded).toBeDefined()
      expect(result.metadata.loaded).toContain(path.join(dir, "subdir", "AGENTS.md"))

      // Second read (new message, same instance): full content NOT re-delivered —
      // one-line gated-workflow reminder instead (2026-08-30 flood guard).
      const again = yield* exec(dir, { filePath: path.join(dir, "subdir", "nested", "test.txt") }, {
        ...ctx,
        messageID: MessageID.make("msg_second_read"),
      })
      expect(again.output).toContain("test content")
      expect(again.output).not.toContain("Test Instructions")
      expect(again.output).toContain("Gated workflow")
      // 2026-09-29: this reminder used to be emitted TWICE, each copy closed with a
      // `time:` + `md5:` stamp over `Date.now()` — a repeating message carrying a moving
      // key. The model imitated exactly that shape and jammed its tool calls.
      expect(again.output.match(/Gated workflow/g)?.length).toBe(1)
      expect(again.output).not.toContain("md5:")
    }), 30_000,
  )
})

describe("tool.read binary detection", () => {
  it.live("rejects text extension files with null bytes", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const bytes = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64])
      yield* put(path.join(dir, "null-byte.txt"), bytes)

      const err = yield* fail(dir, { filePath: path.join(dir, "null-byte.txt") })
      expect(err.message).toContain("Cannot read binary file")
    }),
  )

  it.live("rejects known binary extensions", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "module.wasm"), "not really wasm")

      const err = yield* fail(dir, { filePath: path.join(dir, "module.wasm") })
      expect(err.message).toContain("Cannot read binary file")
    }),
  )
})

/**
 * THE LINE ADDRESS (plan 2026-10-01_hash-addressed-edits, H1/H2).
 *
 * `read` prints a CHAINED hash per line and `edit` will consume it. Four properties carry the whole scheme,
 * and every one of them is a way the address could lie without anything looking broken:
 *
 *   1. it is STABLE — the same file read twice prints the same labels;
 *   2. it survives CRLF — the bytes a caller types back never equal the bytes on disk, which is the class
 *      `oldString` could not survive and the fuzzy cascade existed only to forgive;
 *   3. it does not depend on the WINDOW — line 3 hashes the same read alone or inside a range, because the
 *      chain runs over the lines a window does not return;
 *   4. it carries the PREFIX — two IDENTICAL lines get DIFFERENT addresses.
 *
 * The third is the one the implementation could get wrong while every other test still passed: placing the
 * chain below the skip is a one-line mistake that breaks only cross-window agreement. The fourth is the case
 * that failed LIVE an hour before this file was written — the content path refused
 * `experiments/2026-10-01_edit-range-verify/dup-lines.txt` with «Found multiple matches for oldString».
 */
describe("tool.read — the line address", () => {
  const labels = (output: string) => output.match(/\b[0-9a-f]{8}: /g)

  it.live("prints an 8-hex address per line, and the same file prints the same addresses twice", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "a.txt"), "alpha\nbeta\ngamma\n")

      const first = yield* exec(dir, { filePath: path.join(dir, "a.txt") })
      const second = yield* exec(dir, { filePath: path.join(dir, "a.txt") })

      expect(first.output).toMatch(/^1 {2}[0-9a-f]{8}: alpha$/m)
      expect(second.output).toBe(first.output)
    }),
  )

  it.live("CRLF and LF hash IDENTICALLY — the class `oldString` could not survive", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "lf.txt"), "alpha\nbeta\n")
      yield* put(path.join(dir, "crlf.txt"), "alpha\r\nbeta\r\n")

      const lf = yield* exec(dir, { filePath: path.join(dir, "lf.txt") })
      const crlf = yield* exec(dir, { filePath: path.join(dir, "crlf.txt") })

      expect(labels(crlf.output)).toEqual(labels(lf.output))
    }),
  )

  it.live("the WINDOW does not change an address — line 3 alone is line 3 in a range", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "w.txt"), "one\ntwo\nthree\nfour\nfive\n")

      const whole = yield* exec(dir, { filePath: path.join(dir, "w.txt") })
      const slice = yield* exec(dir, { filePath: path.join(dir, "w.txt"), offset: 3, limit: 2 })

      const at = (output: string) => output.match(/^3 {2}([0-9a-f]{8}): three$/m)?.[1]
      expect(at(slice.output)).toBeDefined()
      expect(at(slice.output)).toBe(at(whole.output))
    }),
  )

  it.live("the chain carries the PREFIX: the same text in another position is another address", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "dup.txt"), "same\nsame\n")

      const result = yield* exec(dir, { filePath: path.join(dir, "dup.txt") })
      const found = result.output.match(/[0-9a-f]{8}: same/g) ?? []
      expect(found.length).toBe(2)
      expect(found[0]).not.toBe(found[1])
    }),
  )
})

/**
 * THE BYTE-ROW ADDRESS, through the REAL tool — the layer `read-address.test.ts` deliberately does not cross.
 * The pure file proves the chain; this proves the address reaches the MODEL'S OUTPUT, which is the only place
 * it is worth anything (F6's lesson, paid for an hour before either file existed).
 */
describe("tool.read — the byte-row address (hex mode)", () => {
  it.live("a hex row carries an address, and the WINDOW does not move it", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const blob = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 7 + 1) & 0xff))
      yield* put(path.join(dir, "blob.bin"), blob)

      const wide = yield* exec(dir, { filePath: path.join(dir, "blob.bin"), hex: true, offset: 1, limit: 64 })
      // `offset: 40` deliberately does NOT sit on a row boundary (index 39 lives in row 32): an offset that
      // lands on one would pass whether rows are aligned to the file or to the caller's pointer.
      const narrow = yield* exec(dir, { filePath: path.join(dir, "blob.bin"), hex: true, offset: 40, limit: 16 })

      const at = (output: string, byte: number) =>
        output.match(new RegExp("^" + byte.toString(16).padStart(8, "0") + " {2}([0-9a-f]{8})", "m"))?.[1]

      expect(at(wide.output, 0)).toBeDefined()
      // Row 0x20 is the SAME row in both reads, and the second read's `offset` does not sit on a row boundary
      // — which is exactly what aligning rows to the FILE buys, and what an offset-relative row destroys.
      expect(at(narrow.output, 32)).toBeDefined()
      expect(at(narrow.output, 32)).toBe(at(wide.output, 32))
    }),
  )
})

/**
 * THE MODEL CHOOSES THE CODE PAGE (plan H10). Owner, 2026-10-01: «понять что там сможет только модель, значит у
 * модели должна быть возможность правильного чтения, разумеется cp1251 по умолчанию, но можно выбирать». Bytes
 * cannot name their code page; a reader of the TEXT can. So a legacy file is read in the host page by default,
 * the output SAYS which page it was read in, and `encoding` re-reads it in another.
 */
describe("tool.read legacy code pages", () => {
  const GBK = Buffer.from([0x61, 0x0a, 0xc4, 0xe3, 0xba, 0xc3, 0x0a]) // "a\n你好\n" in GBK

  it.live("a legacy file NAMES the page it was read in, so a wrong decode is visible", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "legacy.txt"), GBK)
      const page = TextCodec.hostCodePage()

      // No host page: nothing honest to decode with, and the refusal must point at the way out.
      if (page === undefined) {
        expect((yield* fail(dir, { filePath: path.join(dir, "legacy.txt") })).message).toContain("encoding")
        return
      }
      const result = yield* exec(dir, { filePath: path.join(dir, "legacy.txt") })
      expect(result.output).toContain(`<encoding>ANSI ${page}`)
      expect(result.output).toContain("`encoding`")
    }),
  )

  it.live("`encoding` reads it in the chosen page — and the output names THAT page", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "legacy.txt"), GBK)

      const result = yield* exec(dir, { filePath: path.join(dir, "legacy.txt"), encoding: "gbk" })

      expect(result.output).toContain("你好")
      expect(result.output).toContain("<encoding>ANSI gbk")
    }),
  )

  it.live("an unknown or UTF label is refused before anything is read", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "legacy.txt"), GBK)

      expect((yield* fail(dir, { filePath: path.join(dir, "legacy.txt"), encoding: "klingon" })).message).toContain(
        "not a code page",
      )
      expect((yield* fail(dir, { filePath: path.join(dir, "legacy.txt"), encoding: "utf-8" })).message).toContain(
        "not a code page",
      )
    }),
  )

  it.live("a UTF-8 file prints no encoding line — the common case keeps its output byte-identical", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "plain.txt"), "a\n你好\n")

      const result = yield* exec(dir, { filePath: path.join(dir, "plain.txt"), encoding: "gbk" })

      expect(result.output).toContain("你好")
      expect(result.output).not.toContain("<encoding>")
    }),
  )
})
