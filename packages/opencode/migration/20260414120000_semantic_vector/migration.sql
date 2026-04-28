-- Add semantic vector columns to FTS5 table for keyword-based relevance scoring
-- Rebuild the FTS table with new columns (FTS5 doesn't support ALTER TABLE ADD COLUMN)
DROP TRIGGER IF EXISTS part_fts_insert;
DROP TRIGGER IF EXISTS part_fts_delete;
DROP TRIGGER IF EXISTS part_fts_update;
DROP TABLE IF EXISTS part_fts;

CREATE VIRTUAL TABLE part_fts USING fts5(
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
  unknown_coef UNINDEXED,
  tokenize='porter'
);

-- Insert trigger: extract text and semantic vector from new parts
CREATE TRIGGER part_fts_insert AFTER INSERT ON part BEGIN
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  VALUES (
    NEW.id,
    NEW.session_id,
    NEW.message_id,
    json_extract(NEW.data, '$.type'),
    COALESCE(
      json_extract(NEW.data, '$.text'),
      json_extract(NEW.data, '$.state.output'),
      json_extract(NEW.data, '$.state.error'),
      json_extract(NEW.data, '$.filename'),
      ''
    ),
    COALESCE(json_extract(NEW.data, '$.semantic_vector'), ''),
    COALESCE(json_extract(NEW.data, '$.dominant_topic'), ''),
    COALESCE(json_extract(NEW.data, '$.exact_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.inferred_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.hypothetical_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.guess_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.unknown_coef'), 0)
  );
END;

-- Delete trigger
CREATE TRIGGER part_fts_delete AFTER DELETE ON part BEGIN
  DELETE FROM part_fts WHERE part_id = OLD.id;
END;

-- Update trigger
CREATE TRIGGER part_fts_update AFTER UPDATE ON part BEGIN
  DELETE FROM part_fts WHERE part_id = OLD.id;
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
  VALUES (
    NEW.id,
    NEW.session_id,
    NEW.message_id,
    json_extract(NEW.data, '$.type'),
    COALESCE(
      json_extract(NEW.data, '$.text'),
      json_extract(NEW.data, '$.state.output'),
      json_extract(NEW.data, '$.state.error'),
      json_extract(NEW.data, '$.filename'),
      ''
    ),
    COALESCE(json_extract(NEW.data, '$.semantic_vector'), ''),
    COALESCE(json_extract(NEW.data, '$.dominant_topic'), ''),
    COALESCE(json_extract(NEW.data, '$.exact_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.inferred_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.hypothetical_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.guess_coef'), 0),
    COALESCE(json_extract(NEW.data, '$.unknown_coef'), 0)
  );
END;

-- Backfill existing data
INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content, semantic_vector, dominant_topic, exact_coef, inferred_coef, hypothetical_coef, guess_coef, unknown_coef)
SELECT
  id,
  session_id,
  message_id,
  json_extract(data, '$.type'),
  COALESCE(
    json_extract(data, '$.text'),
    json_extract(data, '$.state.output'),
    json_extract(data, '$.state.error'),
    json_extract(data, '$.filename'),
    ''
  ),
  COALESCE(json_extract(data, '$.semantic_vector'), ''),
  COALESCE(json_extract(data, '$.dominant_topic'), ''),
  COALESCE(json_extract(data, '$.exact_coef'), 0),
  COALESCE(json_extract(data, '$.inferred_coef'), 0),
  COALESCE(json_extract(data, '$.hypothetical_coef'), 0),
  COALESCE(json_extract(data, '$.guess_coef'), 0),
  COALESCE(json_extract(data, '$.unknown_coef'), 0)
FROM part;
