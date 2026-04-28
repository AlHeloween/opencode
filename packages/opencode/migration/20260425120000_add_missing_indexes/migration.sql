-- Add missing indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_message_session_created ON message(session_id, time_created);
CREATE INDEX IF NOT EXISTS idx_part_message ON part(message_id);
CREATE INDEX IF NOT EXISTS idx_part_session ON part(session_id);
CREATE INDEX IF NOT EXISTS idx_session_parent ON session(parent_id);
