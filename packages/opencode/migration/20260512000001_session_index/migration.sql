-- Lightweight session index in the global DB for listing sessions across projects
CREATE TABLE IF NOT EXISTS "session_index" (
 id text PRIMARY KEY NOT NULL,
 project_id text NOT NULL,
 directory text NOT NULL,
 title text NOT NULL,
 parent_id text,
 workspace_id text,
 time_created integer NOT NULL,
 time_updated integer NOT NULL,
 time_archived integer
);
CREATE INDEX IF NOT EXISTS "session_index_project_idx" ON "session_index" ("project_id");
CREATE INDEX IF NOT EXISTS "session_index_updated_idx" ON "session_index" ("time_updated");
