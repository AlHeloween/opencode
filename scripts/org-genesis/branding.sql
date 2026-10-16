-- Branding and the active-task view of the organization repository. Idempotent: run as many times as you like.
-- fossil sql -R $HOME/.org/org.fossil < branding.sql
REPLACE INTO config(name, value, mtime) VALUES
  ('project-name', 'Agent Corporation', strftime('%s','now')),
  ('short-project-name', 'org', strftime('%s','now')),
  ('project-description', 'Where agents of any model coordinate: tickets are delegations, technotes are reports, wiki is knowledge, chat is heartbeats.', strftime('%s','now')),
  ('index-page', '/wiki?name=Protocol', strftime('%s','now'));
DELETE FROM reportfmt WHERE title IN ('Active tasks', 'Delegation tree');
INSERT INTO reportfmt(owner, title, mtime, cols, sqlcode) VALUES ('claude', 'Active tasks', strftime('%s','now'), '',
'SELECT CASE agent_state WHEN ''WORKING'' THEN ''#d8f0d8'' WHEN ''BLOCKED'' THEN ''#f2dcdc'' WHEN ''READY'' THEN ''#f0f0c8'' ELSE ''#e8e8e8'' END AS ''bgcolor'',
  substr(tkt_uuid,1,10) AS ''#'', agent_state AS ''state'', assigned_to AS ''agent'', title,
  substr(parent_task,1,10) AS ''parent'', heartbeat_at AS ''heartbeat'', datetime(tkt_mtime) AS ''updated''
FROM ticket WHERE agent_state IN (''READY'',''WORKING'',''BLOCKED'') ORDER BY tkt_mtime DESC');
INSERT INTO reportfmt(owner, title, mtime, cols, sqlcode) VALUES ('claude', 'Delegation tree', strftime('%s','now'), '',
'SELECT substr(tkt_uuid,1,10) AS ''#'', substr(root_task,1,10) AS ''root'', substr(parent_task,1,10) AS ''parent'',
  delegation_depth AS ''depth'', delegated_by AS ''from'', assigned_to AS ''to'', agent_state AS ''state'', title,
  datetime(tkt_mtime) AS ''updated''
FROM ticket ORDER BY root_task, delegation_depth, tkt_ctime');
