"""promote_bin_fixture_server.py — the fixture's dummy opencode server for the safe-bin-promotion tests.

A real HTTP server implementing the contract promote_bin.py consumes, small enough to control from a test:

    GET  /global/health                    -> {"healthy":true,"version":<version-file>,"host":<nonce>}
    GET  /session/status                   -> non-idle sessions from <state>/status.json (idle absent)
    POST /session/<id>/prompt_async        -> appended to <state>/prompts.jsonl (the resume oracle), 204
    POST /session/<id>/abort               -> sets that session idle in status.json

On start it writes a REAL server_host row (same schema the product uses) into
<worktree>/.opencode/data/opencode.db, so promote_bin.py attributes it through the same code path as the
real fleet. It also watches <state>/spawn-tool.json: when the test drops a request there, the server spawns
promote_bin.py as its own CHILD (the inside-session refusal case, T8) and records the exit code and output.

    python promote_bin_fixture_server.py --port N --worktree W --state S --version-file V
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(prog="promote_bin_fixture_server.py")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--version-file", required=True)
    args = parser.parse_args()

    worktree = Path(args.worktree)
    state = Path(args.state)
    version_file = Path(args.version_file)
    state.mkdir(parents=True, exist_ok=True)
    db_dir = worktree / ".opencode" / "data"
    db_dir.mkdir(parents=True, exist_ok=True)
    db_path = db_dir / "opencode.db"

    nonce = str(uuid.uuid4())
    token = secrets.token_hex(32)
    con = sqlite3.connect(db_path)
    con.execute(
        "create table if not exists server_host ("
        "id TEXT PRIMARY KEY, url TEXT, pid INTEGER, nonce TEXT, token TEXT, time_started INTEGER)"
    )
    con.execute(
        "insert or replace into server_host (id, url, pid, nonce, token, time_started) "
        "values ('host', ?, ?, ?, ?, ?)",
        (f"http://127.0.0.1:{args.port}/", os.getpid(), nonce, token, int(time.time() * 1000)),
    )
    con.commit()
    con.close()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silence the default per-request stderr noise
            return

        def _json(self, payload, code=200):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/global/health":
                self._json({"healthy": True, "version": version_file.read_text(encoding="utf-8").strip(), "host": nonce})
                return
            if parsed.path == "/session/status":
                status_file = state / "status.json"
                raw = json.loads(status_file.read_text(encoding="utf-8")) if status_file.exists() else {}
                self._json({sid: {"type": value} for sid, value in raw.items() if value != "idle"})
                return
            self.send_response(404)
            self.end_headers()

        def do_POST(self):
            parsed = urllib.parse.urlparse(self.path)
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b"{}"
            if parsed.path == "/global/dispose":
                self._json(True)
                return
            match = urllib.parse.parse_qs(parsed.query).get("directory", [None])[0]
            parts = parsed.path.split("/")
            if len(parts) >= 4 and parts[1] == "session" and parts[3] == "prompt_async":
                session_id = parts[2]
                payload = json.loads(body.decode("utf-8") or "{}")
                text = " ".join(
                    p.get("text", "") for p in payload.get("parts", []) if isinstance(p, dict)
                )
                with (state / "prompts.jsonl").open("a", encoding="utf-8") as handle:
                    handle.write(json.dumps({"session": session_id, "text": text, "directory": match}) + "\n")
                self.send_response(204)
                self.end_headers()
                return
            if len(parts) >= 4 and parts[1] == "session" and parts[3] == "abort":
                session_id = parts[2]
                status_file = state / "status.json"
                raw = json.loads(status_file.read_text(encoding="utf-8")) if status_file.exists() else {}
                raw.pop(session_id, None)
                status_file.write_text(json.dumps(raw), encoding="utf-8")
                self._json(True)
                return
            self.send_response(404)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    con = sqlite3.connect(db_path)
    con.execute("update server_host set pid = ? where id = 'host'", (os.getpid(),))
    con.close()

    def watcher():
        request_file = state / "spawn-tool.json"
        while True:
            time.sleep(0.5)
            if not request_file.exists():
                continue
            try:
                request = json.loads(request_file.read_text(encoding="utf-8"))
            except (ValueError, OSError) as error:
                (state / "spawn-tool-result.txt").write_text(f"bad request: {error}", encoding="utf-8")
                request_file.unlink(missing_ok=True)
                continue
            request_file.unlink(missing_ok=True)
            result = subprocess.run(
                [sys.executable, *request["args"]],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600,
            )
            (state / "spawn-tool-result.txt").write_text(str(result.returncode), encoding="utf-8")
            (state / "spawn-tool-stdout.txt").write_text(result.stdout or "", encoding="utf-8")
            (state / "spawn-tool-stderr.txt").write_text(result.stderr or "", encoding="utf-8")

    threading.Thread(target=watcher, daemon=True).start()
    print(f"fixture server on http://127.0.0.1:{args.port} nonce={nonce}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
