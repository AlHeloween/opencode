import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { PartTable } from "../../src/session/session.sql"
import { MessageV2 } from "../../src/session/message-v2"
import { PartID, MessageID, SessionID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Session as SessionNs } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"
import { eq } from "drizzle-orm"

const projectRoot = require("path").join(__dirname, "../..")
Log.init()

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function remove(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.remove(id)))
}

function updatePart<T extends MessageV2.Part>(part: T) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.updatePart(part)))
}

describe("Part table indexed columns", () => {
  test("text part gets type='text', tool_name=null, status=null", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "part-text-test" })
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()

        await updatePart({
          id: partID,
          messageID,
          sessionID: info.id,
          type: "text",
          text: "hello",
          time: { start: Date.now() },
        } satisfies MessageV2.TextPart)

        await new Promise((resolve) => setTimeout(resolve, 200))

        const rows = Database.use((db) =>
          db.select().from(PartTable).where(eq(PartTable.id, partID)).all(),
        )

        expect(rows.length).toBe(1)
        const row = rows[0]!
        expect(row.type).toBe("text")
        expect(row.tool_name).toBeNull()
        expect(row.status).toBeNull()
        expect(row.data).toBeDefined()

        await remove(info.id)
      },
    })
  })

  test("tool part gets tool_name and status from state", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "tool-columns-test" })
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()

        // Create a tool part
        await updatePart({
          id: partID,
          messageID,
          sessionID: info.id,
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "running",
            input: { command: "echo hello" },
            time: { start: Date.now() },
            metadata: {},
            title: "test command",
          },
        } satisfies MessageV2.ToolPart)

        await new Promise((resolve) => setTimeout(resolve, 200))

        const rows = Database.use((db) =>
          db.select().from(PartTable).where(eq(PartTable.id, partID)).all(),
        )

        expect(rows.length).toBe(1)
        expect(rows[0]!.type).toBe("tool")
        expect(rows[0]!.tool_name).toBe("bash")
        expect(rows[0]!.status).toBe("running")

        await remove(info.id)
      },
    })
  })

  test("tool part status updates on state change", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "tool-status-test" })
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()

        // Insert as running
        await updatePart({
          id: partID,
          messageID,
          sessionID: info.id,
          type: "tool",
          callID: "call-2",
          tool: "read",
          state: {
            status: "running",
            input: { filePath: "/tmp/test" },
            time: { start: Date.now() },
            metadata: {},
            title: "read file",
          },
        } satisfies MessageV2.ToolPart)

        await new Promise((resolve) => setTimeout(resolve, 100))

        // Update to completed
        await updatePart({
          id: partID,
          messageID,
          sessionID: info.id,
          type: "tool",
          callID: "call-2",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "/tmp/test" },
            output: "file contents",
            time: { start: Date.now(), end: Date.now() },
            metadata: {},
            title: "read file",
          },
        } satisfies MessageV2.ToolPart)

        await new Promise((resolve) => setTimeout(resolve, 100))

        const rows = Database.use((db) =>
          db.select().from(PartTable).where(eq(PartTable.id, partID)).all(),
        )

        expect(rows.length).toBe(1)
        expect(rows[0]!.status).toBe("completed")

        await remove(info.id)
      },
    })
  })

  test("hydration still works with indexed columns", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await create({ title: "hydration-test" })
        const messageID = MessageID.ascending()

        // Create message (same pattern as existing session.test.ts)
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) =>
            svc.updateMessage({
              id: messageID,
              sessionID: info.id,
              role: "assistant",
              time: { created: Date.now() },
              agent: "test",
              model: { providerID: "test", modelID: "test" },
              tools: {},
              mode: "",
            } as unknown as MessageV2.Info),
          ),
        )

        await updatePart({
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "text",
          text: "response text",
          time: { start: Date.now() },
        } satisfies MessageV2.TextPart)

        await updatePart({
          id: PartID.ascending(),
          messageID,
          sessionID: info.id,
          type: "reasoning",
          text: "chain of thought",
          time: { start: Date.now(), end: Date.now() },
        } satisfies MessageV2.ReasoningPart)

        await new Promise((resolve) => setTimeout(resolve, 200))

        const hydrated = MessageV2.page({ sessionID: info.id, limit: 10 })
        const msg = hydrated.items.find((m) => m.info.id === messageID)

        expect(msg).toBeDefined()
        expect(msg!.parts.length).toBe(2)

        const textPart = msg!.parts.find((p) => p.type === "text")
        expect(textPart).toBeDefined()
        expect((textPart as any).text).toBe("response text")

        await remove(info.id)
      },
    })
  })

  test("indexes exist on part table after migration", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        // Drizzle ORM select from sqlite_master
        const rows = Database.use((db) =>
          db.all<{ name: string }>(
            `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='part'`,
          ),
        )

        const names = rows.map((r) => r.name)

        // Must include original indexes
        expect(names).toContain("part_message_id_id_idx")
        expect(names).toContain("part_session_idx")

        // Must include new B5 indexes
        expect(names).toContain("part_type_idx")
        expect(names).toContain("part_tool_status_idx")
      },
    })
  })
})
