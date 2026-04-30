-- Drop FTS5 dead code that causes write amplification on every part INSERT/UPDATE/DELETE
-- The part_fts table and its triggers are never queried by any application code
-- Removing them halves the write operations per PartUpdated event during LLM streaming

DROP TRIGGER IF EXISTS part_fts_insert;
DROP TRIGGER IF EXISTS part_fts_delete;
DROP TRIGGER IF EXISTS part_fts_update;
DROP TABLE IF EXISTS part_fts;