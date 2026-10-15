"""orgd.py — the organization's heartbeat: one loop every 15 s over $ORG_HOME/org.fossil (default $HOME/.org).

It is the only thing that re-enters a robot's session, so a delegator that left its loop is
woken when its child ends, and an assignee is woken when a ticket lands:

  1. DONE / BLOCKED ticket, its delegator not yet woken for this state -> prompt_async into
     wake_session on the host of wake_worktree (shared client: opencode_host.py):
     state + report ref + «verify it and continue your task»; then woken_state = the state.
  2. WORKING ticket past its lease (lease_until < now; a heartbeat extends it) and not yet
     woken as stalled -> wake the delegator with «stalled»; woken_state = STALLED. A fresh
     heartbeat or a new claim clears woken_state, so a later stall wakes again.
  3. READY ticket with workspace_repo -> wake the ASSIGNEE'S OWN session: the one named by
     the newest PRESENCE line (user, session, worktree) for that assignee and this worktree —
     `org.py inbox` registers it; text = «new ticket in your inbox»; woken_state = NEW. No
     such PRESENCE (or its session is gone) -> NOTHING is sent and the reason is logged once
     (never every tick): a wake lands only where the assignee declared itself — never in
     whatever session happens to be newest. (That fallback woke another robot's or the
     owner's session for a ticket that was never theirs, found 2026-10-08.)
  4. No live host / no such session -> nothing sent, nothing recorded, retry next tick.
     Never start a second server: one worktree = one host.

Every wake is recorded on the ticket as an effect BEFORE it is sent: the effect carries
idempotency_key = sha256(ticket|state|target|lease-epoch|last-heartbeat) and status PENDING, and a
2xx response sets woken_state = the state (COMMITTED). A crash between the send and the record
leaves PENDING: a later tick RESOLVES it by reading the target session for the wake marker
`[wake <key16>]` — delivered -> commit; absent -> send (the read proved nothing arrived, so this is
no longer blind); unreadable -> UNKNOWN and NOTHING is sent. A session id that no longer exists is
logged (once per change) and skipped, never guessed around. The wake goes through the shared client,
which reads the host record (url/pid/nonce/token) from the worktree DB and proves liveness by the
/global/health nonce echo.

Run: python orgd.py [--once] [--interval 15]     (init.py starts it detached; --once for tests)
"""

from __future__ import annotations

import argparse
import hashlib
import ctypes
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import orgcfg  # the ONE settings/fossil resolver, shared with init.py and org.py

HOME = orgcfg.HOME
ORG = orgcfg.ORG
STATE = HOME / "orgd.state"
LOG = HOME / "orgd.log"
INTERVAL_S = 15

try:
    import opencode_host
except Exception as error:  # reported at the first wake, never silent
    opencode_host = None
    IMPORT_ERROR = error
else:
    IMPORT_ERROR = None

LAST_LOG: dict[str, str] = {}  # tag -> last message; a repeated failure logs once, not every tick


def connect(db: Path) -> sqlite3.Connection:
    return sqlite3.connect("file:" + urllib.request.pathname2url(str(db)) + "?mode=ro", uri=True, timeout=15)


def tickets() -> list[sqlite3.Row]:
    con = connect(ORG)
    try:
        con.row_factory = sqlite3.Row
        return con.execute(
            "SELECT tkt_uuid, title, agent_state, wake_session, wake_worktree, woken_state, report_ref, "
            "failure_code, assigned_to, workspace_repo, lease_until, heartbeat_at, lease_epoch, "
            "idempotency_key, knowledge_ref FROM ticket "
            "WHERE agent_state IN ('READY','WORKING','DONE','BLOCKED')"
        ).fetchall()
    finally:
        con.close()


def ticket_set(uuid: str, **fields) -> bool:
    fossil = orgcfg.find_fossil()
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


