"""orgd.py — the organization's heartbeat: one loop every 15 s over $HOME/.org/org.fossil.

It is the only thing that re-enters a robot's session, so a delegator that left its loop is
woken when its child ends, and an assignee is woken when a ticket lands:

  1. DONE / BLOCKED ticket, its delegator not yet woken for this state -> prompt_async into
     wake_session on the host of wake_worktree (shared client: opencode_host.py):
     state + report ref + «verify it and continue your task»; then woken_state = the state.
  2. WORKING ticket past its lease (lease_until < now; a heartbeat extends it) and not yet
     woken as stalled -> wake the delegator with «stalled»; woken_state = STALLED. A fresh
     heartbeat or a new claim clears woken_state, so a later stall wakes again.
  3. READY ticket with workspace_repo -> wake the assignee: the session of the newest PRESENCE
     line (user, session, worktree) for that assignee and worktree — `org.py inbox` registers
     it — else the newest session of that worktree; text = «new ticket in your inbox»;
     woken_state = NEW.
  4. No live host / no such session -> nothing sent, nothing recorded, retry next tick.
     Never start a second server: one worktree = one host.

woken_state is written ONLY after the POST answered 2xx — a failed send retries; a session id
that no longer exists is logged (once per change) and skipped, never guessed around. The wake
goes through the shared client, which reads the host record (url/pid/nonce/token) from the
worktree DB and proves liveness by the /global/health nonce echo.

Run: python orgd.py [--once] [--interval 15]     (init.py starts it detached; --once for tests)
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOME = Path(os.environ.get("ORG_HOME") or Path.home() / ".org")  # ORG_HOME: test fixtures only
ORG = HOME / "org.fossil"
STATE = HOME / "orgd.state"
LOG = HOME / "orgd.log"
INTERVAL_S = 15

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import opencode_host
except Exception as error:  # reported at the first wake, never silent
    opencode_host = None
    IMPORT_ERROR = error
else:
    IMPORT_ERROR = None

LAST_LOG: dict[str, str] = {}  # tag -> last message; a repeated failure logs once, not every tick


def find_fossil() -> str | None:
    for candidate in (os.environ.get("FOSSIL"), shutil.which("fossil"), Path(__file__).resolve().parent / "fossil.exe"):
        if candidate and (Path(candidate).exists() or shutil.which(candidate)):
            return candidate
    return None


def connect(db: Path) -> sqlite3.Connection:
    return sqlite3.connect("file:" + urllib.request.pathname2url(str(db)) + "?mode=ro", uri=True, timeout=15)


def tickets() -> list[sqlite3.Row]:
    con = connect(ORG)
    try:
        con.row_factory = sqlite3.Row
        return con.execute(
            "SELECT tkt_uuid, title, agent_state, wake_session, wake_worktree, woken_state, report_ref, "
            "failure_code, assigned_to, workspace_repo, lease_until, heartbeat_at FROM ticket "
            "WHERE agent_state IN ('READY','WORKING','DONE','BLOCKED')"
        ).fetchall()
    finally:
        con.close()


def ticket_set(uuid: str, **fields) -> bool:
    fossil = find_fossil()
    if not fossil:
        log(f"no fossil binary — cannot record woken_state on {uuid[:10]}")
        return False
    args: list[str] = []
    for key, value in fields.items():
        args += [key, "" if value is None else str(value)]
    out = subprocess.run([fossil, "ticket", "set", uuid, *args, "-R", str(ORG)],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode != 0:
        log(f"ticket set {uuid[:10]} failed: {out.stderr.strip() or out.stdout.strip()}")
        return False
    return True


def num(value) -> int:
    try:
        return int(float(value)) if value not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def log(message: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n"
    try:
        if LOG.exists() and LOG.stat().st_size > 2_000_000:
            os.replace(LOG, LOG.parent / "orgd.log.1")
        with LOG.open("a", encoding="utf-8") as handle:
            handle.write(line)
    except OSError:
        pass
    if not QUIET:
        print(line, end="", flush=True)


def log_once(tag: str, message: str) -> None:
    if LAST_LOG.get(tag) == message:
        return
    LAST_LOG[tag] = message
    log(message)


def pid_alive(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    ctypes.windll.kernel32.CloseHandle(handle)
    return True


def norm(path: str) -> str:
    return str(path).replace("\\", "/").rstrip("/").lower()


def session_exists(worktree: str, session_id: str) -> bool:
    db = Path(worktree) / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return False
    con = connect(db)
    try:
        return con.execute("SELECT 1 FROM session WHERE id = ?", (session_id,)).fetchone() is not None
    finally:
        con.close()


def newest_session(worktree: str) -> str | None:
    db = Path(worktree) / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return None
    con = connect(db)
    try:
        row = con.execute("SELECT id FROM session ORDER BY time_updated DESC LIMIT 1").fetchone()
        return row[0] if row else None
    finally:
        con.close()


def assignee_session(assigned_to: str, worktree: str) -> str | None:
    """Where the organization knocks: the assignee's newest PRESENCE in this worktree, else its newest session."""
    con = connect(ORG)
    try:
        lines = con.execute("SELECT xmsg FROM chat ORDER BY msgid DESC LIMIT 400").fetchall()
    finally:
        con.close()
    for (message,) in lines:
        parts = str(message or "").split()
        if len(parts) >= 4 and parts[0] == "PRESENCE" and parts[1] == assigned_to and norm(parts[3]) == norm(worktree):
            if session_exists(worktree, parts[2]):
                return parts[2]
            break  # the newest presence names a dead session — fall through to the newest session
    return newest_session(worktree)


