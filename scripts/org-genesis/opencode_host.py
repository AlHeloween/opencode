# Vendored copy of the repository's canonical client tools/opencode_host.py — byte-identical at
# copy time (sha256 cc7edd75592bee25a7e3165ac56a7b7144e3ea829d53933159d55aa0effbddfa, 2026-10-08).
# Genesis ships it so `orgd` imports the client from any install; re-copy after any change to
# the canonical file.
"""Client for the ONE opencode host of a worktree (plans/2026-10-02_one-server-per-worktree.md).

Every worktree DB names the process that serves it: table `server_host`, one row `id = 'host'` with url, pid,
nonce and a per-start token (packages/opencode/src/server/host.ts). A record is LIVE only when its url answers
`/global/health` with the nonce it recorded — a pid is reused after a reboot and a port can belong to another
tree's server, so neither is trusted. Command routes need `Authorization: Basic base64("opencode:" + token)`.

The bridge, the robot waiter and any orchestration go through this module, so the header is spelled once.
It reads the DB read-only and NEVER prints the token.

    python tools/opencode_host.py [worktree]          # url, pid, started, live — exit 0 live, 2 stale, 3 none
    from opencode_host import connect; h = connect(r"D:\\zPython\\opencode"); h.get("/session/status")
"""
import base64
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HEALTH_TIMEOUT_S = 3  # host.ts answers health ~1.6 s late while booting a turn; 3 s covers it
USERNAME = "opencode"  # host.ts: Flag.OPENCODE_SERVER_USERNAME ?? "opencode"


class HostError(RuntimeError):
    """No live host for the worktree — stated, never a silent fallback to a private server."""


def db_path(worktree: str) -> Path:
    return Path(worktree) / ".opencode" / "data" / "opencode.db"  # storage/db.ts getProjectDbPath


def lookup(worktree: str) -> dict | None:
    path = db_path(worktree)
    if not path.exists():
        return None
    db = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        row = db.execute(
            "select url, pid, nonce, token, time_started from server_host where id = 'host'"
        ).fetchone()
    except sqlite3.OperationalError as error:  # a DB from a binary without the table
        if "no such table" in str(error):
            return None
        raise
    finally:
        db.close()
    if not row:
        return None
    return dict(zip(("url", "pid", "nonce", "token", "time_started"), row))


def is_live(record: dict) -> bool:
    try:
        with urllib.request.urlopen(urllib.parse.urljoin(record["url"], "/global/health"), timeout=HEALTH_TIMEOUT_S) as r:
            return json.loads(r.read().decode("utf-8")).get("host") == record["nonce"]
    except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError):
        return False


class Host:
    def __init__(self, worktree: str, record: dict):
        self.worktree = worktree
        self.url = record["url"]
        self.pid = record["pid"]
        self._auth = "Basic " + base64.b64encode(f"{USERNAME}:{record['token']}".encode()).decode()

    def __repr__(self) -> str:  # the token stays out of every print
        return f"Host(url={self.url!r}, pid={self.pid})"

    def _request(self, method: str, path: str, query: dict | None, body) -> object:
        q = {"directory": self.worktree, **(query or {})}
        url = urllib.parse.urljoin(self.url, path) + "?" + urllib.parse.urlencode(q)
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": self._auth})
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else None

    def get(self, path: str, query: dict | None = None):
        return self._request("GET", path, query, None)

    def post(self, path: str, body=None, query: dict | None = None):
        return self._request("POST", path, query, body if body is not None else {})


def connect(worktree: str) -> Host:
    record = lookup(worktree)
    if record is None:
        raise HostError(f"no host record in {db_path(worktree)} — start the TUI (it claims the host) or `opencode serve`")
    if not is_live(record):
        raise HostError(f"host record is STALE: {record['url']} (pid {record['pid']}) does not echo its nonce")
    return Host(worktree, record)


def main() -> int:
    worktree = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).resolve().parent.parent)
    record = lookup(worktree)
    if record is None:
        print(f"none: no host record in {db_path(worktree)}")
        return 3
    live = is_live(record)
    started = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record["time_started"] / 1000))
    print(f"{'live' if live else 'STALE'}: {record['url']} pid={record['pid']} started={started}")
    return 0 if live else 2


if __name__ == "__main__":
    sys.exit(main())