def assignee_session(assigned_to: str, worktree: str) -> tuple[str | None, str]:
    """Where the organization knocks: ONLY the assignee's own PRESENCE in this worktree.

    A wake goes to a session that declared ITSELF the addressee (`org.py inbox` writes the
    PRESENCE line) or to nobody — never to "whichever session is newest": measured
    2026-10-08, that fallback woke a session that never asked for the ticket. Returns
    (session_id, "") or (None, why); the caller logs `why` once per change, not per tick.
    """
    con = connect(ORG)
    try:
        try:
            lines = con.execute("SELECT xmsg FROM chat ORDER BY msgid DESC LIMIT 400").fetchall()
        except sqlite3.OperationalError as error:  # born-empty org: the chat table appears with the first send
            if "no such table" not in str(error):
                raise
            lines = []
    finally:
        con.close()
    for (message,) in lines:
        parts = str(message or "").split()
        if len(parts) >= 4 and parts[0] == "PRESENCE" and parts[1].lower() == assigned_to.lower() and norm(parts[3]) == norm(worktree):
            if session_exists(worktree, parts[2]):
                return parts[2], ""
            return None, f"the newest PRESENCE for {assigned_to} names a session that no longer exists ({parts[2]})"
    return None, (f"no PRESENCE for {assigned_to} in {worktree} — nothing to wake; "
                  f"`org.py inbox` there registers the session")


def effect_key(t: sqlite3.Row, kind: str, target: str) -> str:
    """The idempotency key of one wake effect: hash(ticket, state, target, lease-instance).

    The epoch and the last heartbeat are part of the material because one ticket meets the same
    `kind` more than once (a second stall inside one lease after a re-wake; a reworked child
    reaching DONE again): without them two different situations share one key, and a resolution
    could take a previous delivery for this one."""
    material = "|".join((str(t["tkt_uuid"]), kind, target,
                         str(num(t["lease_epoch"])), str(num(t["heartbeat_at"]))))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def effect_resolution(worktree: str, session_id: str, key: str, tag: str) -> str:
    """Read the target session for this effect's wake marker: delivered / absent / unreadable."""
    db = Path(worktree) / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return "unreadable"
    con = connect(db)
    try:
        try:
            found = con.execute("SELECT 1 FROM part WHERE session_id = ? AND data LIKE ? LIMIT 1",
                                (session_id, f"%[wake {key[:16]}]%")).fetchone() is not None
        except sqlite3.OperationalError as error:
            log_once(f"{tag}/resolve", f"{tag}: effect resolution cannot read {db}: {error}")
            return "unreadable"
    finally:
        con.close()
    return "delivered" if found else "absent"


def wake_effect(t: sqlite3.Row, kind: str, session_id: str, worktree: str, text: str,
                head: str, actions: list[str]) -> None:
    """Send one wake as an effect — or resolve a previous attempt by reading, never both."""
    uuid = str(t["tkt_uuid"])
    key = effect_key(t, kind, session_id)
    tag = f"{head}/{kind.lower()}"
    woken = str(t["woken_state"] or "")
    if woken in ("PENDING", "UNKNOWN") and str(t["idempotency_key"] or "") == key:
        resolution = effect_resolution(worktree, session_id, key, tag)
        if resolution == "delivered":
            if ticket_set(uuid, woken_state=kind):
                actions.append(f"{head}: {kind.lower()} -> effect resolved by reading (already delivered; not resent)")
            return
        if resolution == "unreadable":
            if woken != "UNKNOWN":
                ticket_set(uuid, woken_state="UNKNOWN")
            log_once(f"{tag}/resolve",
                     f"{tag}: a recorded wake effect cannot be read back yet — retrying resolution, never resending blind")
            return
        # absent: the read proves nothing arrived — sending now is not blind
    result = wake(uuid, kind, key, session_id, worktree, text, tag)
    if result == "sent":
        if ticket_set(uuid, woken_state=kind):
            role = "assignee" if kind == "NEW" else "delegator"
            actions.append(f"{head}: {kind.lower()} -> woke {role} {session_id}")
    elif result == "unknown":
        actions.append(f"{head}: {kind.lower()} -> send outcome unknown (effect PENDING); resolved by reading next tick")


