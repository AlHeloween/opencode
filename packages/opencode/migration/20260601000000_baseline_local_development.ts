import type { DatabaseMigration } from "@/storage/migration"

/**
 * Baseline migration representing the current Local_Development schema.
 * Only applied on fresh databases; existing installs are backfilled via
 * the migration runner's detection of existing tables.
 */
const migration: DatabaseMigration.Migration = {
  id: "20260601000000_baseline_local_development",

  up(db) {
    // All tables are created with IF NOT EXISTS for idempotency.
    // This matches the CORE_SCHEMA_SQL pattern in db.ts.
    // The migration runner ensures this only runs on databases without
    // an existing migration record.

    const sqlite = db.$client

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "project" (
      id text PRIMARY KEY NOT NULL, worktree text NOT NULL, vcs text, name text,
      icon_url text, icon_url_override text, icon_color text,
      time_created integer NOT NULL, time_updated integer NOT NULL,
      time_initialized integer, sandboxes text NOT NULL DEFAULT '[]',
      commands text DEFAULT '{}'
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "account" (
      id text PRIMARY KEY NOT NULL, email text NOT NULL, url text NOT NULL,
      access_token text NOT NULL, refresh_token text NOT NULL,
      token_expiry integer, time_created integer NOT NULL, time_updated integer NOT NULL
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "account_state" (
      id integer PRIMARY KEY, active_account_id text, active_org_id text
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "session" (
      id text PRIMARY KEY NOT NULL, project_id text NOT NULL, workspace_id text,
      parent_id text, slug text NOT NULL, directory text NOT NULL,
      title text NOT NULL, version text NOT NULL, share_url text,
      summary_additions integer, summary_deletions integer, summary_files integer,
      summary_diffs text, revert text, permission text,
      time_created integer NOT NULL, time_updated integer NOT NULL,
      time_compacting integer, time_archived integer
    )`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "session_project_idx" ON "session" ("project_id")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "session_workspace_idx" ON "session" ("workspace_id")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "session_parent_idx" ON "session" ("parent_id")`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "message" (
      id text PRIMARY KEY NOT NULL, session_id text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
    )`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "message_session_time_created_id_idx" ON "message" ("session_id", "time_created", "id")`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "part" (
      id text PRIMARY KEY NOT NULL, message_id text NOT NULL, session_id text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
    )`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "part_message_id_id_idx" ON "part" ("message_id", "id")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "part_session_idx" ON "part" ("session_id")`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "todo" (
      session_id text NOT NULL, content text NOT NULL, status text NOT NULL,
      priority text NOT NULL, position integer NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL,
      PRIMARY KEY ("session_id", "position")
    )`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "todo_session_idx" ON "todo" ("session_id")`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "session_entry" (
      id text PRIMARY KEY NOT NULL, session_id text NOT NULL, type text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
    )`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "session_entry_session_idx" ON "session_entry" ("session_id")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "session_entry_session_type_idx" ON "session_entry" ("session_id", "type")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "session_entry_time_created_idx" ON "session_entry" ("time_created")`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "permission" (
      project_id text PRIMARY KEY NOT NULL, time_created integer NOT NULL,
      time_updated integer NOT NULL, data text NOT NULL
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "session_share" (
      session_id text PRIMARY KEY NOT NULL, id text NOT NULL, secret text NOT NULL,
      url text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "workspace" (
      id text PRIMARY KEY NOT NULL, type text NOT NULL, name text NOT NULL DEFAULT '',
      branch text, directory text, extra text, project_id text NOT NULL
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "event_sequence" (
      aggregate_id text PRIMARY KEY NOT NULL, seq integer NOT NULL
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "event" (
      id text PRIMARY KEY NOT NULL, aggregate_id text NOT NULL, seq integer NOT NULL,
      type text NOT NULL, data text NOT NULL
    )`)

    sqlite.exec(`CREATE TABLE IF NOT EXISTS "part_embedding" (
      id text PRIMARY KEY NOT NULL, part_id text NOT NULL REFERENCES part(id) ON DELETE CASCADE,
      session_id text NOT NULL, message_id text NOT NULL, embedding_type text NOT NULL,
      embedding text NOT NULL, position_in_document integer NOT NULL,
      content_length integer NOT NULL, model_id text NOT NULL,
      model_dim integer NOT NULL, provider_priority integer NOT NULL DEFAULT 1,
      time_created integer NOT NULL
    )`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "part_embedding_part_idx" ON "part_embedding" ("part_id")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "part_embedding_session_idx" ON "part_embedding" ("session_id")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "part_embedding_type_idx" ON "part_embedding" ("embedding_type")`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "part_embedding_model_idx" ON "part_embedding" ("model_id")`)
  },
}

export default migration