def wake(session_id: str, worktree: str, text: str, tag: str) -> bool:
    if opencode_host is None:
        log_once(tag, f"opencode_host unavailable: {IMPORT_ERROR}")
        return False
    try:
        host = opencode_host.connect(worktree)
    except opencode_host.HostError as error:
        log_once(tag, f"{tag}: host not live — {error}")
        return False
    try:
        host.get(f"/session/{session_id}")
    except Exception as error:  # 404 -> the id is gone; do not retry it in silence
        log_once(tag, f"{tag}: session {session_id} not found on {host.url}: {error}")
        return False
    try:
        host.post(f"/session/{session_id}/prompt_async", {"parts": [{"type": "text", "text": text}]})
    except Exception as error:
        log_once(tag, f"{tag}: prompt_async failed: {error}")
        return False
    log(f"{tag}: woke {session_id} on {host.url}")
    LAST_LOG.pop(tag, None)
    return True


def tick() -> list[str]:
    actions: list[str] = []
    now_s = int(time.time())
    for t in tickets():
        state = str(t["agent_state"] or "").upper()
        uuid = str(t["tkt_uuid"])
        head = uuid[:10]
        woken = str(t["woken_state"] or "")
        if state in ("DONE", "BLOCKED") and t["wake_session"] and woken != state:
            if state == "DONE":
                text = (f"ORG ticket {uuid} is DONE. report={t['report_ref'] or 'none'}. "
                        f"Verify the child's result and continue your task.")
            else:
                text = (f"ORG ticket {uuid} is BLOCKED: {t['failure_code'] or 'no failure_code'}. "
                        f"Decide: unblock, re-delegate, or escalate.")
            if wake(str(t["wake_session"]), str(t["wake_worktree"] or ""), text, f"{head}/{state.lower()}"):
                if ticket_set(uuid, woken_state=state):
                    actions.append(f"{head}: {state.lower()} -> woke delegator {t['wake_session']}")
        elif state == "WORKING":
            deadline = num(t["lease_until"]) or num(t["heartbeat_at"])
            if deadline and deadline < now_s and woken != "STALLED" and t["wake_session"]:
                ago, hb = now_s - deadline, num(t["heartbeat_at"])
                text = (f"ORG ticket {uuid} is STALLED: WORKING but its lease expired {ago}s ago "
                        f"(last heartbeat {hb or 'never'}). Check on the worker or take the ticket over.")
                if wake(str(t["wake_session"]), str(t["wake_worktree"] or ""), text, f"{head}/stalled"):
                    if ticket_set(uuid, woken_state="STALLED"):
                        actions.append(f"{head}: stalled -> woke delegator {t['wake_session']}")
        elif state == "READY" and t["workspace_repo"] and woken != "NEW":
            session_id = assignee_session(str(t["assigned_to"] or ""), str(t["workspace_repo"]))
            if session_id:
                text = (f"ORG ticket {uuid} is a NEW ticket in your inbox: {t['title']}. "
                        f"Claim it or hand it on.")
                if wake(session_id, str(t["workspace_repo"]), text, f"{head}/new"):
                    if ticket_set(uuid, woken_state="NEW"):
                        actions.append(f"{head}: new -> woke assignee {session_id}")
    return actions


def write_state(tick_number: int, actions: list[str]) -> None:
    tmp = STATE.parent / "orgd.state.tmp"
    tmp.write_text(json.dumps({
        "pid": os.getpid(),
        "tick": tick_number,
        "time": int(time.time()),
        "interval": INTERVAL,
        "last_actions": actions,
    }), encoding="utf-8")
    os.replace(tmp, STATE)


QUIET = False
INTERVAL = INTERVAL_S


def main() -> int:
    global QUIET, INTERVAL
    parser = argparse.ArgumentParser(prog="orgd.py", description="the organization's heartbeat")
    parser.add_argument("--once", action="store_true", help="run one tick and exit (tests)")
    parser.add_argument("--interval", type=int, default=INTERVAL_S)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    QUIET, INTERVAL = args.quiet, args.interval

    if not ORG.exists():
        sys.exit("orgd: no org.fossil — run init.py first")

    if not args.once and STATE.exists():
        try:
            prior = int(json.loads(STATE.read_text(encoding="utf-8")).get("pid") or 0)
        except (ValueError, OSError):
            prior = 0
        if prior and prior != os.getpid() and pid_alive(prior):
            print(f"orgd: already running (pid {prior}) — nothing started")
            return 3

    number = 0
    while True:
        number += 1
        actions = tick()
        write_state(number, actions)
        if args.once:
            for action in actions:
                print(action)
            return 0
        time.sleep(INTERVAL)


if __name__ == "__main__":
    raise SystemExit(main())
