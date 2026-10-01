import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event, EventMessagePartUpdated, ToolStatePending, ToolStateRunning } from "@opencode-ai/sdk/v2"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>

type GlobalEventEnvelope = {
  directory?: string
  payload?: Event
}

type EventController = {
  push: (event: GlobalEventEnvelope) => void
  close: () => void
}

function inProgressText(update: SessionUpdateParams["update"]) {
  if (update.sessionUpdate !== "tool_call_update") return undefined
  if (update.status !== "in_progress") return undefined
  if (!update.content || !Array.isArray(update.content)) return undefined
  const first = update.content[0]
  if (!first || first.type !== "content") return undefined
  if (first.content.type !== "text") return undefined
  return first.content.text
}

function isToolCallUpdate(
  update: SessionUpdateParams["update"],
): update is Extract<SessionUpdateParams["update"], { sessionUpdate: "tool_call_update" }> {
  return update.sessionUpdate === "tool_call_update"
}

function toolEvent(
  sessionId: string,
  cwd: string,
  opts: {
    callID: string
    tool: string
    input: Record<string, unknown>
  } & ({ status: "running"; metadata?: Record<string, unknown> } | { status: "pending"; raw: string }),
): GlobalEventEnvelope {
  const state: ToolStatePending | ToolStateRunning =
    opts.status === "running"
      ? {
          status: "running",
          input: opts.input,
          ...(opts.metadata && { metadata: opts.metadata }),
          time: { start: Date.now() },
        }
      : {
          status: "pending",
          input: opts.input,
          raw: opts.raw,
        }
  const payload: EventMessagePartUpdated = {
    type: "message.part.updated",
    properties: {
      sessionID: sessionId,
      time: Date.now(),
      part: {
        id: `part_${opts.callID}`,
        sessionID: sessionId,
        messageID: `msg_${opts.callID}`,
        type: "tool",
        callID: opts.callID,
        tool: opts.tool,
        state,
      },
    },
  }
  return { directory: cwd, payload }
}

function createEventStream() {
  const queue: GlobalEventEnvelope[] = []
  const waiters: Array<(value: GlobalEventEnvelope | undefined) => void> = []
  const state = { closed: false }

  const push = (event: GlobalEventEnvelope) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    queue.push(event)
  }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) {
      waiter(undefined)
    }
  }

  const stream = async function* (signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) return
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (state.closed) return
      const value = await new Promise<GlobalEventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { controller: { push, close } satisfies EventController, stream }
}

function createFakeAgent() {
  const updates = new Map<string, string[]>()
  const chunks = new Map<string, string>()
  const sessionUpdates: SessionUpdateParams[] = []
  const record = (sessionId: string, type: string) => {
    const list = updates.get(sessionId) ?? []
    list.push(type)
    updates.set(sessionId, list)
  }

  const connection = {
    async sessionUpdate(params: SessionUpdateParams) {
      sessionUpdates.push(params)
      const update = params.update
      const type = update?.sessionUpdate ?? "unknown"
      record(params.sessionId, type)
      if (update?.sessionUpdate === "agent_message_chunk") {
        const content = update.content
        if (content?.type !== "text") return
        if (typeof content.text !== "string") return
        chunks.set(params.sessionId, (chunks.get(params.sessionId) ?? "") + content.text)
      }
    },
    async requestPermission(_params: RequestPermissionParams): Promise<RequestPermissionResult> {
      return { outcome: { outcome: "selected", optionId: "once" } } as RequestPermissionResult
    },
  } as unknown as AgentSideConnection

  const { controller, stream } = createEventStream()
  const calls = {
    eventSubscribe: 0,
    sessionCreate: 0,
  }

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => {
        calls.eventSubscribe++
        return { stream: stream(opts?.signal) }
      },
    },
    session: {
      create: async (_params?: any) => {
        calls.sessionCreate++
        return {
          data: {
            id: `ses_${calls.sessionCreate}`,
            time: { created: new Date().toISOString() },
          },
        }
      },
      get: async (_params?: any) => {
        return {
          data: {
            id: "ses_1",
            time: { created: new Date().toISOString() },
          },
        }
      },
      messages: async () => {
        return { data: [] }
      },
      message: async (params?: any) => {
        // Return a message with parts that can be looked up by partID
        return {
          data: {
            info: {
              role: "assistant",
            },
            parts: [
              {
                id: params?.messageID ? `${params.messageID}_part` : "part_1",
                type: "text",
                text: "",
              },
            ],
          },
        }
      },
    },
    permission: {
      respond: async () => {
        return { data: true }
      },
    },
    config: {
      providers: async () => {
        return {
          data: {
            providers: [
              {
                id: "opencode",
                name: "opencode",
                models: {
                  "big-pickle": { id: "big-pickle", name: "big-pickle" },
                },
              },
            ],
          },
        }
      },
    },
    app: {
      agents: async () => {
        return {
          data: [
            {
              name: "build",
              description: "build",
              mode: "agent",
            },
          ],
        }
      },
    },
    command: {
      list: async () => {
        return { data: [] }
      },
    },
    mcp: {
      add: async () => {
        return { data: true }
      },
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  const stop = () => {
    controller.close()
    ;(agent as any).eventAbort.abort()
  }

  return { agent, controller, calls, updates, chunks, sessionUpdates, stop, sdk, connection }
}

