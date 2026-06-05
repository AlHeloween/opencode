/**
 * Balance snapshot DB persistence.
 * Requires project context to be set via Database.withProject() or Effect InstanceRef.
 */
import { eq, desc, sql } from "drizzle-orm"
import { BalanceSnapshotTable } from "./balance.sql"
import { Database } from "@/storage/db"
import type { BalanceSnapshot } from "./balance"
import { MessageTable } from "@/session/session.sql"

/**
 * Write a balance snapshot. Called after balance check completes.
 */
export function writeBalanceSnapshot(snapshot: BalanceSnapshot): void {
  Database.use((db) => {
    db.insert(BalanceSnapshotTable)
      .values({
        id: snapshot.id,
        provider_id: snapshot.providerID,
        currency: snapshot.currency,
        total_balance: snapshot.totalBalance,
        granted_balance: snapshot.grantedBalance,
        topped_up_balance: snapshot.toppedUpBalance,
        is_available: snapshot.isAvailable,
        session_id: snapshot.sessionID ?? null,
        message_id: snapshot.messageID ?? null,
        calculated_cost_since_last: snapshot.calculatedCostSinceLast ?? null,
        actual_balance_delta: snapshot.actualBalanceDelta ?? null,
        cost_validation_delta: snapshot.costValidationDelta ?? null,
        raw_response: null,
        time_created: snapshot.timeCreated,
      })
      .run()
  })
}

/**
 * Read the most recent balance snapshot for a provider.
 * Returns null if no snapshot exists yet.
 */
export function readLatestBalanceSnapshot(providerID: string): { totalBalance: string } | null {
  return Database.use((db) => {
    const row = db
      .select({ total_balance: BalanceSnapshotTable.total_balance })
      .from(BalanceSnapshotTable)
      .where(eq(BalanceSnapshotTable.provider_id, providerID))
      .orderBy(desc(BalanceSnapshotTable.time_created))
      .limit(1)
      .get()
    return row ? { totalBalance: row.total_balance } : null
  })
}

/**
 * Compute the total calculated cost since the last balance snapshot.
 * Sums all assistant message costs for a given session from messages
 * whose time_created is after the last snapshot time.
 */
export function calculatedCostSinceLastSnapshot(
  sessionID: string,
  providerID: string,
): number {
  return Database.use((db) => {
    // Find the last snapshot time for this provider
    const lastSnapshot = db
      .select({ time_created: BalanceSnapshotTable.time_created })
      .from(BalanceSnapshotTable)
      .where(eq(BalanceSnapshotTable.provider_id, providerID))
      .orderBy(desc(BalanceSnapshotTable.time_created))
      .limit(1)
      .get()

    if (!lastSnapshot) return 0

    // Sum message costs for this session since the last snapshot
    // Messages store cost in their JSON data field
    const result = db
      .select({
        total: sql<number>`SUM(CAST(json_extract(data, '$.cost') AS REAL))`,
      })
      .from(MessageTable)
      .where(
        sql`session_id = ${sessionID}
            AND json_extract(data, '$.role') = 'assistant'
            AND time_created > ${lastSnapshot.time_created}`,
      )
      .get()

    return (result as any)?.total ?? 0
  })
}
