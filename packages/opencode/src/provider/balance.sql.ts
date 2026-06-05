import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"

/**
 * Periodic snapshots of provider account balances.
 * Used to cross-validate our calculated costs against real balance deltas.
 */
export const BalanceSnapshotTable = sqliteTable(
  "balance_snapshot",
  {
    id: text().primaryKey(),
    provider_id: text().notNull(),
    currency: text().notNull(),
    total_balance: text().notNull(),
    granted_balance: text().notNull(),
    topped_up_balance: text().notNull(),
    is_available: integer({ mode: "boolean" }).notNull(),
    /** The session that was active when this snapshot was taken, if any */
    session_id: text(),
    /** The last message ID processed when this snapshot was taken */
    message_id: text(),
    /**
     * Our calculated cost (sum of all assistant message costs) since the
     * last balance snapshot for this provider. Used to compare with the
     * actual balance delta reported by the provider.
     */
    calculated_cost_since_last: real(),
    /** Actual balance delta: previous.total_balance - current.total_balance */
    actual_balance_delta: real(),
    /** Difference: actual_delta - calculated_cost. Near zero = correct calculation. */
    cost_validation_delta: real(),
    /** Raw API response for debugging */
    raw_response: text(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("balance_snapshot_provider_time_idx").on(table.provider_id, table.time_created),
  ],
)