describe("acp.agent event subscription", () => {
  test("routes message.part.delta by the event sessionID (no cross-session pollution)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, updates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "message.part.delta",
            properties: {
              sessionID: sessionB,
              messageID: "msg_1",
              partID: "msg_1_part",
              field: "text",
              delta: "hello",
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 10))

        expect((updates.get(sessionA) ?? []).includes("agent_message_chunk")).toBe(false)
        expect((updates.get(sessionB) ?? []).includes("agent_message_chunk")).toBe(true)

        stop()
      },
    })
  })

  test("does not emit user_message_chunk for live prompt parts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "message.part.updated",
            properties: {
              sessionID: sessionId,
              time: Date.now(),
              part: {
                id: "part_1",
                sessionID: sessionId,
                messageID: "msg_user",
                type: "text",
                text: "hello",
              },
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(
          sessionUpdates
            .filter((u) => u.sessionId === sessionId)
            .some((u) => u.update.sessionUpdate === "user_message_chunk"),
        ).toBe(false)

        stop()
      },
    })
  })

  test("keeps concurrent sessions isolated when message.part.delta events are interleaved", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, chunks, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        const tokenA = ["ALPHA_", "111", "_X"]
        const tokenB = ["BETA_", "222", "_Y"]

        const push = (sessionId: string, messageID: string, delta: string) => {
          controller.push({
            directory: cwd,
            payload: {
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                messageID,
                partID: `${messageID}_part`,
                field: "text",
                delta,
              },
            },
          } as any)
        }

        push(sessionA, "msg_a", tokenA[0])
        push(sessionB, "msg_b", tokenB[0])
        push(sessionA, "msg_a", tokenA[1])
        push(sessionB, "msg_b", tokenB[1])
        push(sessionA, "msg_a", tokenA[2])
        push(sessionB, "msg_b", tokenB[2])

        await new Promise((r) => setTimeout(r, 20))

        const a = chunks.get(sessionA) ?? ""
        const b = chunks.get(sessionB) ?? ""

        expect(a).toContain(tokenA.join(""))
        expect(b).toContain(tokenB.join(""))
        for (const part of tokenB) expect(a).not.toContain(part)
        for (const part of tokenA) expect(b).not.toContain(part)

        stop()
      },
    })
  })

  test("does not create additional event subscriptions on repeated loadSession()", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, calls, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)

        expect(calls.eventSubscribe).toBe(1)

        stop()
      },
    })
  })

  test("permission.asked events are handled and replied", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const permissionReplies: string[] = []
        const { agent, controller, stop, sdk } = createFakeAgent()
        sdk.permission.reply = async (params: any) => {
          permissionReplies.push(params.requestID)
          return { data: true }
        }
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "permission.asked",
            properties: {
              id: "perm_1",
              sessionID: sessionA,
              permission: "bash",
              patterns: ["*"],
              metadata: {},
              always: [],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(permissionReplies).toContain("perm_1")

        stop()
      },
    })
  })

  test("permission prompt on session A does not block message updates for session B", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const permissionReplies: string[] = []
        let resolvePermissionA: (() => void) | undefined
        const permissionABlocking = new Promise<void>((r) => {
          resolvePermissionA = r
        })

        const { agent, controller, chunks, stop, sdk, connection } = createFakeAgent()

        // Make permission request for session A block until we release it
        const originalRequestPermission = connection.requestPermission.bind(connection)
        let _permissionCalls = 0
        connection.requestPermission = async (params: RequestPermissionParams) => {
          _permissionCalls++
          if (params.sessionId.endsWith("1")) {
            await permissionABlocking
          }
          return originalRequestPermission(params)
        }

        sdk.permission.reply = async (params: any) => {
          permissionReplies.push(params.requestID)
          return { data: true }
        }

        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        // Push permission.asked for session A (will block)
        controller.push({
          directory: cwd,
          payload: {
            type: "permission.asked",
            properties: {
              id: "perm_a",
              sessionID: sessionA,
              permission: "bash",
              patterns: ["*"],
              metadata: {},
              always: [],
            },
          },
        } as any)

        // Give time for permission handling to start
        await new Promise((r) => setTimeout(r, 10))

        // Push message for session B while A's permission is pending
        controller.push({
          directory: cwd,
          payload: {
            type: "message.part.delta",
            properties: {
              sessionID: sessionB,
              messageID: "msg_b",
              partID: "msg_b_part",
              field: "text",
              delta: "session_b_message",
            },
          },
        } as any)

        // Wait for session B's message to be processed
        await new Promise((r) => setTimeout(r, 20))

        // Session B should have received message even though A's permission is still pending
        expect(chunks.get(sessionB) ?? "").toContain("session_b_message")
        expect(permissionReplies).not.toContain("perm_a")

        // Release session A's permission
        resolvePermissionA!()
        await new Promise((r) => setTimeout(r, 20))

        // Now session A's permission should be replied
        expect(permissionReplies).toContain("perm_a")

        stop()
      },
    })
  })

  test("streams running bash output snapshots and de-dupes identical snapshots", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hello", description: "run command" }

        for (const output of ["a", "a", "ab"]) {
          controller.push(
            toolEvent(sessionId, cwd, {
              callID: "call_1",
              tool: "bash",
              status: "running",
              input,
              metadata: { output },
            }),
          )
        }
        await new Promise((r) => setTimeout(r, 20))

        const snapshots = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .filter((u) => isToolCallUpdate(u.update))
          .map((u) => inProgressText(u.update))

        expect(snapshots).toEqual(["a", undefined, "ab"])
        stop()
      },
    })
  })

  test("emits synthetic pending before first running update for any tool", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_bash",
            tool: "bash",
            status: "running",
            input: { command: "echo hi", description: "run command" },
            metadata: { output: "hi\n" },
          }),
        )
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_read",
            tool: "read",
            status: "running",
            input: { filePath: "/tmp/example.txt" },
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const types = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update.sessionUpdate)
          .filter((u) => u === "tool_call" || u === "tool_call_update")
        expect(types).toEqual(["tool_call", "tool_call_update", "tool_call", "tool_call_update"])

        const pendings = sessionUpdates.filter(
          (u) => u.sessionId === sessionId && u.update.sessionUpdate === "tool_call",
        )
        expect(pendings.every((p) => p.update.sessionUpdate === "tool_call" && p.update.status === "pending")).toBe(
          true,
        )
        stop()
      },
    })
  })

  test("does not emit duplicate synthetic pending after replayed running tool", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop, sdk } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hi", description: "run command" }

        sdk.session.messages = async () => ({
          data: [
            {
              info: {
                role: "assistant",
                sessionID: sessionId,
              },
              parts: [
                {
                  type: "tool",
                  callID: "call_1",
                  tool: "bash",
                  state: {
                    status: "running",
                    input,
                    metadata: { output: "hi\n" },
                    time: { start: Date.now() },
                  },
                },
              ],
            },
          ],
        })

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "running",
            input,
            metadata: { output: "hi\nthere\n" },
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const types = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update)
          .filter((u) => "toolCallId" in u && u.toolCallId === "call_1")
          .map((u) => u.sessionUpdate)
          .filter((u) => u === "tool_call" || u === "tool_call_update")

        expect(types).toEqual(["tool_call", "tool_call_update", "tool_call_update"])
        stop()
      },
    })
  })

  test("clears bash snapshot marker on pending state", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hello", description: "run command" }

        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "running",
            input,
            metadata: { output: "a" },
          }),
        )
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "pending",
            input,
            raw: '{"command":"echo hello"}',
          }),
        )
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "running",
            input,
            metadata: { output: "a" },
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const snapshots = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .filter((u) => isToolCallUpdate(u.update))
          .map((u) => inProgressText(u.update))

        expect(snapshots).toEqual(["a", "a"])
        stop()
      },
    })
  })
})

