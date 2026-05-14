import sqlite3, os
dbpath = os.path.expanduser("~/.local/share/opencode/opencode-Local_Development.db")
db = sqlite3.connect(dbpath)
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("tables:", tables)
for t in ['session', 'session_index', '_meta', 'session_entry', 'message', 'part', 'event']:
    try:
        c = db.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {c} rows")
    except Exception as e:
        print(f"  {t}: {e}")
if 'project' in tables:
    print("projects:", [dict(r) for r in db.execute("SELECT id, worktree FROM project")])
if '_meta' in tables:
    for row in db.execute("SELECT * FROM _meta"):
        print(f"_meta row: {dict(row)}")
db.close()
