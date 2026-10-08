import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { ServerHost } from "../../src/server/host"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
import { PartTable } from "../../src/session/session.sql"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init()
setDefaultTimeout(60_000)

/**
 * 2026-10-08 — GET /session/:id/message answered `401 {"_tag":"Unauthorized"}` on the owner's host
 * whenever a page reached a tool part whose `state.input` was the RAW string of a tool call whose
 * JSON never parsed (repair failed). Two defects shared one symptom:
 *
 *   1. the stored part violates `ToolStateError`'s schema (`input: Schema.Record`) — the response
 *      body of the endpoint cannot be encoded (`success: Schema.Array(MessageV2.WithParts)`);
 *   2. the effect HttpApi security loop takes ANY failure of a scheme's middleware — including a
 *      downstream handler failure — as "this credential was rejected", tries the NEXT scheme and
 *      finally answers with the LAST scheme's failure. With the second scheme (`authToken`)
 *      declared, every endpoint failure surfaced as `Unauthorized` — a real failure wearing the
 *      auth status (and, with no credential configured, the handler even re-ran per scheme).
 *
 * These tests pin both: the history must be served whole, and a declared error must report itself.
 */

const RAW_INPUT = `{"files":[{"edits":[{"insertAfter":"567bce19","newString":"x"}]}],"filePath":"_progress_log.md"}`

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((svc) => svc.updatePart(part)))
  },
}

const held: string[] = []

afterEach(async () => {
  for (const worktree of held.splice(0)) ServerHost.release(worktree)
  expect(ServerHost.holding()).toBe(false)
  await Instance.disposeAll()
})

/** The shape an older writer left behind: `state.input` holds the unparsed arguments TEXT. */
function rawToolPart(sessionID: SessionID, messageID: MessageID): MessageV2.Part {
  return {
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "tool",
    tool: "edit",
    callID: "call_repair_failed",
    state: {
      status: "error",
      input: RAW_INPUT,
      error: "AI_ToolCallRepairError: Error repairing tool call: Error: JSON error at line 1, column 1759",
      time: { start: 1, end: 2 },
    },
  } as unknown as MessageV2.Part
}

async function seedUserMessage(sessionID: SessionID) {
  const id = MessageID.ascending()
  await svc.updateMessage({
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: "test", modelID: "test" },
    tools: {},
    mode: "",
  } as unknown as MessageV2.Info)
  return id
}

function request(directory: string, sessionID: SessionID, query = "", headers: Record<string, string> = {}) {
  return Server.Default().app.request(`/session/${sessionID}/message${query}`, {
    headers: { "x-opencode-directory": directory, ...headers },
  })
}

function assertServedWhole(body: MessageV2.WithParts[]) {
  expect(body).toHaveLength(1)
  const part = body[0]!.parts[0] as MessageV2.ToolPart
  expect(part.state.input).toEqual({})
  expect((part.state as { metadata?: Record<string, unknown> }).metadata?.rawInput).toBe(RAW_INPUT)
}

describe("GET /session/:id/message over an unparsed tool input", () => {
  test("a part written through updatePart is stored schema-valid and the history is served whole", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const messageID = await seedUserMessage(session.id)
        await svc.updatePart(rawToolPart(session.id, messageID))

        const res = await request(tmp.path, session.id)
        expect(res.status).toBe(200)
        assertServedWhole((await res.json()) as MessageV2.WithParts[])
      },
    })
  })

  test("a row stored before the write guard (raw insert) is repaired on read", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const messageID = await seedUserMessage(session.id)
        const part = rawToolPart(session.id, messageID) as MessageV2.ToolPart
        // Bypass updatePart — this is what the DB already holds for histories written before the
        // guard. The malformed `state.input` is the point, so the fixture is cast past the types.
        Database.use((db) =>
          db
            .insert(PartTable)
            .values({
              id: part.id,
              message_id: messageID,
              session_id: session.id,
              type: "tool",
              data: { type: "tool", tool: "edit", callID: "call_repair_failed", state: part.state },
            } as unknown as typeof PartTable.$inferInsert)
            .run(),
        )

        const res = await request(tmp.path, session.id)
        expect(res.status).toBe(200)
        assertServedWhole((await res.json()) as MessageV2.WithParts[])
      },
    })
  })

  test("a declared request error reports itself, not Unauthorized", async () => {
    await using tmp = await tmpdir({ git: true })
    held.push(tmp.path)
    // The condition under which the live host answered 401: a command credential is in force.
    await ServerHost.claim(tmp.path, "http://127.0.0.1:0/")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const basic = Buffer.from(`opencode:${ServerHost.token}`).toString("base64")
        // `before` without `limit` is a DECLARED HttpApiError.BadRequest (session.ts:558).
        const before = Buffer.from(JSON.stringify({ id: "msg_00000000000000000000000000", time: 0 })).toString("base64")
        const res = await request(tmp.path, session.id, `?before=${encodeURIComponent(before)}`, {
          authorization: `Basic ${basic}`,
        })
        expect(res.status).toBe(400)
        const body = (await res.json()) as { _tag?: string }
        expect(body._tag).not.toBe("Unauthorized")
      },
    })
  })
})