// The batch `edit` tool takes `{ files: [{ filePath, edits }] }` and reports `metadata.filediffs` (one unified
// patch per file, no full old/new text); `write` takes `{ filePath, content }` and reports `exists` + filediffs.
function completedTool(
  sessionId: string,
  opts: { callID: string; tool: string; input: Record<string, unknown>; metadata: Record<string, unknown> },
) {
  return {
    id: `part_${opts.callID}`,
    sessionID: sessionId,
    messageID: `msg_${opts.callID}`,
    type: "tool" as const,
    callID: opts.callID,
    tool: opts.tool,
    state: {
      status: "completed" as const,
      input: opts.input,
      output: "Edit applied successfully to 2 files.",
      title: "2 files",
      metadata: opts.metadata,
      time: { start: Date.now(), end: Date.now() },
    },
  }
}

const batchEdit = {
  callID: "call_edit",
  tool: "edit",
  input: {
    files: [
      { filePath: "/repo/a.ts", edits: [{ fromHash: "a1b2", newString: "const a = 2" }] },
      { filePath: "/repo/b.ts", content: "export {}\n" },
    ],
  },
  metadata: {
    diagnostics: {},
    filediffs: [
      { file: "/repo/a.ts", patch: "@@ -1 +1 @@\n-const a = 1\n+const a = 2\n", additions: 1, deletions: 1 },
      { file: "/repo/b.ts", patch: "@@ -0,0 +1 @@\n+export {}\n", additions: 1, deletions: 0 },
    ],
  },
}

