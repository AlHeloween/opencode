"""org.py — the organization's verbs over $HOME/.org/org.fossil (one file, stdlib only).

    python ~/.org/genesis/org.py delegate --title "..." --assignee smit-x --worktree D:\\proj
    python ~/.org/genesis/org.py claim <uuid> [--lease 600]
    python ~/.org/genesis/org.py heartbeat <uuid> [--what "..."] [--lease 600]
    python ~/.org/genesis/org.py report <uuid> --title NAME (--file f.md | --text "...")
    python ~/.org/genesis/org.py done <uuid> [--report NAME]
    python ~/.org/genesis/org.py escalate <uuid> --code "why"
    python ~/.org/genesis/org.py inbox

Reads go straight to the SQLite file (mode=ro); every write goes through the fossil CLI so the
repository keeps its artifact semantics. Identity: --user or $ORG_USER — the Fossil login is the
author; escalate ends with the owner (the admin).

Claim arbitration: `fossil ticket` has no compare-and-swap, so a claim races through an
exclusive-create lock file ($ORG_HOME/locks/<uuid>.<epoch>): the process that creates it owns
that epoch; a loser names the holder and exits non-zero. A WORKING ticket past its lease
(lease_until < now) may be taken over with epoch+1.

Wake bookkeeping (the fields orgd reads): wake_session + wake_worktree name the delegator's
session to wake on DONE/BLOCKED/stall; woken_state = the last wake kind already sent for the
current situation. claim/heartbeat/done/escalate reset it to CLEARED ("-") so a later
transition can wake again — never to "", because an empty field value is silently ignored.

Session discovery (T3, measured 2026-10-08): a tool call's environment carries NO session id —
OPENCODE_PID/OPENCODE_RUN_ID identify the process run, not the session. The session id is
visible to the model in its own context as the banner `[session: ses_...:<model>]`
(packages/opencode/src/session/llm.ts:569). As a convenience --session may be omitted: org.py
then looks for the running tool call in this worktree's database that names this script and
verb — exactly one candidate is used; zero or several is an error naming the flag.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HOME = Path(os.environ.get("ORG_HOME") or Path.home() / ".org")  # ORG_HOME/ORG_PORT: test fixtures only
ORG = HOME / "org.fossil"
LOCKS = HOME / "locks"
PORT = int(os.environ.get("ORG_PORT") or 8079)
LEASE_S = 600  # default lease; a robot's claim/heartbeat --lease must agree
CLEARED = "-"  # woken_state reset marker: `fossil ticket set F ""` succeeds and keeps the OLD value (measured 2026-10-08)


def find_fossil() -> str:
    for candidate in (os.environ.get("FOSSIL"), shutil.which("fossil"), Path(__file__).resolve().parent / "fossil.exe"):
        if candidate and (Path(candidate).exists() or shutil.which(candidate)):
            return candidate
    sys.exit("org: no fossil binary — set FOSSIL or put fossil on PATH")


def fossil(*args: str, user: str | None = None, check: bool = True) -> str:
    cmd = [find_fossil(), *args, "-R", str(ORG)]
    if user:
        cmd += ["-U", user]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and out.returncode != 0:
        sys.exit(f"org: fossil {args[0]} failed: {out.stderr.strip() or out.stdout.strip()}")
    return out.stdout or ""


def connect(db: Path) -> sqlite3.Connection:
    return sqlite3.connect("file:" + urllib.request.pathname2url(str(db)) + "?mode=ro", uri=True, timeout=15)


def rows(query: str, params: tuple = ()) -> list[sqlite3.Row]:
    con = connect(ORG)
    try:
        con.row_factory = sqlite3.Row
        return con.execute(query, params).fetchall()
    finally:
        con.close()


def ticket(prefix: str) -> sqlite3.Row:
    found = rows("SELECT * FROM ticket WHERE tkt_uuid LIKE ? || '%'", (prefix,))
    if not found:
        sys.exit(f"org: no ticket {prefix!r}")
    if len(found) > 1:
        sys.exit(f"org: {prefix!r} matches {len(found)} tickets — give more characters")
    return found[0]


def short(t: sqlite3.Row) -> str:
    return str(t["tkt_uuid"])[:10]


def num(value) -> int:
    try:
        return int(float(value)) if value not in (None, "") else 0
    except (TypeError, ValueError):
        return 0


def now() -> int:
    return int(time.time())


def need_user(a) -> str:
    user = a.user or os.environ.get("ORG_USER")
    if not user:
        sys.exit("org: --user is required (or set $ORG_USER) — the Fossil login that authors the change")
    return user


def ticket_set(t: sqlite3.Row, user: str, **fields) -> None:
    args: list[str] = []
    for key, value in fields.items():
        args += [key, "" if value is None else str(value)]
    fossil("ticket", "set", str(t["tkt_uuid"]), *args, user=user)


def discover_session(verb: str, worktree: Path) -> str | None:
    """The session whose running tool call names this script and verb, when unambiguous."""
    db = worktree / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return None
    con = connect(db)
    try:
        parts = con.execute(
            "SELECT session_id, data FROM part WHERE data LIKE '%org.py%' AND data LIKE '%running%'"
        ).fetchall()
    finally:
        con.close()
    horizon = int(time.time() * 1000) - 120_000
    found: set[str] = set()
    for session_id, data in parts:
        try:
            state = (json.loads(data) or {}).get("state") or {}
        except ValueError:
            continue
        if state.get("status") != "running":
            continue
        if ((state.get("time") or {}).get("start") or 0) < horizon:
            continue
        text = json.dumps(state.get("input") or {})
        if "org.py" in text and verb in text:
            found.add(session_id)
    return found.pop() if len(found) == 1 else None


def resolve_session(a, verb: str) -> str | None:
    if a.session:
        return a.session
    if os.environ.get("ORG_SESSION"):
        return os.environ["ORG_SESSION"]
    return discover_session(verb, Path.cwd())


def need_session(a, verb: str) -> str:
    session = resolve_session(a, verb)
    if not session:
        sys.exit(
            f"org: cannot determine the calling session — pass --session ses_… "
            f"(the first field of the `[session: …]` banner in your own context)"
        )
    return session


def chat(text: str) -> bool:
    out = subprocess.run(
        [find_fossil(), "chat", "send", "-m", text, "--remote", f"http://127.0.0.1:{PORT}", "--unsafe", "-R", str(ORG)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if out.returncode != 0:
        print(f"org: chat send failed: {out.stderr.strip() or out.stdout.strip()}", file=sys.stderr)
        return False
    return True


def cmd_delegate(a) -> int:
    user = need_user(a)
    known = rows("SELECT 1 FROM user WHERE login = ?", (a.assignee,))
    if not known:
        sys.exit(f"org: no such user {a.assignee!r} — create it first (fossil user new {a.assignee} robot <secret> -R <org>)")
    session = need_session(a, "delegate")
    worktree = a.worktree or str(Path.cwd())
    if a.parent:
        parent = ticket(a.parent)
        root = a.root or str(parent["root_task"] or parent["tkt_uuid"])
        depth = a.depth if a.depth is not None else num(parent["delegation_depth"]) + 1
        parent_args = ["parent_task", str(parent["tkt_uuid"])]
    else:
        root, depth, parent_args = a.root or "", (a.depth if a.depth is not None else 0), []
    out = fossil(
        "ticket", "add",
        "title", a.title, "type", "Task", "status", "Open",
        "agent_state", "READY", "delegated_by", user, "assigned_to", a.assignee,
        "delegation_depth", str(depth), "workspace_repo", worktree,
        "wake_session", session, "wake_worktree", worktree,
        *parent_args,
        *(["root_task", root] if root else []),
        *(["sv", a.sv] if a.sv else []),
        *(["comment", a.comment] if a.comment else []),
        user=user,
    )
    new = parse_ticket_uuid(out)
    if not new:
        sys.exit(f"org: could not read the new ticket id from `ticket add` output: {out.strip()!r}")
    if not root:
        ticket_set(ticket(new), user, root_task=new)
    print(new)
    return 0


def parse_ticket_uuid(out: str) -> str:
    for token in out.replace("\n", " ").split():
        clean = token.strip(".,:;<>[]()'\"")
        if len(clean) in (40, 64) and all(c in "0123456789abcdef" for c in clean.lower()):
            return clean
    return ""


def cmd_claim(a) -> int:
    user = need_user(a)
    t = ticket(a.ticket)
    state = str(t["agent_state"] or "").upper()
    if state in ("DONE", "BLOCKED"):
        sys.exit(f"org: ticket {short(t)} is {state} — not claimable")
    now_s = now()
    owner = str(t["lease_owner"] or "")
    until = num(t["lease_until"])
    if state == "WORKING" and owner and owner != user and until and until > now_s:
        sys.exit(f"org: ticket {short(t)} is leased by {owner} until {until} — not claimable")
    epoch = num(t["lease_epoch"]) + 1
    LOCKS.mkdir(parents=True, exist_ok=True)
    lock = LOCKS / f"{t['tkt_uuid']}.{epoch}"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        holder = lock.read_text(encoding="utf-8", errors="replace").strip() if lock.exists() else ""
        sys.exit(f"org: claim lost: {short(t)} epoch {epoch} already claimed by {holder or 'unknown'}")
    os.write(fd, f"{user} {now_s}\n".encode())
    os.close(fd)
    ticket_set(t, user,
               agent_state="WORKING", lease_owner=user, lease_epoch=str(epoch),
               lease_until=str(now_s + a.lease), heartbeat_at=str(now_s), woken_state=CLEARED)
    print(f"org: claim won: {short(t)} epoch {epoch} by {user} (lease {a.lease}s)")
    return 0


def cmd_heartbeat(a) -> int:
    user = need_user(a)
    t = ticket(a.ticket)
    owner = str(t["lease_owner"] or "")
    if owner and owner != user:
        sys.exit(f"org: ticket {short(t)} is leased by {owner} — heartbeat refused")
    now_s = now()
    ticket_set(t, user, heartbeat_at=str(now_s), lease_until=str(now_s + a.lease), woken_state=CLEARED)
    chat(f"HEARTBEAT {user} {short(t)} {a.what or 'working'}")
    print(f"org: heartbeat {short(t)} lease {a.lease}s")
    return 0


def cmd_report(a) -> int:
    user = need_user(a)
    t = ticket(a.ticket)
    if a.file:
        path = Path(a.file)
        if not path.exists():
            sys.exit(f"org: report file {a.file!r} not found")
    elif a.text is not None:
        handle = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
        handle.write(a.text)
        handle.close()
        path = Path(handle.name)
    else:
        sys.exit("org: report needs --file or --text")
    name = a.title
    out = fossil("wiki", "create", name, str(path), "--mimetype", "text/x-markdown",
                 "--technote", "now", "--technote-tags", f"task-{short(t)}", user=user, check=False)
    if "exist" in (out or "").lower() or not out.strip():
        name = f"{a.title} [{short(t)}]"
        out = fossil("wiki", "create", name, str(path), "--mimetype", "text/x-markdown",
                     "--technote", "now", "--technote-tags", f"task-{short(t)}", user=user, check=False)
    if "exist" in (out or "").lower():
        sys.exit(f"org: technote {name!r} already exists — choose another --title")
    ticket_set(t, user, report_ref=name)
    print(name)
    return 0


def cmd_done(a) -> int:
    user = need_user(a)
    t = ticket(a.ticket)
    owner = str(t["lease_owner"] or "")
    if owner and owner != user:
        sys.exit(f"org: ticket {short(t)} is leased by {owner} — not yours to close")
    ticket_set(t, user, agent_state="DONE", woken_state=CLEARED, **({"result_ref": a.report} if a.report else {}))
    print(f"org: {short(t)} DONE" + (f" report={a.report}" if a.report else ""))
    return 0


def cmd_escalate(a) -> int:
    user = need_user(a)
    t = ticket(a.ticket)
    owner = str(t["lease_owner"] or "")
    if owner and owner != user:
        sys.exit(f"org: ticket {short(t)} is leased by {owner} — not yours to escalate")
    ticket_set(t, user, agent_state="BLOCKED", failure_code=a.code, woken_state=CLEARED)
    print(f"org: {short(t)} BLOCKED: {a.code}")
    return 0


def cmd_inbox(a) -> int:
    user = need_user(a)
    mine = rows(
        "SELECT tkt_uuid, title, agent_state, lease_owner, parent_task FROM ticket "
        "WHERE assigned_to = ? AND agent_state IN ('READY','WORKING','BLOCKED') ORDER BY tkt_ctime DESC",
        (user,),
    )
    if not mine:
        print(f"org: inbox empty for {user}")
    for row in mine:
        lease = f" lease={row['lease_owner']}" if row["lease_owner"] else ""
        print(f"{str(row['tkt_uuid'])[:10]}  {str(row['agent_state']):<8}{lease}  {row['title']}")
    session = resolve_session(a, "inbox")
    if session:
        if chat(f"PRESENCE {user} {session} {Path.cwd()}"):
            print(f"org: presence {user} at {session} ({Path.cwd()}) — the organization will wake this session")
    else:
        print("org: presence skipped — calling session unknown (pass --session ses_… to register)", file=sys.stderr)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="org.py", description="the organization's verbs over $HOME/.org/org.fossil")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--user", help="Fossil login you act as (default $ORG_USER)")
    common.add_argument("--session", help="your opencode session id (default: auto-detect)")
    sub = parser.add_subparsers(dest="verb", required=True)

    p = sub.add_parser("delegate", parents=[common], help="create a READY ticket for another robot")
    p.add_argument("--title", required=True)
    p.add_argument("--assignee", required=True, help="Fossil login of the robot to work it")
    p.add_argument("--worktree", help="project path (default: cwd)")
    p.add_argument("--parent", help="parent ticket uuid (lineage)")
    p.add_argument("--root", help="root ticket uuid (default: the parent's root or this ticket)")
    p.add_argument("--depth", type=int, help="delegation depth (default: parent's +1, else 0)")
    p.add_argument("--sv", help="semantic vector md5 of the delegating reasoning step")
    p.add_argument("--comment", help="one line of context")
    p.set_defaults(func=cmd_delegate)

    p = sub.add_parser("claim", parents=[common], help="claim/lease a ticket (arbitrated by an epoch lock)")
    p.add_argument("ticket")
    p.add_argument("--lease", type=int, default=LEASE_S, help=f"lease seconds (default {LEASE_S})")
    p.set_defaults(func=cmd_claim)

    p = sub.add_parser("heartbeat", parents=[common], help="extend the lease; a stale lease wakes the delegator")
    p.add_argument("ticket")
    p.add_argument("--what", help="what you are doing (goes into the chat line)")
    p.add_argument("--lease", type=int, default=LEASE_S, help=f"lease seconds (default {LEASE_S})")
    p.set_defaults(func=cmd_heartbeat)

    p = sub.add_parser("report", parents=[common], help="create a technote and pin it to the ticket")
    p.add_argument("ticket")
    p.add_argument("--title", required=True, help="technote name")
    p.add_argument("--file", help="markdown file to attach")
    p.add_argument("--text", help="inline markdown")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("done", parents=[common], help="close the ticket DONE (wakes your delegator)")
    p.add_argument("ticket")
    p.add_argument("--report", help="technote name of the result")
    p.set_defaults(func=cmd_done)

    p = sub.add_parser("escalate", parents=[common], help="mark BLOCKED with a failure code (wakes your delegator)")
    p.add_argument("ticket")
    p.add_argument("--code", required=True, help="why it is blocked")
    p.set_defaults(func=cmd_escalate)

    p = sub.add_parser("inbox", parents=[common], help="list your tickets and register this session for wakes")
    p.set_defaults(func=cmd_inbox)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
