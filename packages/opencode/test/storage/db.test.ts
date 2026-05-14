import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { eq } from "drizzle-orm"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Database } from "@/storage/db"
import { tmpdir } from "../fixture/fixture"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"

afterEach(() => {
  Database.close()
})

describe("Database.Path", () => {
  test("returns opencode.db path", () => {
    expect(Database.Path).toBe(Flag.OPENCODE_DB ?? path.join(Global.Path.data, "opencode.db"))
  })

    test("routes real project context to project database", async () => {
    await using tmp = await tmpdir()
    const projectID = ProjectID.make("project_" + crypto.randomUUID())
    const sessionID = SessionID.make("ses_" + crypto.randomUUID())

    Database.withProject(projectID, tmp.path, () =>
      Database.use((db) =>
        db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            slug: "test",
            directory: tmp.path,
            title: "Test",
            version: "0.0.0-test",
            time_created: 1,
            time_updated: 1,
          })
          .run(),
      ),
    )

    const projectRows = Database.getProjectDb(projectID, tmp.path)
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .all()

    expect(projectRows).toHaveLength(1)
  })
})
