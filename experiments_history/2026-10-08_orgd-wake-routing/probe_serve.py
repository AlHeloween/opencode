"""Serve-primitive qualification (the oracle's most fragile instrument).

Question: can the harness give itself a REAL wake target — a fixture worktree served by
its own `opencode serve` — so that (a) orgd's unchanged client sees a LIVE host, and
(b) a delivered `prompt_async` leaves a USER MESSAGE ROW in that worktree's database?

If yes, the wake-routing suite can assert both the red (row appears) and the green
(row absent) on real machinery instead of a mock. If no, the suite must be redesigned.

Run: python probe_serve.py
Provider env is stripped (owner rule, 2026-10-08): the fixture proves the ROW, not a model turn.
"""
from __future__ import annotations

import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools"))
import opencode_host  # noqa: E402

EXE = REPO / "dist" / "bin" / "opencode.exe"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="orgd-serve-probe-"))
    proj = tmp / "project"
    proj.mkdir()
    port = free_port()
    env = dict(os.environ)
    dropped = sorted(k for k in env if k.endswith(("_API_KEY", "_TOKEN", "_SECRET")))
    for k in dropped:
        env.pop(k, None)
    log = open(tmp / "serve.log", "wb")
    started = time.time()
    proc = subprocess.Popen([str(EXE), "serve", "--port", str(port)],
                            cwd=str(proj), env=env, stdout=log, stderr=subprocess.STDOUT)
    print(f"tmp={tmp}\nserve pid={proc.pid} port={port} dropped_env={dropped}")
    try:
        host = None
        for _ in range(60):
            time.sleep(1)
            if proc.poll() is not None:
                print(f"serve EXITED rc={proc.returncode} after {time.time()-started:.1f}s")
                print((tmp / "serve.log").read_text(encoding="utf-8", errors="replace")[-2000:])
                return 1
            try:
                host = opencode_host.connect(str(proj))
                break
            except Exception as error:
                last = error
        if host is None:
            print(f"no live host after 60 s: {last}")
            return 1
        print(f"1. host LIVE after {time.time()-started:.1f}s: {host}")

        sid = host.post("/session", {"title": "serve-probe target"})["id"]
        print(f"2. session created: {sid}")

        db = proj / ".opencode" / "data" / "opencode.db"
        con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
        n0 = con.execute("SELECT count(*) FROM session WHERE id = ?", (sid,)).fetchone()[0]
        print(f"3. session row in fixture DB: {n0}")
        con.close()

        host.post(f"/session/{sid}/prompt_async",
                  {"parts": [{"type": "text", "text": "ORG serve-probe wake"}]})
        row_count = 0
        for _ in range(20):
            time.sleep(1)
            rows = host.get(f"/session/{sid}/message", {"limit": 50}) or []
            row_count = sum(1 for r in rows if (r.get("info") or {}).get("role") == "user")
            if row_count:
                break
        print(f"4. user message rows after prompt_async: {row_count} ({time.time()-started:.1f}s)")

        con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
        direct = con.execute(
            "SELECT count(*) FROM part WHERE session_id = ? AND data LIKE '%serve-probe wake%'",
            (sid,)).fetchone()[0]
        con.close()
        print(f"5. text found in fixture DB parts: {direct}")

        verdict = row_count >= 1 and direct >= 1
        print(f"VERDICT: {'OK — fixture serve is a real wake target' if verdict else 'FAILED'}")
        return 0 if verdict else 1
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        print(f"serve stopped; log: {tmp / 'serve.log'}")


if __name__ == "__main__":
    raise SystemExit(main())
