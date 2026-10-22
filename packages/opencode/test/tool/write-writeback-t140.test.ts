/**
 * t140 — the WRITE must leave the file on disk EXACTLY as intended, and the result must describe the file that is
 * really there.
 *
 * The sibling (t139, `plans_completed/2026-10-22_edit-delete-writeback.md`, commit `4aeac71a94`) found the shape in
 * `edit`: the file was read back ONLY when a formatter ran (`format.file` returns false when no formatter matches),
 * so the result described the tool's MODEL of the write and not the file on disk. It fixed `edit` and filed the
 * same shape in `packages/opencode/src/tool/write.ts:103-108` as the local ticket `ca760c924e`.
 *
 * The ticket names its own falsifier and its own fixture, and BOTH are reused verbatim here — nothing about the
 * oracle is invented in this task:
 *
 *   «make the file on disk differ from what the tool wrote (a writer that touches the file between the write and
 *    the report), then assert the output does NOT claim a plain success and DOES name the divergence»
 *   «the t139 fixture uses a Format.Service whose `file()` rewrites the file and returns false»
 *
 * TWO properties are pinned, because the class has two halves:
 *
 * 1. **THE FILE ON DISK IS THE INTENDED BYTES.** Every case reads the file BACK and compares it byte for byte —
 *    the artefact, not the tool's opinion of it.
 * 2. **THE RESULT IS BUILT FROM WHAT IS ON DISK.** When the file on disk is not what the tool wrote, the tool must
 *    SAY so instead of claiming a clean success. A silent corruption reported as success is worse than any refusal
 *    (owner, 2026-10-18).
 *
 * The fixtures are `.txt` ON PURPOSE: a formatter REWRITES the file, so the expected bytes would not be the bytes
 * the tool wrote. A `.txt` fixture has no formatter, so the bytes on disk are the bytes under test.
 */
import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { WriteTool } from "../../src/tool/write"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "@/lsp/lsp"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Format } from "../../src/format"
import { Truncate } from "@/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

setDefaultTimeout(30_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const ctx = {
  sessionID: SessionID.make("ses_test-t140"),
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
 * A writer that REWRITES the file and then reports that no formatter ran — the shape of a file that is not what
 * the tool wrote, produced inside the tool's own flow, in a known place. This is the fixture the ticket names, and
 * the one t139 already proved fallible against `edit`.
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
const write = Effect.fn("WriteTest.write")(function* (args: { filePath: string; content: string }) {
  const info = yield* WriteTool
  const tool = yield* info.init()
  return yield* tool.execute(args as never, ctx)
})

const put = (file: string, content: string) => Effect.promise(() => fs.writeFile(file, content))
/** The file, read back as BYTES — a BOM, a byte order or a CRLF is invisible in a decoded string. */
const readBytes = (file: string) => Effect.promise(() => fs.readFile(file))
const readText = (file: string) => Effect.promise(() => fs.readFile(file, "utf8"))

describe("tool.write — the file on disk is what the tool wrote", () => {
  it.live("a NEW file lands byte-for-byte as intended", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const content = "one\ntwo\nthree\n"
        const file = `${dir}/new.txt`

        const result = yield* write({ filePath: file, content })

        // The file, read back — the artefact, not the tool's model of it.
        expect(yield* readBytes(file)).toEqual(Buffer.from(content, "utf8"))
        // …and the plain success is still the plain success when nothing diverged.
        expect(result.output).toContain("Wrote file successfully")
      }),
    ),
  )

  it.live("an OVERWRITE lands byte-for-byte as intended", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = `${dir}/existing.txt`
        yield* put(file, "old content\n")

        const result = yield* write({ filePath: file, content: "one\ntwo\n" })

        expect(yield* readBytes(file)).toEqual(Buffer.from("one\ntwo\n", "utf8"))
        expect(result.output).toContain("Wrote file successfully")
      }),
    ),
  )
})

describe("tool.write — the result is built from the file ON DISK", () => {
  itRewriting.live("a file that is not what the tool wrote is NAMED, not swallowed", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const content = "one\ntwo\nthree\nfour\n"
        const file = `${dir}/target.txt`

        const result = yield* write({ filePath: file, content })

        // The file now holds what the rewriting writer put there.
        expect(yield* readText(file)).toBe("one\ntwo\nthree\nfour\n)\n")

        // The tool must NOT claim a clean success over a file it did not write.
        expect(result.output).not.toContain("Wrote file successfully")
        // …and it must NAME the divergence, so the model knows its next address is a guess.
        expect(result.output).toContain("the file on disk is not what was written")
      }),
    ),
  )
})


/**
 * A language server that NEVER answers the diagnostics request.
 *
 * This is the shape that made the write suite hang: the tool waited for advice that never came, and the case ran
 * into the test's 30 s ceiling. `edit` bounds the same wait with `DIAGNOSTICS_BUDGET` — ONE constant, shared, not
 * a second one — so `write` answers anyway: ~1.5 s, with no diagnostics.
 *
 * The layer set below does NOT include the real LSP layer: the stub is the ONLY provider, so this case is the same
 * on every host — no server, no boot, no race. It is the control that proves the bound is load-bearing.
 */
const stallingLsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.promise(() => new Promise<never>(() => {})),
    hover: () => Effect.succeed([]),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const itStalling = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    stallingLsp,
  ),
)

describe("tool.write — the diagnostics wait is BOUNDED", () => {
  itStalling.live("a language server that never answers does not stall the write", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = `${dir}/stalled.txt`
        const result = yield* write({ filePath: file, content: "one\ntwo\n" })

        // The write landed and the result came back, even though the server never answered.
        expect(yield* readBytes(file)).toEqual(Buffer.from("one\ntwo\n", "utf8"))
        expect(result.output).toContain("Wrote file successfully")
      }),
    ),
  )
})
