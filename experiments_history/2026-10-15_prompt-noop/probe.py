"""Read-only session inventory. Never print provider settings or host tokens."""
import json
from pathlib import Path
import sqlite3

ROOT = Path("D:/zPascal/XEComponents")
SID = "ses_ef0fcf857ffeZhEEzRxLWqV4z2"
db = sqlite3.connect(f"file:{(ROOT / '.opencode/data/opencode.db').as_posix()}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
try:
    tables = [r[0] for r in db.execute("select name from sqlite_master where type='table'")]
    print(json.dumps({"tables": tables}))
    for table in ("session", "message", "part", "server_host"):
        if table in tables:
            print(json.dumps({"table": table, "columns": [r[1] for r in db.execute(f"pragma table_info({table})")]}))
    if "session" in tables:
        row = db.execute("select * from session where id=?", (SID,)).fetchone()
        safe = {k: row[k] for k in ("id", "directory", "parent_id", "workspace_id", "time_created", "time_updated", "time_archived", "time_compacting", "revert") if row and k in row.keys()}
        print(json.dumps({"session": safe}, ensure_ascii=True))
    if "message" in tables:
        rows = db.execute("select * from message where session_id=? order by time_created desc limit 12", (SID,)).fetchall()
        out = []
        for row in rows:
            data = json.loads(row["data"])
            out.append({"id": row["id"], "time_created": row["time_created"], "role": data.get("role"),
                        "agent": data.get("agent"), "model": data.get("model"), "modelID": data.get("modelID"),
                        "providerID": data.get("providerID"), "finish": data.get("finish"), "time": data.get("time"),
                        "error": data.get("error", {}).get("name") if isinstance(data.get("error"), dict) else None})
        print(json.dumps({"latest_messages": out}, ensure_ascii=True))
finally:
    db.close()
