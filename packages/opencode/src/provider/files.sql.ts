import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

/**
 * Files uploaded to a provider's Files API, and the receipt that proves it.
 *
 * The row is the ONLY thing that makes a `file_id` usable, because the
 * provider's response carries no state to check against: `id, object, bytes,
 * created_at, filename, purpose, expires_at` — no status, no processing field.
 * A file is therefore stored here the moment it is uploaded, verified before
 * it is first referenced, and refused once its term runs out. Without
 * `expires_at` a dead `file_id` produces a request nobody can diagnose.
 */
export const ProviderFileTable = sqliteTable(
  "provider_file",
  {
    /** Provider-assigned id (`file-api-…`). Primary: nothing else identifies it upstream. */
    file_id: text().primaryKey(),
    provider_id: text().notNull(),
    /** The message part that owns this file, so a delete can find it from the history. */
    part_id: text(),
    session_id: text(),
    mime: text().notNull(),
    filename: text(),
    bytes: integer().notNull(),
    /**
     * Epoch ms when the provider stops serving it. NULL means the upload asked
     * for no term — permanent, and only safe for files we own forever.
     */
    expires_at: integer(),
    /** Epoch ms of the last `files.retrieve` that answered. NULL = never verified. */
    verified_at: integer(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("provider_file_session_idx").on(table.session_id),
    index("provider_file_expiry_idx").on(table.expires_at),
  ],
)