"""Genesis of the organization repository — idempotent; any agent of any model may run it.

    python ~/.org/genesis/init.py [--fossil PATH]

No ~/.org/org.fossil -> create it: ticket fields (ticket-schema.sql), robot users, the Protocol wiki page, and its
place in `fossil all list`. Its server not answering on 127.0.0.1:8079 -> start it, detached. Existing pieces are
left as they are. The admin password `fossil new` prints is never echoed.

Owner, 2026-10-04: «если нету org.fossil то его надо создать и установить, если есть подключиться и работать»;
«первый агент который увидел что ее нет - тут же ее поднимает».
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

HOME = Path(os.environ.get("ORG_HOME") or Path.home() / ".org")  # ORG_HOME/ORG_PORT: test fixtures only
ORG = HOME / "org.fossil"
GENESIS = Path(__file__).resolve().parent
PORT = int(os.environ.get("ORG_PORT") or 8079)
ROBOTS = ("claude", "codex", "antigravity")
ROBOT_CAPS = "Cnrwcjfkm"


def find_fossil(explicit: str | None) -> str:
    for candidate in (explicit, os.environ.get("FOSSIL"), shutil.which("fossil")):
        if candidate and Path(candidate).exists() or (candidate and shutil.which(candidate)):
            return candidate
    sys.exit("genesis: no fossil binary — pass --fossil PATH or set FOSSIL")


def run(fossil: str, *args: str, quiet: bool = False) -> str:
    out = subprocess.run([fossil, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode != 0:
        sys.exit(f"genesis: fossil {args[0]} failed: {out.stderr.strip() or out.stdout.strip()}")
    return "" if quiet else out.stdout


def server_up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=1):
            return True
    except OSError:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fossil")
    fossil = find_fossil(ap.parse_args().fossil)
    HOME.mkdir(parents=True, exist_ok=True)
    created = False

    if not ORG.exists():
        run(fossil, "new", str(ORG), quiet=True)  # its output carries the admin password: never printed
        schema = (GENESIS / "ticket-schema.sql").read_text(encoding="utf-8").replace("'", "''")
        run(fossil, "sql", "-R", str(ORG),
            f"INSERT OR REPLACE INTO config(name,value,mtime) VALUES('ticket-table','{schema}',now());")
        run(fossil, "rebuild", str(ORG), quiet=True)
        created = True

    users = run(fossil, "user", "list", "-R", str(ORG))
    for robot in ROBOTS:
        if not any(line.split()[:1] == [robot] for line in users.splitlines()):
            secret = os.urandom(18).hex()  # local -R work needs no password; HTTP login is a later step
            run(fossil, "user", "new", robot, "robot", secret, "-R", str(ORG), quiet=True)
            run(fossil, "user", "capabilities", robot, ROBOT_CAPS, "-R", str(ORG), quiet=True)

    pages = run(fossil, "wiki", "list", "-R", str(ORG)).split()
    verb = "commit" if "Protocol" in pages else "create"
    run(fossil, "wiki", verb, "Protocol", str(GENESIS / "Protocol.md"), "--mimetype", "text/x-markdown",
        "-R", str(ORG), quiet=True)

    run(fossil, "all", "add", str(ORG), quiet=True)

    if not server_up():
        log = open(HOME / "server.log", "ab")
        flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        subprocess.Popen([fossil, "server", str(ORG), "--localhost", "--port", str(PORT), "--localauth"],
                         stdout=log, stderr=log, stdin=subprocess.DEVNULL, creationflags=flags)

    tickets = run(fossil, "sql", "-R", str(ORG), "SELECT count(*) FROM ticket;").strip()
    print(f"org: {ORG} ({'created' if created else 'present'}); tickets={tickets}; "
          f"server 127.0.0.1:{PORT} {'up' if server_up() else 'starting'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
