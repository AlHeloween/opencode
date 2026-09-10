import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ProjectDatabaseFix } from "@/project/database-fix"
import { ProjectTable } from "@/project/project.sql"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import { SessionTable } from "@/session/session.sql"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Database.close())

describe("ProjectDatabaseFix", () => {
  test("remaps only paths below the selected previous worktree", async () => {
    await using tmp = await tmpdir()
    const oldRoot = "C:\\archive\\bin\\_tst\\stable"
    const projectID = ProjectID.make("project_" + crypto.randomUUID())
    const otherProjectID = ProjectID.make("project_" + crypto.randomUUID())
    const sessionID = SessionID.make("ses_" + crypto.randomUUID())
    const otherSessionID = SessionID.make("ses_" + crypto.randomUUID())

    Database.withProject(projectID, tmp.path, () =>
      Database.use((db) => {
        db.insert(ProjectTable)
          .values([
            { id: projectID, worktree: oldRoot, sandboxes: [], time_created: 1, time_updated: 1 },
            { id: otherProjectID, worktree: tmp.path, sandboxes: [], time_created: 1, time_updated: 1 },
          ])
          .run()
        db.insert(SessionTable)
          .values([
            { id: sessionID, project_id: projectID, slug: "moved", directory: `${oldRoot}\\nested`, title: "Moved", version: "test", time_created: 1, time_updated: 1 },
            { id: otherSessionID, project_id: otherProjectID, slug: "other", directory: "C:\\other\\nested", title: "Other", version: "test", time_created: 1, time_updated: 1 },
          ])
          .run()
      }),
    )
    Database.close()

    const result = ProjectDatabaseFix.run({ directory: tmp.path })

    expect(result.projects).toBe(1)
    expect(result.sessions).toBe(1)
    const db = Database.getProjectDb(projectID, tmp.path)
    expect(db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get()?.worktree).toBe(tmp.path)
    expect(db.select().from(ProjectTable).where(eq(ProjectTable.id, otherProjectID)).get()?.worktree).toBe(tmp.path)
    expect(db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()?.directory).toBe(`${tmp.path}\\nested`)
    expect(db.select().from(SessionTable).where(eq(SessionTable.id, otherSessionID)).get()?.directory).toBe("C:\\other\\nested")
  })

  test("falls back to one saved session path when an earlier startup overwrote the project root", async () => {
    await using tmp = await tmpdir()
    const oldRoot = "C:\\archive\\bin\\_tst\\stable"
    const projectID = ProjectID.make("project_" + crypto.randomUUID())
    const sessionID = SessionID.make("ses_" + crypto.randomUUID())

    Database.withProject(projectID, tmp.path, () =>
      Database.use((db) => {
        db.insert(ProjectTable)
          .values({ id: projectID, worktree: tmp.path, sandboxes: [], time_created: 1, time_updated: 1 })
          .run()
        db.insert(SessionTable)
          .values({ id: sessionID, project_id: projectID, slug: "moved", directory: oldRoot, title: "Moved", version: "test", time_created: 1, time_updated: 1 })
          .run()
      }),
    )
    Database.close()

    const result = ProjectDatabaseFix.run({ directory: tmp.path })

    expect(result.from).toBe(oldRoot)
    expect(result.projects).toBe(0)
    expect(result.sessions).toBe(1)
    expect(Database.getProjectDb(projectID, tmp.path).select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()?.directory).toBe(tmp.path)
  })
})
