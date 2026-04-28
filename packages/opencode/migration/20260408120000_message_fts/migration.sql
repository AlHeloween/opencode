-- Create FTS5 virtual table for full-text search across parts
CREATE VIRTUAL TABLE IF NOT EXISTS part_fts USING fts5(
  part_id UNINDEXED,
  session_id UNINDEXED,
  message_id UNINDEXED,
  part_type UNINDEXED,
  text_content,
  tokenize='porter'
);

-- Insert trigger: extract text from new parts
CREATE TRIGGER IF NOT EXISTS part_fts_insert AFTER INSERT ON part BEGIN
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content)
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
    )
  );
END;

-- Delete trigger
CREATE TRIGGER IF NOT EXISTS part_fts_delete AFTER DELETE ON part BEGIN
  DELETE FROM part_fts WHERE part_id = OLD.id;
END;

-- Update trigger
CREATE TRIGGER IF NOT EXISTS part_fts_update AFTER UPDATE ON part BEGIN
  DELETE FROM part_fts WHERE part_id = OLD.id;
  INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content)
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
    )
  );
END;

-- Backfill existing data
INSERT INTO part_fts(part_id, session_id, message_id, part_type, text_content)
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
  )
FROM part;
