/**
 * Balance snapshot DB persistence.
 * Requires project context to be set via Database.withProject() or Effect InstanceRef.
 */
import { eq, desc, sql } from "drizzle-orm"
import { BalanceSnapshotTable } from "./balance.sql"
import { Database } from "@/storage/db"
import type { BalanceSnapshot } from "./balance"
import { MessageTable, SessionTable } from "@/session/session.sql"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "provider.balance-storage" })

interface SnapshotMetadata {
  sessionCost: number
}

function parseSnapshotMetadata(raw: string | null): SnapshotMetadata | undefined {
  if (!raw) return
  try {
    const value = JSON.parse(raw) as Partial<SnapshotMetadata>
    if (typeof value.sessionCost === "number" && Number.isFinite(value.sessionCost)) {
      return { sessionCost: value.sessionCost }
    }
  } catch (error) {
    // Older rows may contain provider payloads instead of our metadata envelope.
    // They remain valid snapshots and use the message-cost fallback below.
    log.debug("balance snapshot metadata unavailable", { error: String(error) })
  }
}

/**
 * Write a balance snapshot. Called after balance check completes.
 */
export function writeBalanceSnapshot(snapshot: BalanceSnapshot): void {
  Database.use((db) => {
    const sessionCost = snapshot.sessionID
      ? db
          .select({ cost: SessionTable.cost })
          .from(SessionTable)
          .where(eq(SessionTable.id, snapshot.sessionID as SessionID))
          .get()?.cost
      : undefined
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
        raw_response:
          sessionCost === undefined || sessionCost === null
            ? null
            : JSON.stringify({ sessionCost } satisfies SnapshotMetadata),
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
  sessionID: SessionID,
  providerID: string,
): number {
  return Database.use((db) => {
    // Find the last snapshot for this provider. New snapshots carry the
    // cumulative session total, which includes detached sidecar requests.
    const lastSnapshot = db
      .select({
        time_created: BalanceSnapshotTable.time_created,
        session_id: BalanceSnapshotTable.session_id,
        raw_response: BalanceSnapshotTable.raw_response,
      })
      .from(BalanceSnapshotTable)
      .where(eq(BalanceSnapshotTable.provider_id, providerID))
      .orderBy(desc(BalanceSnapshotTable.time_created))
      .limit(1)
      .get()

    if (!lastSnapshot) return 0

    const metadata = parseSnapshotMetadata(lastSnapshot.raw_response)
    if (lastSnapshot.session_id === sessionID && metadata) {
      const current = db
        .select({ cost: SessionTable.cost })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()?.cost
      return Math.max(0, (current ?? metadata.sessionCost) - metadata.sessionCost)
    }

    // Transition/cross-session fallback: rows written before the cumulative
    // baseline continue to count provider-visible assistant messages.
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
