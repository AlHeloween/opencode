import type { DatabaseMigration } from "./migration"
import baseline from "../../migration/20260601000000_baseline_local_development"
import sessionUsage from "../../migration/20260601000001_session_usage_tracking"
import messageCompacted from "../../migration/20260601000002_message_compacted_column"
import projectCheckpointSidecar from "../../migration/20260727000000_project_checkpoint_sidecar"
import partTypeColumns from "../../migration/20260730_add_part_type_columns"
import cacheStateStatistics from "../../migration/20260817000000_cache_state_statistics"
import projectCheckpointPlanState from "../../migration/20260827000000_project_checkpoint_plan_state"

export const migrations: DatabaseMigration.Migration[] = [
  baseline,
  sessionUsage,
  messageCompacted,
  projectCheckpointSidecar,
  partTypeColumns,
  cacheStateStatistics,
  projectCheckpointPlanState,
]
