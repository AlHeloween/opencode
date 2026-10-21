/**
 * t137 — the runtime's own replay selection, and the caller that hands it to the tool.
 *
 * Two things are pinned here, and they are the two halves of the feature:
 *
 * 1. WHAT the window is. It is not «the labels the model once saw» and not a reconstruction from prose — it is
 *    what the runtime's own replay puts on the wire. A released result, a cleared one, a folded one, a narrowed
 *    `kept` one and an expired one have LEFT the window; everything else is still there.
 * 2. WHO hands it over. The `SessionTools.resolve` catalog is the only producer of a `Tool.Context`, so the
 *    resolver that reaches the tool is built there — and the REAL resolve is exercised here, not a stand-in.
 */
import { afterEach, describe, expect, setDefaultTimeout } from "bun:test"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { ReadTool, chainHash, hashLabel } from "../../src/tool/read"
import { MessageV2 } from "../../src/session/message-v2"
import { windowLabelsFor } from "../../src/session/window-labels"
import { Agent } from "@/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { ProviderID } from "@/provider/schema"
import { MessageID, PartID, SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { SessionProcessor } from "@/session/processor"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Bus } from "@/bus"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import { Instance } from "@/project/instance"
import { ProviderTest } from "../fake/provider"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Instruction } from "@/session/instruction"

setDefaultTimeout(30_000)

afterEach(async () => {
  await Instance.disposeAll()
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.die("unexpected MCP add"),
    connect: () => Effect.die("unexpected MCP connect"),
    disconnect: () => Effect.die("unexpected MCP disconnect"),
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    callTool: () => Effect.die("unexpected MCP tool execution"),
    supportsOAuth: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
    startAuth: () => Effect.die("unexpected MCP startAuth"),
    authenticate: () => Effect.die("unexpected MCP authenticate"),
    finishAuth: () => Effect.die("unexpected MCP finishAuth"),
    removeAuth: () => Effect.die("unexpected MCP removeAuth"),
    hasStoredTokens: () => Effect.succeed(false),
  }),
)

/** The permission service, stubbed: the ask is a USER's decision, and this fixture is not a user. */
const permission = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    ask: () => Effect.void,
    reply: () => Effect.void,
    list: () => Effect.succeed([]),
  }),
)

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
    Plugin.defaultLayer,
    ToolRegistry.defaultLayer,
    mcp,
    permission,
  ),
)

const sessionID = SessionID.make("ses_test-t137-window")
const messageID = MessageID.make("")

const CONTENT = "l1\nl2\nl3\nl4\nl5\nl6\n"

const labelsOf = (content: string): string[] => {
  const lines = content.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  const out = [hashLabel(0)]
  let running = 0
  for (const line of lines) out.push(hashLabel((running = chainHash(running, line.replace(/\r$/, "")))))
  return out
}

function assistant(parts: unknown[]): MessageV2.WithParts {
  return { info: { id: MessageID.ascending(), role: "assistant", sessionID }, parts } as unknown as MessageV2.WithParts
}

function readPart(input: {
  output: string
  filePath: string
  released?: { reason: string }
  kept?: { from: number; to: number }
}) {
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
      ...(input.kept ? { kept: input.kept } : {}),
    },
  }
}

