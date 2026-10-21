/**
 * t137 — the edit map names only the labels the model can STILL SEE.
 *
 * The map the `edit` tool prints (`old -> new`) is only useful for the labels the model holds: a mapping for a
 * label it cannot see is noise, and a mapping MISSING for one it holds leaves a stale hash in the working picture
 * (owner, 2026-10-21: «просто дать список строк файла которые изменились, но есть в контентном окне»).
 *
 * The fixture is a REAL session: the outputs are the `read` tool's own bytes, and the earlier read has LEFT the
 * window the way the runtime makes a result leave it — a release (`recall … release`), which puts an
 * ID-addressed placeholder on the wire in place of the body.
 *
 * RED before the caller was wired: the map listed every changed label, the released one included. The test was
 * authored after the implementation, so the RED receipt is the MUTATION run (the one line that hands the set to
 * the report removed) — a control that proves the oracle can fail on this exact defect.
 */
import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { EditTool } from "../../src/tool/edit"
import { ReadTool, chainHash, hashLabel } from "../../src/tool/read"
import { MessageV2 } from "../../src/session/message-v2"
import { windowLabelsFor } from "../../src/session/window-labels"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "@/lsp/lsp"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Format } from "@/format"
import { Truncate } from "@/tool/truncate"
import { Instance } from "@/project/instance"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Instruction } from "@/session/instruction"

setDefaultTimeout(30_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    LSP.defaultLayer,
    Truncate.defaultLayer,
    Instruction.defaultLayer,
  ),
)

const sessionID = SessionID.make("ses_test-t137")
const messageID = MessageID.make("")