def wake(uuid: str, kind: str, key: str, session_id: str, worktree: str, text: str, tag: str) -> str:
    """Send one wake as a recorded effect; the outcome decides what its caller records.

    Returns "sent" (the POST answered 2xx), "unknown" (the POST was attempted and its outcome is
    unknown — the effect stays PENDING for a read-resolution on a later tick), "skipped" (host or
    session unavailable: nothing was attempted), or "unrecorded" (the PENDING row could not be
    written: nothing is sent, because a send without a record cannot be resolved)."""
    if opencode_host is None:
        log_once(tag, f"opencode_host unavailable: {IMPORT_ERROR}")
        return "skipped"
    try:
        host = opencode_host.connect(worktree)
    except opencode_host.HostError as error:
        log_once(tag, f"{tag}: host not live — {error}")
        return "skipped"
    try:
        host.get(f"/session/{session_id}")
    except Exception as error:  # 404 -> the id is gone; do not retry it in silence
        log_once(tag, f"{tag}: session {session_id} not found on {host.url}: {error}")
        return "skipped"
    if not ticket_set(uuid, idempotency_key=key, woken_state="PENDING"):
        log_once(tag, f"{tag}: cannot record the PENDING effect — nothing sent")
        return "unrecorded"
    try:
        host.post(f"/session/{session_id}/prompt_async",
                  {"parts": [{"type": "text", "text": text + f" [wake {key[:16]}]"}]})
    except Exception as error:
        log_once(tag, f"{tag}: send outcome unknown (effect PENDING, {host.url}): {error} — resolve by reading next tick")
        return "unknown"
    log(f"{tag}: woke {session_id} on {host.url}")
    LAST_LOG.pop(tag, None)
    return "sent"


def maintenance_marker() -> Path:
    """Bin-promotion drain gate (t55): promote_bin.py writes this file while a promotion runs.
    While it exists orgd withholds every wake — dispatchers send nothing new mid-swap."""
    return HOME / "maintenance"


def in_maintenance() -> bool:
    return maintenance_marker().exists()


def tick() -> list[str]:
    actions: list[str] = []
    if in_maintenance():
        log_once("maintenance", "maintenance marker present — wakes withheld (bin promotion in progress)")
        return actions
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
            wake_effect(t, state, str(t["wake_session"]), str(t["wake_worktree"] or ""), text, head, actions)
        elif state == "WORKING":
            deadline = num(t["lease_until"]) or num(t["heartbeat_at"])
            if deadline and deadline < now_s and woken != "STALLED" and t["wake_session"]:
                ago, hb = now_s - deadline, num(t["heartbeat_at"])
                text = (f"ORG ticket {uuid} is STALLED: WORKING but its lease expired {ago}s ago "
                        f"(last heartbeat {hb or 'never'}). Check on the worker or take the ticket over.")
                wake_effect(t, "STALLED", str(t["wake_session"]), str(t["wake_worktree"] or ""), text, head, actions)
        elif state == "READY" and t["workspace_repo"] and woken != "NEW":
            session_id, why = assignee_session(str(t["assigned_to"] or ""), str(t["workspace_repo"]))
            if session_id:
                if t["knowledge_ref"]:
                    text = (f"ORG ticket {uuid} went REJECTED back to READY: {t['title']}. "
                            f"Rework findings: {t['knowledge_ref']}. Claim it again.")
                else:
                    text = (f"ORG ticket {uuid} is a NEW ticket in your inbox: {t['title']}. "
                            f"Claim it or hand it on.")
                wake_effect(t, "NEW", session_id, str(t["workspace_repo"]), text, head, actions)
            else:
                log_once(f"{head}/new", f"{head}/new: not woken — {why}")
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