describe("session.window-labels — what the runtime's own replay leaves in the window", () => {
  it.live("a released result contributes NOTHING; a held one contributes exactly its rows", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/a.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))

      const readInfo = yield* ReadTool
      const read = yield* readInfo.init()
      const ctx = {
        sessionID,
        messageID,
        callID: "",
        agent: "build",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }
      const first = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 1, limit: 3 }, ctx))
      const second = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 4 }, ctx))

      const held = windowLabelsFor(
        [assistant([readPart({ output: second.output, filePath: file })])],
        file,
        { base: dir },
      )
      expect(held.size).toBe(3)
      const labels = labelsOf(CONTENT)
      expect(held.has(labels[4]!)).toBe(true)
      expect(held.has(labels[1]!)).toBe(false)

      // The same result, released: the wire carries a placeholder, and the labels are gone from the window.
      const gone = windowLabelsFor(
        [assistant([readPart({ output: first.output, filePath: file, released: { reason: "done with it" } })])],
        file,
        { base: dir },
      )
      expect(gone.size).toBe(0)
    }),
  )

  it.live("a kept selection contributes only the rows it kept", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/b.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))

      const readInfo = yield* ReadTool
      const read = yield* readInfo.init()
      const ctx = {
        sessionID,
        messageID,
        callID: "",
        agent: "build",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }
      const whole = yield* provideInstance(dir)(read.execute({ filePath: file }, ctx))

      // A kept selection is ROWS without the header — the file is then named by the call's own input.
      const kept = windowLabelsFor(
        [assistant([readPart({ output: whole.output, filePath: file, kept: { from: 4, to: 6 } })])],
        file,
        { base: dir },
      )
      const labels = labelsOf(CONTENT)
      expect(kept.size).toBe(3)
      expect(kept.has(labels[4]!)).toBe(true)
      expect(kept.has(labels[1]!)).toBe(false)
    }),
  )

  it.live("a file the session never read: the window is EMPTY, and that is an answer", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/c.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))
      expect(windowLabelsFor([assistant([])], file, { base: dir }).size).toBe(0)
    }),
  )
})

describe("session.tools — the caller hands the window to the tool", () => {
  it.live("the REAL resolve: the edit tool's map names only the in-window labels", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = `${dir}/d.txt`
      yield* Effect.promise(() => fs.writeFile(file, CONTENT))

      const readInfo = yield* ReadTool
      const read = yield* readInfo.init()
      const readCtx = {
        sessionID,
        messageID,
        callID: "",
        agent: "build",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }
      const first = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 1, limit: 3 }, readCtx))
      const second = yield* provideInstance(dir)(read.execute({ filePath: file, offset: 4 }, readCtx))

      const messages = [
        assistant([
          readPart({ output: first.output, filePath: file, released: { reason: "done with it" } }),
          readPart({ output: second.output, filePath: file }),
        ]),
      ]

      // The agent and the catalog are read INSIDE the instance: the identity of the session is part of them.
      const resolved = yield* provideInstance(dir)(
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          const agent = yield* agents.get("build")
          const model = ProviderTest.model({ providerID: ProviderID.make("test") })
          return yield* SessionTools.resolve({
            agent: agent!,
            providerAgent: agent!,
            model,
            session: { id: sessionID, permission: [] } as unknown as Session.Info,
            processor: {
              message: { id: MessageID.ascending() } as SessionProcessor.Handle["message"],
              updateToolCall: () => Effect.succeed(undefined),
              completeToolCall: () => Effect.succeed(undefined),
            } as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
            bypassAgentCheck: false,
            messages: () => messages,
            promptOps: {
              cancel: () => Effect.void,
              resolvePromptParts: () => Effect.succeed([]),
              prompt: () => Effect.die("unexpected task prompt"),
            },
          })
        }),
      )

      const edit = resolved["edit"]
      expect(edit).toBeDefined()

      const labels = labelsOf(CONTENT)
      const outcome = (yield* Effect.promise(() =>
        (edit as unknown as { execute: (a: unknown, o: unknown) => Promise<{ output: string }> }).execute(
          { files: [{ filePath: file, edits: [{ fromHash: labels[2]!, newString: "X" }] }] },
          { toolCallId: "call_edit_1", messages: [], abortSignal: new AbortController().signal },
        ),
      )) as unknown as { output: string }

      // The map names the three labels the model still holds — and NOT the released read's two.
      const map = new Map<string, string>()
      for (const line of outcome.output.split("\n")) {
        const m = line.match(/^(?:(\d+) +)?([0-9a-f]{8}) -> (?:(\d+) ([0-9a-f]{8})|(deleted))$/)
        if (m) map.set(m[2]!, m[5] ? "deleted" : `${m[3]} ${m[4]}`)
      }
      expect(map.size).toBe(3)
      expect(map.has(labels[2]!)).toBe(false)
      expect(map.has(labels[3]!)).toBe(false)
      expect(outcome.output).toContain("not in the active window")
    }),
  )
})