const baseCtx = {
  sessionID,
  messageID,
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const CONTENT = "l1\nl2\nl3\nl4\nl5\nl6\n"

/** The labels of a file's lines, computed with the SAME chain the tools use. */
const labelsOf = (content: string): string[] => {
  const lines = content.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  const out = [hashLabel(0)]
  let running = 0
  for (const line of lines) out.push(hashLabel((running = chainHash(running, line.replace(/\r$/, "")))))
  return out
}

/** old-label -> "N newhash" | "deleted", parsed from the report's map rows. */
const parseMap = (report: string): Map<string, string> => {
  const map = new Map<string, string>()
  for (const line of report.split("\n")) {
    const m = line.match(/^(?:(\d+) +)?([0-9a-f]{8}) -> (?:(\d+) ([0-9a-f]{8})|(deleted))$/)
    if (m) map.set(m[2]!, m[5] ? "deleted" : `${m[3]} ${m[4]}`)
  }
  return map
}

function assistant(parts: unknown[]): MessageV2.WithParts {
  return { info: { id: MessageID.ascending(), role: "assistant", sessionID }, parts } as unknown as MessageV2.WithParts
}

/** A `read` result as a session carries it — the tool's own output, stored on the part. */
function readPart(input: { output: string; filePath: string; released?: { reason: string } }) {
  return {
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "tool",
    callID: "call_" + PartID.ascending(),
    tool: "read",
    state: {
      status: "completed",
      input: { filePath: input.filePath },
      output: input.output,
      title: "file",
      metadata: {},
      time: { start: 1, end: 2 },
      ...(input.released ? { released: input.released } : {}),
    },
  }
}

/** The text the wire carries for a part — what the model is shown. */
const wireText = (part: MessageV2.Part): string => {
  if (part.type !== "tool" || part.state.status !== "completed") return ""
  return MessageV2.replayedToolOutput({ id: part.id, tool: part.tool, state: part.state }).text
}

describe("tool.edit — the map names only the labels still in the window", () => {
  it.live("a read output that left the window takes its labels out of the map", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/a.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))

      // The REAL read tool produces the outputs — the fixture is the tool's own bytes, not a hand-written shape.
      const readInfo = yield* ReadTool
      const read = yield* readInfo.init()
      const gone = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 1, limit: 3 }, baseCtx))
      const held = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 4 }, baseCtx))

      const messages = [
        assistant([
          readPart({
            output: gone.output,
            filePath: file,
            released: { reason: "the edit that needed it is done" },
          }),
          readPart({ output: held.output, filePath: file }),
        ]),
      ]

      // The runtime's own answer: the released result contributes NOTHING, the held one its own three labels.
      const window = windowLabelsFor(messages, file, { base: dir })
      expect(window.size).toBe(3)

      const info = yield* EditTool
      const tool = yield* info.init()
      const old = labelsOf(CONTENT)
      const next = labelsOf("l1\nX\nl3\nl4\nl5\nl6\n")
      const result = yield* provideInstance(dir)(
        tool.execute(
          { files: [{ filePath: file, edits: [{ fromHash: old[2]!, newString: "X" }] }] },
          { ...baseCtx, extra: { windowLabels: (p: string) => windowLabelsFor(messages, p, { base: dir }) } },
        ),
      )

      const map = parseMap(result.output)
      // The three labels the model still holds — and ONLY those.
      expect(map.size).toBe(3)
      expect(map.get(old[4]!)).toBe(`4 ${next[4]!}`)
      expect(map.get(old[5]!)).toBe(`5 ${next[5]!}`)
      expect(map.get(old[6]!)).toBe(`6 ${next[6]!}`)
      // The released read's labels are out of the window: they are NOT in the map.
      expect(map.has(old[2]!)).toBe(false)
      expect(map.has(old[3]!)).toBe(false)
      // The report says so, and names the `read` offset that recovers them.
      expect(result.output).toContain("not in the active window")
    }),
  )

  it.live("the history is byte-identical before and after the edit (the window is read-only input)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/b.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))

      const readInfo = yield* ReadTool
      const read = yield* readInfo.init()
      const first = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 1, limit: 3 }, baseCtx))
      const second = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 4 }, baseCtx))
      const messages = [
        assistant([
          readPart({
            output: first.output,
            filePath: file,
            released: { reason: "the edit that needed it is done" },
          }),
          readPart({ output: second.output, filePath: file }),
        ]),
      ]

      const storedBefore = JSON.stringify(messages)
      const wireBefore = messages.flatMap((message) => message.parts.map(wireText))

      const info = yield* EditTool
      const tool = yield* info.init()
      const old = labelsOf(CONTENT)
      const result = yield* provideInstance(dir)(
        tool.execute(
          { files: [{ filePath: file, edits: [{ fromHash: old[2]!, newString: "X" }] }] },
          { ...baseCtx, extra: { windowLabels: (p: string) => windowLabelsFor(messages, p, { base: dir }) } },
        ),
      )

      // The stored parts are untouched, and so is every byte the wire would carry for them.
      expect(JSON.stringify(messages)).toBe(storedBefore)
      expect(messages.flatMap((message) => message.parts.map(wireText))).toEqual(wireBefore)
      // The map is APPENDED in the edit result — it lives there and nowhere else.
      expect(result.output).toContain("Old labels -> new labels:")
    }),
  )

  it.live("no window to reach: the map stays COMPLETE (a map missing a held label is the worse failure)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/c.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))

      const info = yield* EditTool
      const tool = yield* info.init()
      const old = labelsOf(CONTENT)
      const result = yield* provideInstance(dir)(
        tool.execute({ files: [{ filePath: file, edits: [{ fromHash: old[2]!, newString: "X" }] }] }, baseCtx),
      )

      const map = parseMap(result.output)
      expect(map.size).toBe(5)
      expect(map.get(old[2]!)).toBe("deleted")
      expect(map.get(old[3]!)).toBe(`3 ${labelsOf("l1\nX\nl3\nl4\nl5\nl6\n")[3]!}`)
    }),
  )

  it.live("a file the model never read: the window is EMPTY and the map names nothing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/d.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))

      const other = `${dir}/other.txt`
      yield* Effect.promise(() => fs.writeFile(other, CONTENT))
      const read = yield* (yield* ReadTool).init()
      const otherOut = yield* provideInstance(dir)(read.execute({ filePath: other }, baseCtx))
      const messages = [assistant([readPart({ output: otherOut.output, filePath: other })])]
      expect(windowLabelsFor(messages, file, { base: dir }).size).toBe(0)

      const info = yield* EditTool
      const tool = yield* info.init()
      const old = labelsOf(CONTENT)
      const result = yield* provideInstance(dir)(
        tool.execute(
          { files: [{ filePath: file, edits: [{ fromHash: old[2]!, newString: "X" }] }] },
          { ...baseCtx, extra: { windowLabels: (p: string) => windowLabelsFor(messages, p, { base: dir }) } },
        ),
      )

      expect(parseMap(result.output).size).toBe(0)
    }),
  )
})
