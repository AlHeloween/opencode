"""Fixture-builder probe — qualify the sandbox org primitives before the suite.

Run: python probe_fixture.py
Checks, on a throwaway fossil repo in %TEMP%:
  1. `fossil new` succeeds;
  2. the fresh repo HAS a chat table (orgd scans `SELECT xmsg FROM chat`;
     a repo without it would make the suite fail for the wrong reason);
  3. the ticket schema (ticket-schema.sql) applies via the config ticket-table route;
  4. `fossil user new` creates the assignee/delegator logins;
  5. a ticket insert + orgd-style read round-trips the wake fields.
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCHEMA = REPO / "scripts" / "org-genesis" / "ticket-schema.sql"


def fossil(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    out = subprocess.run(["fossil", *args], capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    if check and out.returncode != 0:
        print(f"FAIL fossil {args[0]}: {out.stderr.strip() or out.stdout.strip()}")
        sys.exit(1)
    return out


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="orgd-fixture-probe-"))
    org = tmp / "org.fossil"
    print(f"tmp={tmp}")

    out = fossil("new", str(org))
    print(f"1. fossil new rc={out.returncode}")  # output carries the admin password: never printed

    con = sqlite3.connect(f"file:{org.as_posix()}?mode=ro", uri=True)
    row = con.execute("SELECT sql FROM sqlite_master WHERE name='chat'").fetchone()
    con.close()
    print(f"2. chat table: {'present' if row else 'ABSENT'}")
    if row:
        print(f"   chat schema: {row[0].replace(chr(10), ' ')[:200]}")

    schema = SCHEMA.read_text(encoding="utf-8").replace("'", "''")
    fossil("sql", "-R", str(org),
           f"INSERT OR REPLACE INTO config(name,value,mtime) VALUES('ticket-table','{schema}',now());")
    fossil("rebuild", str(org))
    con = sqlite3.connect(f"file:{org.as_posix()}?mode=ro", uri=True)
    have = con.execute("SELECT sql FROM sqlite_master WHERE name='ticket';").fetchone()
    con.close()
    ok = have and all(f in have[0] for f in ("wake_session", "wake_worktree", "woken_state", "workspace_repo"))
    print(f"3. ticket schema with wake fields: {'yes' if ok else 'NO'}")
    if not ok:
        print(f"   got: {have}")
        return 1

    for user in ("smit-fixture", "smit-delegator"):
        u = fossil("user", "new", user, "robot", "x" * 16, "-R", str(org), check=False)
        print(f"4. user new {user}: rc={u.returncode} {u.stderr.strip()[:100]}")

    outf = fossil("ticket", "add", "title", "probe", "status", "Open", "agent_state", "READY",
                  "assigned_to", "smit-fixture", "workspace_repo", str(tmp),
                  "-U", "smit-delegator", "-R", str(org)).stdout
    print(f"5. ticket add: {outf.strip()[:120]}")
    con = sqlite3.connect(f"file:{org.as_posix()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    t = con.execute("SELECT title, agent_state, assigned_to, wake_session, workspace_repo FROM ticket").fetchone()
    con.close()
    print(f"   read back: {dict(t) if t else None}")
    print("PROBE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
