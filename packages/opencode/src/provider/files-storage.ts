import { Database } from "@/storage/db"
import { ProviderFileTable } from "@/provider/files.sql"
import { eq, lt, isNull, and } from "drizzle-orm"
import type { FileRecord, ProviderFile } from "@/provider/files-api"

/**
 * Persistence for provider-hosted files.
 *
 * The row is the receipt that makes a `file_id` usable — see `files.sql.ts` for
 * why the provider gives us nothing to check against. Everything here is
 * idempotent on `file_id`: an upload may be retried, and a re-upload must
 * never leave two rows claiming the same upstream file.
 */

export function recordUpload(input: {
  file: ProviderFile
  providerID: string
  sessionID?: string
  partID?: string
  mime: string
}): void {
  Database.use((db) => {
    db.insert(ProviderFileTable)
      .values({
        file_id: input.file.fileId,
        provider_id: input.providerID,
        part_id: input.partID,
        session_id: input.sessionID,
        mime: input.mime,
        filename: input.file.filename,
        bytes: input.file.bytes,
        expires_at: input.file.expiresAt,
        verified_at: null,
        time_created: input.file.createdAt,
      })
      .onConflictDoUpdate({
        target: ProviderFileTable.file_id,
        set: {
          mime: input.mime,
          filename: input.file.filename,
          bytes: input.file.bytes,
          expires_at: input.file.expiresAt,
          session_id: input.sessionID,
          part_id: input.partID,
        },
      })
      .run()
  })
}

/**
 * Mark a file verified. Only ever moves it FORWARD — a re-upload that reset this
 * to null would silently turn a known-good reference into an unproven one.
 */
export function markVerified(fileId: string, at: number): void {
  Database.use((db) => {
    db.update(ProviderFileTable)
      .set({ verified_at: at })
      .where(eq(ProviderFileTable.file_id, fileId))
      .run()
  })
}

export function getFile(fileId: string): (FileRecord & { providerID: string; sessionID: string | null }) | undefined {
  const row = Database.use((db) =>
    db.select().from(ProviderFileTable).where(eq(ProviderFileTable.file_id, fileId)).get(),
  )
  if (!row) return undefined
  return {
    fileId: row.file_id,
    expiresAt: row.expires_at,
    verifiedAt: row.verified_at,
    providerID: row.provider_id,
    sessionID: row.session_id,
  }
}

/**
 * Files whose term has run out. Returned rather than deleted: an expired id is
 * still the answer to "why did this fail", and dropping the row would lose it.
 */
export function listExpired(now: number): Array<{ fileId: string; providerID: string }> {
  return Database.use((db) =>
    db
      .select({ fileId: ProviderFileTable.file_id, providerID: ProviderFileTable.provider_id })
      .from(ProviderFileTable)
      .where(lt(ProviderFileTable.expires_at, now))
      .all(),
  )
}

export function forgetFile(fileId: string): void {
  Database.use((db) => {
    db.delete(ProviderFileTable).where(eq(ProviderFileTable.file_id, fileId)).run()
  })
}