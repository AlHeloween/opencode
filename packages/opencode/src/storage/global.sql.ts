import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import type { ProjectID } from "../project/schema"
import type { SessionID } from "../session/schema"
import type { WorkspaceID } from "../control-plane/schema"

export const SessionIndexTable = sqliteTable("session_index", {
  id: text().$type<SessionID>().primaryKey(),
  project_id: text().$type<ProjectID>().notNull(),
  directory: text().notNull(),
  title: text().notNull(),
  parent_id: text().$type<SessionID>(),
  workspace_id: text().$type<WorkspaceID>(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
  time_archived: integer(),
})
