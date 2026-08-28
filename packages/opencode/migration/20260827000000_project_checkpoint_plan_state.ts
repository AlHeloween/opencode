import type { DatabaseMigration } from "@/storage/migration"

/** Plan state mirror (GATED WORKFLOW snapshot) on sidecar checkpoints. */
const migration: DatabaseMigration.Migration = {
  id: "20260827000000_project_checkpoint_plan_state",

  up(db) {
    const sqlite = db.$client
    sqlite.exec("ALTER TABLE project_checkpoint ADD COLUMN plan_state text")
  },
}

export default migration