function completedContent(sessionUpdates: SessionUpdateParams[], callID: string) {
  return sessionUpdates
    .map((u) => u.update)
    .filter(isToolCallUpdate)
    .filter((u) => u.toolCallId === callID && u.status === "completed")
    .flatMap((u) => u.content ?? [])
}

describe("acp.agent edit-kind tool content", () => {
  async function live(opts: Parameters<typeof completedTool>[1]) {
    const { agent, controller, sessionUpdates, stop } = createFakeAgent()
    const cwd = "/tmp/opencode-acp-test"
    const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
    controller.push({
      directory: cwd,
      payload: {
        type: "message.part.updated",
        properties: { sessionID: sessionId, time: Date.now(), part: completedTool(sessionId, opts) },
      } as EventMessagePartUpdated,
    })
    await new Promise((r) => setTimeout(r, 20))
    stop()
    return completedContent(sessionUpdates, opts.callID)
  }

  async function replayed(opts: Parameters<typeof completedTool>[1]) {
    const { agent, sessionUpdates, stop, sdk } = createFakeAgent()
    const cwd = "/tmp/opencode-acp-test"
    const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
    sdk.session.messages = async () => ({
      data: [{ info: { role: "assistant", sessionID: sessionId }, parts: [completedTool(sessionId, opts)] }],
    })
    await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
    stop()
    return completedContent(sessionUpdates, opts.callID)
  }

  const patchFor = (file: string, patch: string) => ({
    type: "content",
    content: { type: "text", text: `${file}\n\`\`\`diff\n${patch}\n\`\`\`` },
  })

  for (const [site, emit] of [
    ["live event", live],
    ["history replay", replayed],
  ] as const) {
    test(`${site}: a batch edit reports one patch per file and no fabricated diff`, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const content = await emit(batchEdit)
          expect(content.filter((c) => c.type === "diff")).toEqual([])
          expect(content.slice(1)).toEqual(
            batchEdit.metadata.filediffs.map((fd) => patchFor(fd.file, fd.patch)) as typeof content,
          )
        },
      })
    })

    test(`${site}: a write that creates a file is a full diff with no old text`, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const content = await emit({
            callID: "call_write_new",
            tool: "write",
            input: { filePath: "/repo/new.ts", content: "export const x = 1\n" },
            metadata: {
              exists: false,
              filediffs: [
                { file: "/repo/new.ts", patch: "@@ -0,0 +1 @@\n+export const x = 1\n", additions: 1, deletions: 0 },
              ],
            },
          })
          expect(content.slice(1)).toEqual([
            { type: "diff", path: "/repo/new.ts", oldText: null, newText: "export const x = 1\n" },
          ])
        },
      })
    })

    test(`${site}: a write over an existing file reports its patch, not an empty old text`, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const patch = "@@ -1 +1 @@\n-export const x = 1\n+export const x = 2\n"
          const content = await emit({
            callID: "call_write_over",
            tool: "write",
            input: { filePath: "/repo/old.ts", content: "export const x = 2\n" },
            metadata: { exists: true, filediffs: [{ file: "/repo/old.ts", patch, additions: 1, deletions: 1 }] },
          })
          expect(content.slice(1)).toEqual([patchFor("/repo/old.ts", patch)] as typeof content)
        },
      })
    })
  }

  test("a running batch edit locates every file it names", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        controller.push(
          toolEvent(sessionId, cwd, { callID: "call_edit", tool: "edit", status: "running", input: batchEdit.input }),
        )
        await new Promise((r) => setTimeout(r, 20))
        stop()
        const running = sessionUpdates
          .map((u) => u.update)
          .filter(isToolCallUpdate)
          .find((u) => u.status === "in_progress")
        expect(running?.locations).toEqual([{ path: "/repo/a.ts" }, { path: "/repo/b.ts" }])
      },
    })
  })
})
