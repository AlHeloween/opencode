import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
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

// t93: edit.txt states exactly what edit.ts enforces.
// Catalogue + behaviour + stringified-files message. RED before S1/S2/S4.

setDefaultTimeout(30_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const EXPECTED_KEYS = [
  "[empty-files]",
  "[content+edits]",
  "[missing-change]",
  "[bad-encoding]",
  "[encoding+content]",
  "[same-file]",
  "[already-exists]",
  "[not-found]",
  "[is-directory]",
  "[binary-file]",
  "[undecodable]",
  "[no-change]",
  "[not-hex]",
  "[stale-hash]",
  "[seed-not-line]",
  "[either-or]",
  "[toHash-on-insert]",
  "[inverted]",
  "[overlap]",
  "[files-not-array]",
] as const

function extractKeys(text: string): Set<string> {
  // A refusal key is a message prefix: a quote/backtick immediately followed by
  // `[key]` (at least 3 chars, starting with a letter, so `files[0]`,
  // `[x]`, `[0]` are never keys). Captures both `"[same-file] ..."`
  // in edit.ts and `` `[same-file]` `` in edit.txt.
  const out = new Set<string>()
  const re = /["'`]\[([A-Za-z][A-Za-z0-9_+-]{2,})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.add(`[${m[1]}]`)
  return out
}

describe("t93 edit description contract — catalogue", () => {
  test("every expected key exists in edit.ts and in edit.txt", async () => {
    const tsPath = path.join(__dirname, "..", "..", "src", "tool", "edit.ts")
    const txtPath = path.join(__dirname, "..", "..", "src", "tool", "edit.txt")
    const ts = await fs.readFile(tsPath, "utf8")
    const txt = await fs.readFile(txtPath, "utf8")
    for (const key of EXPECTED_KEYS) {
      expect(ts, `edit.ts lacks ${key}`).toContain(key)
      expect(txt, `edit.txt lacks ${key}`).toContain(key)
    }
  })

  test("no undocumented refusal: keys in ts == keys in txt", async () => {
    const tsPath = path.join(__dirname, "..", "..", "src", "tool", "edit.ts")
    const txtPath = path.join(__dirname, "..", "..", "src", "tool", "edit.txt")
    const ts = await fs.readFile(tsPath, "utf8")
    const txt = await fs.readFile(txtPath, "utf8")
    const tsKeys = [...extractKeys(ts)].sort()
    const txtKeys = [...extractKeys(txt)].sort()
    expect(tsKeys, "edit.ts keys").toEqual([...EXPECTED_KEYS].sort())
    expect(txtKeys, "edit.txt keys").toEqual([...EXPECTED_KEYS].sort())
    expect(txtKeys).toEqual(tsKeys)
  })

  test("edit.txt stays shorter than the 8 470 B it replaces", async () => {
    const txtPath = path.join(__dirname, "..", "..", "src", "tool", "edit.txt")
    const stat = await fs.stat(txtPath)
    expect(stat.size).toBeLessThan(8470)
  })
})

const ctx = {
  sessionID: SessionID.make("ses_test-edit-contract"),
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

const edit = Effect.fn("EditContract.edit")(function* (dir: string, args: unknown) {
  const info = yield* EditTool
  const tool = yield* info.init()
  return yield* provideInstance(dir)(tool.execute(args as never, ctx))
})

const put = (file: string, content: string) => Effect.promise(() => fs.writeFile(file, content))
const readBack = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

const labels = (content: string) => {
  const lines = content.split("\n")
  const chain: number[] = []
  let running = 0
  for (const line of lines) chain.push((running = chainHash(running, line.endsWith("\r") ? line.slice(0, -1) : line)))
  return chain.map((c) => hashLabel(c))
}

describe("t93 edit description contract — behaviour", () => {
  it.live("two changes to one file in ONE edits array PASS", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "one\ntwo\nthree\n"
      const file = `${dir}/b.txt`
      yield* put(file, content)
      const h = labels(content)
      const result = yield* edit(dir, {
        files: [
          {
            filePath: file,
            edits: [
              { fromHash: h[0]!, newString: "ONE" },
              { fromHash: h[1]!, newString: "TWO" },
            ],
          },
        ],
      })
      expect(result.output).toContain("Edit applied successfully")
      expect(yield* readBack(file)).toBe("ONE\nTWO\nthree\n")
    }),
  )

  it.live("two files elements for ONE file are refused with [same-file]", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "one\ntwo\n"
      const file = `${dir}/c.txt`
      yield* put(file, content)
      const h = labels(content)
      const failed = yield* edit(dir, {
        files: [
          { filePath: file, edits: [{ fromHash: h[0]!, newString: "X" }] },
          { filePath: file, edits: [{ fromHash: h[1]!, newString: "Y" }] },
        ],
      }).pipe(Effect.exit)
      expect(String(failed)).toContain("[same-file]")
    }),
  )

  it.live("a JSON-string files decodes to the array it encodes", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const content = "alpha\nbeta\n"
      const file = `${dir}/s.txt`
      yield* put(file, content)
      const h = labels(content)
      const array = [{ filePath: file, edits: [{ fromHash: h[0]!, newString: "ALPHA" }] }]
      const result = yield* edit(dir, { files: JSON.stringify(array) } as unknown).pipe(Effect.exit)
      if (Exit.isFailure(result)) {
        // The allowed alternative: a refusal that says what was sent.
        expect(String(Cause.pretty(result.cause))).toContain("must be an array")
      } else {
        expect(result.value.output).toContain("Edit applied successfully")
        expect(result.value.output).toContain("decoded stringified")
        expect(yield* readBack(file)).toBe("ALPHA\nbeta\n")
      }
    }),
  )

  it.live("a non-array string files is refused as [files-not-array]", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const failed = yield* edit(dir, { files: "not-json" } as unknown).pipe(Effect.exit)
      expect(String(failed)).toContain("[files-not-array]")
      expect(String(failed)).toContain("must be an array")
    }),
  )
})
