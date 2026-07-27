import type { DatabaseMigration } from "@/storage/migration"

/** Durable sidecar checkpoints: never part of provider-visible session history. */
const migration: DatabaseMigration.Migration = {
  id: "20260727000000_project_checkpoint_sidecar",

  up(db) {
    const sqlite = db.$client
    sqlite.exec(`CREATE TABLE IF NOT EXISTS project_checkpoint (
      id text PRIMARY KEY NOT NULL, session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      from_message_id text NOT NULL, to_message_id text NOT NULL, predecessor_id text NOT NULL DEFAULT '',
      provider_id text NOT NULL, model_id text NOT NULL, agent text NOT NULL, body text NOT NULL,
      diffs text, impact text, materialized_message_id text, time_materialized integer,
      time_created integer NOT NULL, time_updated integer NOT NULL,
      UNIQUE (session_id, from_message_id, to_message_id, predecessor_id)
    )`)
    sqlite.exec("CREATE INDEX IF NOT EXISTS project_checkpoint_session_created_idx ON project_checkpoint (session_id, time_created)")
    sqlite.exec("CREATE INDEX IF NOT EXISTS project_checkpoint_session_materialized_idx ON project_checkpoint (session_id, time_materialized)")
  },
}

export default migration
