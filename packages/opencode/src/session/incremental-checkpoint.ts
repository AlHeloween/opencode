import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { Database } from "@/storage/db"
import type { Snapshot } from "@/snapshot"
import type { PlanStatePayload } from "@/util/plan-status"
import { ProjectCheckpointTable } from "./session.sql"
import type { MessageID, SessionID } from "./schema"

export interface Record {
  id: string
  sessionID: SessionID
  fromMessageID: MessageID
  toMessageID: MessageID
  predecessorID?: string
  providerID: string
  modelID: string
  agent: string
  body: string
  diffs?: Snapshot.FileDiff[]
  impact?: Snapshot.ImpactSummary
  planState?: PlanStatePayload
  materializedMessageID?: MessageID
  timeCreated: number
  timeMaterialized?: number
}

function fromRow(row: typeof ProjectCheckpointTable.$inferSelect): Record {
  return {
    id: row.id,
    sessionID: row.session_id,
    fromMessageID: row.from_message_id,
    toMessageID: row.to_message_id,
    predecessorID: row.predecessor_id || undefined,
    providerID: row.provider_id,
    modelID: row.model_id,
    agent: row.agent,
    body: row.body,
    diffs: row.diffs ?? undefined,
    impact: row.impact ?? undefined,
    planState: row.plan_state ?? undefined,
    materializedMessageID: row.materialized_message_id ?? undefined,
    timeCreated: row.time_created,
    timeMaterialized: row.time_materialized ?? undefined,
  }
}

export function listOpen(sessionID: SessionID): Record[] {
  return Database.use((db) =>
    db
      .select()
      .from(ProjectCheckpointTable)
      .where(and(eq(ProjectCheckpointTable.session_id, sessionID), isNull(ProjectCheckpointTable.time_materialized)))
      .orderBy(asc(ProjectCheckpointTable.time_created), asc(ProjectCheckpointTable.id))
      .all()
      .map(fromRow),
  )
}

export function latestOpen(sessionID: SessionID): Record | undefined {
  return listOpen(sessionID).at(-1)
}

/** All checkpoints for a session — open AND materialized, oldest first. */
export function listAll(sessionID: SessionID): Record[] {
  return Database.use((db) =>
    db
      .select()
      .from(ProjectCheckpointTable)
      .where(eq(ProjectCheckpointTable.session_id, sessionID))
      .orderBy(asc(ProjectCheckpointTable.time_created), asc(ProjectCheckpointTable.id))
      .all()
      .map(fromRow),
  )
}

export function save(input: Omit<Record, "timeCreated" | "timeMaterialized" | "materializedMessageID">): Record {
  return Database.use((db) => {
    db.insert(ProjectCheckpointTable)
      .values({
        id: input.id,
        session_id: input.sessionID,
        from_message_id: input.fromMessageID,
        to_message_id: input.toMessageID,
        predecessor_id: input.predecessorID ?? "",
        provider_id: input.providerID,
        model_id: input.modelID,
        agent: input.agent,
        body: input.body,
        diffs: input.diffs,
        impact: input.impact,
        plan_state: input.planState,
      })
      .onConflictDoNothing()
      .run()

    const row = db
      .select()
      .from(ProjectCheckpointTable)
      .where(
        and(
          eq(ProjectCheckpointTable.session_id, input.sessionID),
          eq(ProjectCheckpointTable.from_message_id, input.fromMessageID),
          eq(ProjectCheckpointTable.to_message_id, input.toMessageID),
          eq(ProjectCheckpointTable.predecessor_id, input.predecessorID ?? ""),
        ),
      )
      .get()
    if (!row) throw new Error("Project checkpoint insert did not produce a row")
    return fromRow(row)
  })
}

export function materialize(input: { sessionID: SessionID; ids: string[]; messageID: MessageID }) {
  if (input.ids.length === 0) return
  Database.use((db) =>
    db
      .update(ProjectCheckpointTable)
      .set({ materialized_message_id: input.messageID, time_materialized: Date.now() })
      .where(
        and(
          eq(ProjectCheckpointTable.session_id, input.sessionID),
          isNull(ProjectCheckpointTable.time_materialized),
          inArray(ProjectCheckpointTable.id, input.ids),
        ),
      )
      .run(),
  )
}

export * as IncrementalCheckpoint from "./incremental-checkpoint"
