import type { DatabaseMigration } from "./migration"
import baseline from "../../migration/20260601000000_baseline_local_development"
import sessionUsage from "../../migration/20260601000001_session_usage_tracking"

export const migrations: DatabaseMigration.Migration[] = [baseline, sessionUsage]
