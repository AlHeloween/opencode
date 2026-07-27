import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { MessageV2 } from "../session/message-v2"
import type { SessionEntry } from "../v2/session-entry"
import type { Snapshot } from "../snapshot"
import type { Permission } from "../permission"
import type { ProjectID } from "../project/schema"
import type { SessionID, MessageID, PartID } from "../session/schema"
import type { WorkspaceID } from "../control-plane/schema"
import { Timestamps } from "./schema.sql"

export { Timestamps }

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<SessionID>().primaryKey(),
    project_id: text().$type<ProjectID>().notNull(),
    workspace_id: text().$type<WorkspaceID>(),
    parent_id: text().$type<SessionID>(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: MessageID; partID?: PartID; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<Permission.Ruleset>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text().$type<SessionID>().notNull(),
    ...Timestamps,
    /** Soft-hide flag promoted from JSON data.compacted for indexable visible loads. */
    compacted: integer().notNull().default(0),
    data: text({ mode: "json" }).notNull().$type<InfoData>(),
  },
  (table) => [
    index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id),
    index("message_session_compacted_time_id_idx").on(
      table.session_id,
      table.compacted,
      table.time_created,
      table.id,
    ),
  ],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text().$type<MessageID>().notNull(),
    session_id: text().$type<SessionID>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<PartData>(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text().$type<SessionID>().notNull(),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const SessionEntryTable = sqliteTable(
  "session_entry",
  {
    id: text().$type<SessionEntry.ID>().primaryKey(),
    session_id: text().$type<SessionID>().notNull(),
    type: text().$type<SessionEntry.Type>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<Omit<SessionEntry.Entry, "type" | "id">>(),
  },
  (table) => [
    index("session_entry_session_idx").on(table.session_id),
    index("session_entry_session_type_idx").on(table.session_id, table.type),
    index("session_entry_time_created_idx").on(table.time_created),
  ],
)

export const PermissionTable = sqliteTable("permission", {
  project_id: text().$type<ProjectID>().primaryKey(),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<Permission.Ruleset>(),
})

export const EventTable = sqliteTable("event", {
  id: text().primaryKey(),
  aggregate_id: text().notNull(),
  seq: integer().notNull(),
  type: text().notNull(),
  data: text({ mode: "json" }).$type<Record<string, unknown>>().notNull(),
})

/** Sidecar project checkpoints stay outside Message/Part until Layer-2 compaction. */
export const ProjectCheckpointTable = sqliteTable(
  "project_checkpoint",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    from_message_id: text().$type<MessageID>().notNull(),
    to_message_id: text().$type<MessageID>().notNull(),
    predecessor_id: text().notNull().default(""),
    provider_id: text().notNull(),
    model_id: text().notNull(),
    agent: text().notNull(),
    body: text().notNull(),
    diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    impact: text({ mode: "json" }).$type<Snapshot.ImpactSummary>(),
    materialized_message_id: text().$type<MessageID>(),
    time_materialized: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("project_checkpoint_session_range_predecessor_idx").on(
      table.session_id,
      table.from_message_id,
      table.to_message_id,
      table.predecessor_id,
    ),
    index("project_checkpoint_session_created_idx").on(table.session_id, table.time_created),
    index("project_checkpoint_session_materialized_idx").on(table.session_id, table.time_materialized),
  ],
)
