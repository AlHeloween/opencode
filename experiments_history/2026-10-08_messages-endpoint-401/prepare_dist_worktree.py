"""Prepare a scratch worktree for the dist-candidate verification.

Copies THIS worktree's opencode.db with SQLite's backup API (consistent snapshot of a live
database), then drops the copied `server_host` row: the copy must claim its own host instead of
attaching to the owner's live TUI. The owner's server is never touched.

Run:  python experiments/2026-10-08_messages-401/prepare_dist_worktree.py
"""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = Path(__file__).resolve().parent / "dist-worktree"
TARGET = "ses_ee71eb62bffeGfzHDNQGaxq2Q6"

source = ROOT / ".opencode" / "data" / "opencode.db"
destination = DEST / ".opencode" / "data" / "opencode.db"
destination.parent.mkdir(parents=True, exist_ok=True)

src = sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)
dst = sqlite3.connect(str(destination))
try:
    src.backup(dst)
    dst.execute("DELETE FROM server_host")
    dst.commit()
    messages = dst.execute(
        "select count(*) from message where session_id = ?", (TARGET,)
    ).fetchone()[0]
    parts = dst.execute(
        "select count(*) from part where message_id = 'msg_118eb1f9e001MubqwDWiPzRFkn'"
    ).fetchone()[0]
finally:
    src.close()
    dst.close()

print(f"worktree: {DEST}")
print(f"db copy:  {destination} ({destination.stat().st_size} bytes)")
print(f"target session messages: {messages}; culprit message parts: {parts}")
sys.exit(0)
