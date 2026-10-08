CREATE TABLE ticket(
  -- Do not change any column that begins with tkt_
  tkt_id INTEGER PRIMARY KEY,
  tkt_uuid TEXT UNIQUE,
  tkt_mtime DATE,
  tkt_ctime DATE,
  -- Add as many fields as required below this line
  type TEXT,
  status TEXT,
  subsystem TEXT,
  priority TEXT,
  severity TEXT,
  foundin TEXT,
  private_contact TEXT,
  resolution TEXT,
  agent_state TEXT,
  root_task TEXT,
  parent_task TEXT,
  delegated_by TEXT,
  assigned_to TEXT,
  delegation_depth TEXT,
  attempt TEXT,
  lease_owner TEXT,
  lease_token TEXT,
  lease_epoch TEXT,
  lease_until TEXT,
  heartbeat_at TEXT,
  wake_session TEXT,
  wake_worktree TEXT,
  woken_state TEXT,
  workspace_repo TEXT,
  workspace_ref TEXT,
  workspace_scope TEXT,
  depends_on TEXT,
  report_ref TEXT,
  result_ref TEXT,
  knowledge_ref TEXT,
  sv TEXT,
  idempotency_key TEXT,
  failure_code TEXT,
  title TEXT,
  comment TEXT
);
CREATE TABLE ticketchng(
  -- Do not change any column that begins with tkt_
  tkt_id INTEGER REFERENCES ticket,
  tkt_rid INTEGER REFERENCES blob,
  tkt_mtime DATE,
  tkt_user TEXT,
  -- Add as many fields as required below this line
  login TEXT,
  username TEXT,
  mimetype TEXT,
  icomment TEXT
);
CREATE INDEX ticketchng_idx1 ON ticketchng(tkt_id, tkt_mtime);
