-- Project-scoped tables for per-project SQLite database (.opencode/project.db)
-- No cross-DB foreign keys: session.project_id, permission.project_id, workspace.project_id
-- are validated at the application layer, not at the database level.

CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY NOT NULL,
  project_id text NOT NULL,
  workspace_id text,
  parent_id text,
  slug text NOT NULL,
  directory text NOT NULL,
  title text NOT NULL,
  version text NOT NULL,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  summary_diffs text,
  revert text,
  permission text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_compacting integer,
  time_archived integer
);
CREATE INDEX IF NOT EXISTS "session_project_idx" ON "session" ("project_id");
CREATE INDEX IF NOT EXISTS "session_workspace_idx" ON "session" ("workspace_id");
CREATE INDEX IF NOT EXISTS "session_parent_idx" ON "session" ("parent_id");

CREATE TABLE IF NOT EXISTS "message" (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS "message_session_time_created_id_idx" ON "message" ("session_id", "time_created", "id");

CREATE TABLE IF NOT EXISTS "part" (
  id text PRIMARY KEY NOT NULL,
  message_id text NOT NULL,
  session_id text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS "part_message_id_id_idx" ON "part" ("message_id", "id");
CREATE INDEX IF NOT EXISTS "part_session_idx" ON "part" ("session_id");

CREATE TABLE IF NOT EXISTS "todo" (
  session_id text NOT NULL,
  content text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  position integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  PRIMARY KEY ("session_id", "position")
);
CREATE INDEX IF NOT EXISTS "todo_session_idx" ON "todo" ("session_id");

CREATE TABLE IF NOT EXISTS "session_entry" (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL,
  type text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);
CREATE INDEX IF NOT EXISTS "session_entry_session_idx" ON "session_entry" ("session_id");
CREATE INDEX IF NOT EXISTS "session_entry_session_type_idx" ON "session_entry" ("session_id", "type");
CREATE INDEX IF NOT EXISTS "session_entry_time_created_idx" ON "session_entry" ("time_created");

CREATE TABLE IF NOT EXISTS "permission" (
  project_id text PRIMARY KEY NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL
);

CREATE TABLE IF NOT EXISTS "session_share" (
  session_id text PRIMARY KEY NOT NULL,
  id text NOT NULL,
  secret text NOT NULL,
  url text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "workspace" (
  id text PRIMARY KEY NOT NULL,
  type text NOT NULL,
  name text NOT NULL DEFAULT '',
  branch text,
  directory text,
  extra text,
  project_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS "event" (
  id text PRIMARY KEY NOT NULL,
  aggregate_id text NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  data text NOT NULL
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS "part_fts" USING fts5(
  part_id UNINDEXED,
  session_id UNINDEXED,
  message_id UNINDEXED,
  part_type UNINDEXED,
  text_content,
  semantic_vector,
  dominant_topic,
  exact_coef UNINDEXED,
  inferred_coef UNINDEXED,
  hypothetical_coef UNINDEXED,
  guess_coef UNINDEXED,
  unknown_coef UNINDEXED
);

-- Triggers to keep FTS in sync with part table
CREATE TRIGGER IF NOT EXISTS part_fts_insert AFTER INSERT ON part BEGIN
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  SELECT
    new.id,
    new.session_id,
    new.message_id,
    json_extract(new.data, '$.type'),
    COALESCE(json_extract(new.data, '$.text'), json_extract(new.data, '$.state.output'), json_extract(new.data, '$.state.error'), json_extract(new.data, '$.filename'), ''),
    COALESCE(json_extract(new.data, '$.semantic_vector'), ''),
    COALESCE(json_extract(new.data, '$.dominant_topic'), ''),
    COALESCE(json_extract(new.data, '$.exact_coef'), 0),
    COALESCE(json_extract(new.data, '$.inferred_coef'), 0),
    COALESCE(json_extract(new.data, '$.hypothetical_coef'), 0),
    COALESCE(json_extract(new.data, '$.guess_coef'), 0),
    COALESCE(json_extract(new.data, '$.unknown_coef'), 0);
END;

CREATE TRIGGER IF NOT EXISTS part_fts_delete AFTER DELETE ON part BEGIN
  INSERT INTO part_fts(part_fts, part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  VALUES('delete', old.id, old.session_id, old.message_id, '', '', '', '', 0, 0, 0, 0, 0);
END;

CREATE TRIGGER IF NOT EXISTS part_fts_update AFTER UPDATE ON part BEGIN
  INSERT INTO part_fts(part_fts, part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  VALUES('delete', old.id, old.session_id, old.message_id, '', '', '', '', 0, 0, 0, 0, 0);
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  SELECT
    new.id,
    new.session_id,
    new.message_id,
    json_extract(new.data, '$.type'),
    COALESCE(json_extract(new.data, '$.text'), json_extract(new.data, '$.state.output'), json_extract(new.data, '$.state.error'), json_extract(new.data, '$.filename'), ''),
    COALESCE(json_extract(new.data, '$.semantic_vector'), ''),
    COALESCE(json_extract(new.data, '$.dominant_topic'), ''),
    COALESCE(json_extract(new.data, '$.exact_coef'), 0),
    COALESCE(json_extract(new.data, '$.inferred_coef'), 0),
    COALESCE(json_extract(new.data, '$.hypothetical_coef'), 0),
    COALESCE(json_extract(new.data, '$.guess_coef'), 0),
    COALESCE(json_extract(new.data, '$.unknown_coef'), 0);
END;
