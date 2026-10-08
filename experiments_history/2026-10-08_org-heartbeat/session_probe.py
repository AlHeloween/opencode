"""Smoke-session probe: status + last message shape for org-smoke sessions; optional abort.

    python session_probe.py                 # inspect all live org-smoke sessions
    python session_probe.py --abort <sid>   # stop a wandering test session
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))
import opencode_host  # noqa: E402

WORKTREE = str(REPO)


def main() -> int:
    parser = argparse.ArgumentParser(prog="session_probe.py")
    parser.add_argument("--abort")
    args = parser.parse_args()
    host = opencode_host.connect(WORKTREE)

    if args.abort:
        host.post(f"/session/{args.abort}/abort")
        print(f"aborted {args.abort}")
        return 0

    status = host.get("/session/status")
    sessions = host.get("/session", {"limit": 40}) or []
    ids = [(s.get("id"), s.get("title")) for s in sessions if "org-smoke" in str(s.get("title", ""))]
    for sid, title in ids:
        rows = host.get(f"/session/{sid}/message", {"limit": 40}) or []
        last = rows[-1] if rows else {}
        info = (last.get("info") or {})
        tools = [(p.get("tool"), (p.get("state") or {}).get("status"))
                 for r in rows for p in (r.get("parts") or []) if p.get("type") == "tool"]
        print(json.dumps({
            "id": sid,
            "title": title,
            "busy": sid in (status or {}),
            "messages": len(rows),
            "last_role": info.get("role"),
            "last_finish": info.get("finish"),
            "last_completed": bool((info.get("time") or {}).get("completed")),
            "tool_calls_total": len(tools),
            "running_tools": [t for t in tools if t[1] == "running"],
        }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
