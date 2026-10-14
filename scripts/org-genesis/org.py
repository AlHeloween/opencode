"""org.py — the organization's verbs over $ORG_HOME/org.fossil (one file, stdlib only).

    python $ORG_HOME/genesis/org.py delegate --title "..." --assignee smit-x [--worktree D:\\proj] [--watcher claude] [--no-wake]
    python $ORG_HOME/genesis/org.py claim <uuid> [--lease 600]
    python $ORG_HOME/genesis/org.py heartbeat <uuid> --epoch N [--what "..."] [--lease 600]
    python $ORG_HOME/genesis/org.py report <uuid> --epoch N --title NAME (--file f.md | --text "...")
    python $ORG_HOME/genesis/org.py done <uuid> --epoch N [--report NAME]
    python $ORG_HOME/genesis/org.py escalate <uuid> --epoch N --code "why"
    python $ORG_HOME/genesis/org.py verify <uuid>                               (delegator: DONE -> VERIFIED)
    python $ORG_HOME/genesis/org.py reject <uuid> --title NAME (--file f.md | --text "...")   (delegator: DONE -> READY, findings)
    python $ORG_HOME/genesis/org.py cancel <uuid> --code "why"                  (delegator: -> CANCELLED)
    python $ORG_HOME/genesis/org.py inbox [--user X] [--json] [--no-presence]
    python $ORG_HOME/genesis/org.py chat --since <msgid>
    python $ORG_HOME/genesis/org.py wiki <page>          (protocol == wiki Protocol)
    python $ORG_HOME/genesis/org.py wiki-put PAGE --file UTF8.md --expect-sha256 HASH|absent --user LOGIN
    python $ORG_HOME/genesis/org.py forum [POST-ID]             (thread list; one thread to stdout)
    python $ORG_HOME/genesis/org.py forum-post (--title T | --reply ID) [--file f] --user LOGIN

Reads go straight to the SQLite file (mode=ro); every write goes through the fossil CLI so the
repository keeps its artifact semantics. Identity: --user or $ORG_USER — the Fossil login is the
author; escalate ends with the owner (the admin).

Settings (supported): ORG_HOME (default $HOME/.org), ORG_PORT (default 8079), FOSSIL. Without FOSSIL the fossil
beside these scripts outranks PATH (a bundled fossil is never shadowed). These reads are the ONLY read surface
agents need: `fossil sql` executes `.shell`/`.system`/`.output` even under --readonly, and `fossil wiki export
PAGE FILE` writes FILE (measured 2026-10-08) — no verb here passes raw SQL, and none writes a caller-named path.

Forum posting runs through the org's check-out ($ORG_HOME/checkout, created by init.py): fossil 2.28 has
no verb that posts to a forum, and a web post over the local server's --localauth authenticates as the
first setup-capable login (measured 2026-10-14: every post would be authored by the administrator, never
by --user) — so `forum-post` writes the forum manifest itself and hands it to `fossil test-content-put`
+ `fossil test-crosslink` inside the check-out (the content_put + manifest_crosslink pipeline the web
poster uses), with the author taken from --user. The post is proven by READING IT BACK — the stored
artifact byte-for-byte, the forumpost row, `fossil test-forumthread` — never by the writer's own output.

Claim arbitration: `fossil ticket` has no compare-and-swap, so a claim races through an
exclusive-create lock file ($ORG_HOME/locks/<uuid>.<epoch>): the process that creates it owns
that epoch; a loser names the holder and exits non-zero. A WORKING ticket past its lease
(lease_until < now) may be taken over with epoch+1. Every mutation then presents that epoch back:
heartbeat/report/done/escalate take `--epoch N`, and a stale epoch is refused with the current holder
named — a worker that lost its lease cannot write DONE over the new holder's work.

Wake bookkeeping (the fields orgd reads): wake_session + wake_worktree name the delegator's
session to wake on DONE/BLOCKED/stall; woken_state = the last wake kind already sent for the
current situation. claim/heartbeat/done/escalate reset it to CLEARED ("-") so a later
transition can wake again — never to "", because an empty field value is silently ignored.

Cross-worktree hand-off: `delegate --worktree W` with W outside the caller's worktree ensures W's resident login
`smit-<project>` (created if missing; a random password, never printed), records `watcher` (default claude,
`--watcher` to override) so `inbox --user <watcher>` lists the ticket under `watching`, and — when W has no live
host — prints the ONE launch command for W's own opencode; the delegator's robot runs it. No bin/opencode.exe
there → the note says so and the ticket stays READY.

DONE is the worker's testimony; the delegator closes the queue with a verdict: `verify` (VERIFIED,
terminal), `reject` (back to READY with a findings technote — the assignee is woken to rework) or
`cancel` (CANCELLED). Only the delegator (delegated_by) may pass a verdict.

`--no-wake` declares the delegator un-wakeable: no wake_session/wake_worktree is recorded,
and orgd never attempts a wake for that child's state changes — the delegator (e.g. a
Claude session that polls its inbox) reads its own inbox. Without it a delegator must be an
opencode session (--session or auto-discovery): a wake target that cannot receive is not
recorded, and a wake is never guessed into some other session.

Session discovery (T3, measured 2026-10-08): a tool call's environment carries NO session id —
OPENCODE_PID/OPENCODE_RUN_ID identify the process run, not the session. The session id is
visible to the model in its own context as the banner `[session: ses_...:<model>]`
(packages/opencode/src/session/llm.ts:569). As a convenience --session may be omitted: org.py
then looks for the running tool call in this worktree's database that names this script and
verb — exactly one candidate is used; zero or several is an error naming the flag.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import orgcfg  # the ONE settings/fossil resolver, shared with init.py and orgd.py

HOME = orgcfg.HOME
ORG = orgcfg.ORG
LOCKS = HOME / "locks"
PORT = orgcfg.PORT
LEASE_S = 600  # default lease; a robot's claim/heartbeat --lease must agree
CLEARED = "-"  # woken_state reset marker: `fossil ticket set F ""` succeeds and keeps the OLD value (measured 2026-10-08)

DEFAULT_WATCHER = "claude"    # the orchestrator login a cross hand-off reports to (`inbox --user <watcher>`)
RESIDENT_CAPS = "Cnrwcjfkm234"  # init.py ROBOT_CAPS: '234' = forum read/write/trusted (src/login.c)
FORUM_TITLE_MAX = 125            # the forum editor's title cap (src/forum.c forum_post_widget)
FORUM_WRITE_CAPS = set("34as")   # '3' WrForum, '4' WrForum-trusted; 'a'/'s' imply both (src/login.c)
CHECKOUT = orgcfg.CHECKOUT       # the org's open check-out — forum-post writes through it (init.py creates it)
STALL_READY_S = 3600          # a READY ticket unclaimed past this shows STALLED to its watcher

try:
    import opencode_host  # the ONE worktree host client, shared with orgd.py (live = /global/health nonce echo)
except Exception as error:  # reported by the cross hand-off itself, never silently
    opencode_host = None
    HOST_IMPORT_ERROR = error
else:
    HOST_IMPORT_ERROR = None


def find_fossil() -> str:
    fossil = orgcfg.find_fossil()
    if not fossil:
        sys.exit("org: no fossil binary — set FOSSIL, ship one beside the scripts, or put it on PATH")
    return fossil


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
            f"(the first field of the `[session: …]` banner in your own context), "
            f"or --no-wake if you poll your inbox instead"
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


CLOSED = ("VERIFIED", "CANCELLED")  # terminal queue states: nothing mutates them any more


def guard_lease(a, t: sqlite3.Row, verb: str) -> str:
    """The lease fence: a holder's verb presents the epoch its claim won.

    `fossil ticket set` has no compare-and-swap, so this is read-then-write — the smallest fence the
    repository allows. A worker whose lease was taken over (or re-claimed) presents a stale epoch and
    is refused with the current holder named: it cannot write DONE over the new holder's work."""
    user = need_user(a)
    state = str(t["agent_state"] or "").upper()
    owner = str(t["lease_owner"] or "")
    current = num(t["lease_epoch"])
    if state in CLOSED:
        sys.exit(f"org: {short(t)} is {state} — nothing left to change")
    if not owner:
        sys.exit(f"org: {short(t)} has no lease — claim it first; --epoch is the epoch your claim won")
    if a.epoch != current:
        sys.exit(f"org: stale epoch: {verb} refused for {short(t)} — you presented epoch {a.epoch}, "
                 f"but {owner} holds epoch {current}")
    if owner != user:
        sys.exit(f"org: ticket {short(t)} is leased by {owner} — not yours to {verb}")
    return user


def guard_delegator(t: sqlite3.Row, user: str, verb: str) -> None:
    """The verdict fence: only the delegator may accept, reject or cancel its ticket."""
    delegator = str(t["delegated_by"] or "")
    if delegator != user:
        sys.exit(f"org: ticket {short(t)} was delegated by {delegator or 'nobody'} — only the delegator may {verb} it")


def create_technote(t: sqlite3.Row, user: str, title: str, file: str | None, text: str | None,
                    label: str = "report") -> str:
    """Create NAME (or NAME [short]) as a technote tagged task-<id10>; refuses an existing name."""
    if file:
        path = Path(file)
        if not path.exists():
            sys.exit(f"org: {label} file {file!r} not found")
    elif text is not None:
        handle = tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8")
        handle.write(text)
        handle.close()
        path = Path(handle.name)
    else:
        sys.exit(f"org: {label} needs --file or --text")
    name = title
    out = fossil("wiki", "create", name, str(path), "--mimetype", "text/x-markdown",
                 "--technote", "now", "--technote-tags", f"task-{short(t)}", user=user, check=False)
    if "exist" in (out or "").lower() or not out.strip():
        name = f"{title} [{short(t)}]"
        out = fossil("wiki", "create", name, str(path), "--mimetype", "text/x-markdown",
                     "--technote", "now", "--technote-tags", f"task-{short(t)}", user=user, check=False)
    if "exist" in (out or "").lower():
        sys.exit(f"org: technote {name!r} already exists — choose another --title")
    return name


def norm_path(path: str) -> str:
    return os.path.normcase(str(Path(path).resolve()))


def ensure_resident(worktree: str) -> tuple[str, bool]:
    """The target worktree's resident login `smit-<project>`, created if missing; its secret is never printed."""
    login = f"smit-{Path(worktree).resolve().name}"
    if rows("SELECT 1 FROM user WHERE login = ?", (login,)):
        return login, False
    secret = os.urandom(18).hex()  # local -R work needs no password (init.py's rule)
    fossil("user", "new", login, "robot", secret)
    fossil("user", "capabilities", login, RESIDENT_CAPS)
    return login, True


def worktree_host_live(worktree: str) -> tuple[bool, str]:
    """The ONE host of that worktree is live (its record echoes /global/health), or the reason it is not."""
    if opencode_host is None:
        return False, f"opencode_host unavailable ({HOST_IMPORT_ERROR})"
    record = opencode_host.lookup(worktree)
    if record is None:
        return False, f"no host record in {opencode_host.db_path(worktree)}"
    if not opencode_host.is_live(record):
        return False, f"host record {record['url']} (pid {record['pid']}) does not echo its nonce"
    return True, str(record["url"])


def _quoted(path) -> str:
    text = str(path)
    return f'"{text}"' if " " in text else text


def launch_command(worktree: str, exe: Path) -> str:
    """The ONE visible launch command for that project's own opencode, on a free port."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return f"cmd_runner start --terminal wt --cwd {_quoted(worktree)} -- {_quoted(exe)} --port {port}"


def age_text(seconds: int) -> str:
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    return f"{seconds // 3600}h{(seconds % 3600) // 60}m"


def watching(user: str) -> list[dict]:
    """Tickets whose watcher is `user`: non-terminal, with heartbeat age and the STALLED verdict."""
    now_s = now()
    found = rows(
        "SELECT tkt_uuid, title, agent_state, assigned_to, workspace_repo, heartbeat_at, lease_until, "
        "CAST(strftime('%s', tkt_mtime) AS INTEGER) AS mtime_epoch FROM ticket "
        "WHERE watcher = ? AND agent_state IN ('READY','WORKING','BLOCKED') ORDER BY tkt_ctime DESC",
        (user,),
    )
    out: list[dict] = []
    for entry in found:
        state = str(entry["agent_state"] or "").upper()
        hb = num(entry["heartbeat_at"])
        lease = num(entry["lease_until"])
        age = now_s - hb if hb else None
        stalled, reason = False, None
        if state == "WORKING":
            if lease and lease < now_s:
                stalled, reason = True, "lease"
            elif not lease and age is not None and age > LEASE_S:
                stalled, reason = True, "heartbeat"
        elif state == "READY":
            mtime = num(entry["mtime_epoch"])
            if mtime and now_s - mtime > STALL_READY_S:
                stalled, reason = True, "ready>1h"
        out.append({
            "id": str(entry["tkt_uuid"]),
            "title": str(entry["title"] or ""),
            "state": state,
            "workspace_repo": str(entry["workspace_repo"] or ""),
            "assignee": str(entry["assigned_to"] or ""),
            "heartbeat_at": hb or None,
            "heartbeat_age_s": age,
            "lease_until": lease or None,
            "stalled": stalled,
            "stalled_reason": reason,
        })
    return out


def cmd_delegate(a) -> int:
    user = need_user(a)
    if a.no_wake and a.session:
        sys.exit("org: --no-wake and --session are mutually exclusive — a wake target and \"never wake me\" cannot both hold")
    session = None if a.no_wake else need_session(a, "delegate")
    worktree = a.worktree or str(Path.cwd())
    cross = norm_path(worktree) != norm_path(Path.cwd())
    if a.watcher and not cross:
        sys.exit("org: --watcher applies only to a cross-worktree hand-off (--worktree outside the caller's worktree) — a same-worktree ticket carries no watcher")
    watcher = ""
    if cross:
        resident, created = ensure_resident(worktree)
        watcher = a.watcher or DEFAULT_WATCHER
        print(f"org: cross hand-off to {worktree}: resident {resident} ({'created' if created else 'present'}); "
              f"watcher {watcher}", file=sys.stderr)
    known = rows("SELECT 1 FROM user WHERE login = ?", (a.assignee,))
    if not known:
        sys.exit(f"org: no such user {a.assignee!r} — create it first (fossil user new {a.assignee} robot <secret> -R <org>)")
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
        *(["wake_session", session, "wake_worktree", worktree] if session else []),
        *(["watcher", watcher] if watcher else []),
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

    if cross:
        live, detail = worktree_host_live(worktree)
        if live:
            print(f"org: {worktree} has a live host ({detail}) — run `org.py inbox` there to register the resident; no launch needed",
                  file=sys.stderr)
        else:
            exe = Path(worktree) / "bin" / "opencode.exe"
            if exe.exists():
                print(f"org: no live host in {worktree} ({detail}) — start its resident: {launch_command(worktree, exe)}",
                      file=sys.stderr)
            else:
                print(f"org: no live host in {worktree} ({detail}) and no {exe} — cannot start its resident; "
                      f"ticket {new[:10]} stays READY", file=sys.stderr)
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
    if state in ("DONE", "BLOCKED", "VERIFIED", "CANCELLED"):
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
    t = ticket(a.ticket)
    user = guard_lease(a, t, "heartbeat")
    now_s = now()
    ticket_set(t, user, heartbeat_at=str(now_s), lease_until=str(now_s + a.lease), woken_state=CLEARED)
    chat(f"HEARTBEAT {user} {short(t)} {a.what or 'working'}")
    print(f"org: heartbeat {short(t)} lease {a.lease}s")
    return 0


def cmd_report(a) -> int:
    t = ticket(a.ticket)
    user = guard_lease(a, t, "report")
    name = create_technote(t, user, a.title, a.file, a.text)
    # re-checked at the write: the technote creation is slow enough for a takeover to slip in
    guard_lease(a, ticket(a.ticket), "report")
    ticket_set(t, user, report_ref=name)
    print(name)
    return 0


def cmd_done(a) -> int:
    t = ticket(a.ticket)
    user = guard_lease(a, t, "done")
    ticket_set(t, user, agent_state="DONE", woken_state=CLEARED, **({"result_ref": a.report} if a.report else {}))
    print(f"org: {short(t)} DONE" + (f" report={a.report}" if a.report else ""))
    return 0


def cmd_escalate(a) -> int:
    t = ticket(a.ticket)
    user = guard_lease(a, t, "escalate")
    ticket_set(t, user, agent_state="BLOCKED", failure_code=a.code, woken_state=CLEARED)
    print(f"org: {short(t)} BLOCKED: {a.code}")
    return 0


def cmd_verify(a) -> int:
    """The delegator accepts a DONE ticket: the queue's terminal success."""
    user = need_user(a)
    t = ticket(a.ticket)
    guard_delegator(t, user, "verify")
    if str(t["agent_state"] or "").upper() != "DONE":
        sys.exit(f"org: {short(t)} is {str(t['agent_state'] or '').upper()} — verify requires a DONE ticket")
    ticket_set(t, user, agent_state="VERIFIED", woken_state=CLEARED)
    print(f"org: {short(t)} VERIFIED")
    return 0


def cmd_reject(a) -> int:
    """The delegator sends a DONE ticket back to READY with the findings as a technote (rework)."""
    user = need_user(a)
    t = ticket(a.ticket)
    guard_delegator(t, user, "reject")
    if str(t["agent_state"] or "").upper() != "DONE":
        sys.exit(f"org: {short(t)} is {str(t['agent_state'] or '').upper()} — reject requires a DONE ticket")
    name = create_technote(t, user, a.title, a.file, a.text, label="reject findings")
    ticket_set(t, user, agent_state="READY", woken_state=CLEARED,
               attempt=str(num(t["attempt"]) + 1), knowledge_ref=name)
    print(f"org: {short(t)} REJECTED -> READY (findings {name})")
    return 0


def cmd_cancel(a) -> int:
    """The delegator abandons the ticket (READY/WORKING/BLOCKED/DONE -> CANCELLED)."""
    user = need_user(a)
    t = ticket(a.ticket)
    guard_delegator(t, user, "cancel")
    if str(t["agent_state"] or "").upper() in CLOSED:
        sys.exit(f"org: {short(t)} is {str(t['agent_state'] or '').upper()} — nothing to cancel")
    ticket_set(t, user, agent_state="CANCELLED", failure_code=a.code, woken_state=CLEARED)
    print(f"org: {short(t)} CANCELLED: {a.code}")
    return 0


def cmd_inbox(a) -> int:
    user = need_user(a)
    mine = rows(
        "SELECT tkt_uuid, title, agent_state, lease_owner, lease_until, parent_task FROM ticket "
        "WHERE assigned_to = ? AND agent_state IN ('READY','WORKING','BLOCKED') ORDER BY tkt_ctime DESC",
        (user,),
    )
    watch = watching(user)
    machine = a.json
    if machine:
        print(json.dumps({
            "user": user,
            "tickets": [
                {
                    "id": str(row["tkt_uuid"]),
                    "title": str(row["title"] or ""),
                    "state": str(row["agent_state"] or ""),
                    "lease_owner": str(row["lease_owner"] or ""),
                    "lease_until": num(row["lease_until"]),
                    "parent_task": str(row["parent_task"] or ""),
                }
                for row in mine
            ],
            "watching": watch,
        }))
    else:
        if not mine:
            print(f"org: inbox empty for {user}")
        for row in mine:
            lease = f" lease={row['lease_owner']}" if row["lease_owner"] else ""
            print(f"{str(row['tkt_uuid'])[:10]}  {str(row['agent_state']):<8}{lease}  {row['title']}")
        if not watch:
            print(f"watching for {user}: none")
        else:
            print(f"watching for {user}:")
            for w in watch:
                flag = f" STALLED({w['stalled_reason']})" if w["stalled"] else ""
                age = "-" if w["heartbeat_age_s"] is None else age_text(w["heartbeat_age_s"])
                print(f"  {w['id'][:10]}  {w['state']:<8}{flag}  repo={w['workspace_repo']}  "
                      f"assignee={w['assignee']}  hb={age}")
    if a.no_presence:
        return 0
    session = resolve_session(a, "inbox")
    if session:
        if chat(f"PRESENCE {user} {session} {Path.cwd()}"):
            note = f"org: presence {user} at {session} ({Path.cwd()}) — the organization will wake this session"
            print(note, file=sys.stderr if machine else sys.stdout)
    else:
        print("org: presence skipped — calling session unknown (pass --session ses_… to register)", file=sys.stderr)
    return 0


def cmd_chat(a) -> int:
    try:
        lines = rows("SELECT msgid, datetime(mtime) AS at, xfrom, xmsg FROM chat WHERE msgid > ? ORDER BY msgid",
                     (a.since,))
    except sqlite3.OperationalError as error:  # born-empty org: the chat table appears with the first send (chat.c:328)
        if "no such table" not in str(error):
            raise
        lines = []
    for row in lines:
        print(f"{row['msgid']} {row['at']} {row['xfrom'] or '-'} {row['xmsg']}")
    return 0


def cmd_wiki(a) -> int:
    # `fossil wiki export PAGE` with no FILE writes the page to stdout; a FILE argument would be a
    # caller-named write (arbitrary file creation, measured 2026-10-08) — never pass one.
    out = subprocess.run([find_fossil(), "wiki", "export", a.page, "-R", str(ORG)],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode != 0:
        sys.exit(f"org: no wiki page {a.page!r} — {(out.stderr or out.stdout).strip()}")
    sys.stdout.write(out.stdout)
    return 0


def wiki_lock_path(page: str) -> Path:
    """The exclusive per-page lock file, following the org's lock convention ($ORG_HOME/locks)."""
    return LOCKS / f"wiki-{hashlib.sha256(page.encode('utf-8')).hexdigest()[:16]}.lock"


def _wiki_canon(raw: bytes) -> bytes:
    """Canonical wiki content: strict UTF-8, LF endings, one trailing newline.

    fossil's wiki CLI stores a page as text lines, and its Windows export re-emits CRLF and
    guarantees the trailing newline (measured 2026-10-10); pinning one canonical form on both
    sides keeps a file's digest and a read-back's digest directly comparable."""
    text = raw.decode("utf-8")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if text and not text.endswith("\n"):
        text += "\n"
    return text.encode("utf-8")


def _fossil_bytes(*args: str, user: str | None = None, data: bytes | None = None):
    """`fossil()` for byte-exact wiki content: same command shape (-R ORG, optional -U user),
    but no text codec — the text path's errors="replace" would silently corrupt a page body."""
    cmd = [find_fossil(), *args, "-R", str(ORG)]
    if user:
        cmd += ["-U", user]
    return subprocess.run(cmd, input=data, capture_output=True)


def _wiki_address(page: str) -> str | None:
    """The artifact hash of the newest wiki event naming `page` (timeline -t w), when listed."""
    out = _fossil_bytes("timeline", "-n", "20", "-t", "w")
    if out.returncode != 0:
        return None
    for line in out.stdout.decode("utf-8", "replace").splitlines():
        if f'wiki page "{page}"' in line:
            match = re.search(r"\[([0-9a-f]{6,40})\]", line)
            return match.group(1) if match else None
    return None


def _wiki_put_locked(page: str, content: bytes, expect: str, user: str, caps: str) -> int:
    listing = _fossil_bytes("wiki", "list")
    if listing.returncode != 0:
        sys.exit(f"org: wiki-put: fossil wiki list failed: {(listing.stderr or listing.stdout).decode('utf-8', 'replace').strip()}")
    exists = page in listing.stdout.decode("utf-8", "replace").splitlines()
    if expect == "absent" and exists:
        sys.exit(f"org: wiki-put: {page!r} already exists — pass its current sha256, not 'absent'")
    if expect != "absent" and not exists:
        sys.exit(f"org: wiki-put: {page!r} does not exist — pass 'absent' to create it")
    if exists and not set(caps) & set("kas"):
        sys.exit(f"org: wiki-put: login {user!r} lacks the wiki write capability ('k'; 'a'/'s' imply it)")
    if not exists and not set(caps) & set("fas"):
        sys.exit(f"org: wiki-put: login {user!r} lacks the wiki create capability ('f'; 'a'/'s' imply it)")
    digest = hashlib.sha256(content).hexdigest()
    if exists:
        # the same read as cmd_wiki (`wiki export`), byte-pinned so the digest sees stored bytes
        current = _fossil_bytes("wiki", "export", page)
        if current.returncode != 0:
            sys.exit(f"org: wiki-put: fossil wiki export failed: {(current.stderr or current.stdout).decode('utf-8', 'replace').strip()}")
        try:
            current_digest = hashlib.sha256(_wiki_canon(current.stdout)).hexdigest()
        except UnicodeDecodeError as error:
            sys.exit(f"org: wiki-put: the stored {page!r} is not valid UTF-8: {error}")
        if expect != current_digest:
            sys.exit(f"org: wiki-put: stale --expect-sha256 for {page!r}: expected {expect}, current {current_digest}")
        if current_digest == digest:
            print(f"wiki-put: {page}: unchanged sha256={digest} bytes={len(content)}")
            return 0
        action, verb = "commit", "updated"
    else:
        action, verb = "create", "created"
    written = _fossil_bytes("wiki", action, page, user=user, data=content)
    if written.returncode != 0:
        sys.exit(f"org: wiki-put: fossil wiki {action} failed: {(written.stderr or written.stdout).decode('utf-8', 'replace').strip()}")
    back = _fossil_bytes("wiki", "export", page)
    if back.returncode != 0:
        sys.exit(f"org: wiki-put: read-back of {page!r} failed: {(back.stderr or back.stdout).decode('utf-8', 'replace').strip()}")
    try:
        back_digest = hashlib.sha256(_wiki_canon(back.stdout)).hexdigest()
    except UnicodeDecodeError as error:
        sys.exit(f"org: wiki-put: read-back of {page!r} is not valid UTF-8: {error}")
    if back_digest != digest:
        sys.exit(f"org: wiki-put: readback mismatch for {page!r}: wrote sha256={digest}, read sha256={back_digest}")
    address = _wiki_address(page)
    print(f"wiki-put: {page}: {verb} sha256={digest} bytes={len(content)}" + (f" address={address}" if address else ""))
    return 0


def cmd_wiki_put(a) -> int:
    page = a.page
    if not page:
        sys.exit("org: wiki-put: page name is empty")
    if page.startswith("-"):
        sys.exit("org: wiki-put: page name must not look like an option")
    if any(ord(ch) < 32 or 0x7F <= ord(ch) <= 0x9F for ch in page):
        sys.exit("org: wiki-put: page name contains control characters")
    if page.lower() == "protocol":
        sys.exit("org: wiki-put: the Protocol page is protected — init.py publishes it, not this verb")
    if a.expect_sha256 != "absent" and not re.fullmatch(r"[0-9a-f]{64}", a.expect_sha256 or ""):
        sys.exit("org: wiki-put: --expect-sha256 must be 'absent' or a lowercase 64-char hex digest")
    try:
        raw = Path(a.file).read_bytes()
    except OSError as error:
        sys.exit(f"org: wiki-put: cannot read {a.file}: {error}")
    try:
        content = _wiki_canon(raw)
    except UnicodeDecodeError as error:
        sys.exit(f"org: wiki-put: {a.file} is not valid UTF-8: {error}")
    user = need_user(a)
    found = rows("SELECT cap FROM user WHERE login = ?", (user,))
    if not found:
        sys.exit(f"org: wiki-put: no such user {user!r} — create it first (fossil user new {user} robot <secret> -R <org>)")
    caps = str(found[0]["cap"] or "")
    lock = wiki_lock_path(page)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        sys.exit(f"org: wiki-put: {page!r} is locked by another writer ({lock}) — retry after it finishes")
    try:
        os.write(handle, f"{os.getpid()} {now()}\n".encode("ascii"))
        os.close(handle)
        return _wiki_put_locked(page, content, a.expect_sha256, user, caps)
    finally:
        try:
            lock.unlink()
        except OSError as error:
            print(f"org: wiki-put: could not remove the lock {lock}: {error}", file=sys.stderr)


# ---- forum ---------------------------------------------------------------------------------

def checkout_marker() -> Path:
    """The marker `fossil open` writes: _FOSSIL_ on Windows, .fslckout elsewhere."""
    return CHECKOUT / ("_FOSSIL_" if os.name == "nt" else ".fslckout")


def fossil_in_checkout(*args: str, user: str | None = None, data: bytes | None = None):
    """A fossil call inside the org's check-out — test-content-put refuses a bare -R repository."""
    cmd = [find_fossil(), *args]
    if user:
        cmd += ["-U", user]
    return subprocess.run(cmd, cwd=str(CHECKOUT), input=data, capture_output=True)


def _fossilize(value: str) -> str:
    """The manifest card encoding (src/encode.c fossilize): backslash and whitespace escaped."""
    out: list[str] = []
    for ch in value:
        if ch == "\\":
            out.append("\\\\")
        elif ch == " ":
            out.append("\\s")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\t":
            out.append("\\t")
        elif ch == "\r":
            out.append("\\r")
        else:
            out.append(ch)
    return "".join(out)


def _forum_date() -> str:
    """The D card value: fossil's standard format — UTC, millisecond precision (strftime('%Y-%m-%dT%H:%M:%f'))."""
    moment = datetime.now(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}"


def _forum_artifact(body: bytes, user: str, title: str | None, root_uuid: str | None, parent_uuid: str | None) -> bytes:
    """The forum manifest, as src/forum.c builds it: D [G] [H] [I] N U W Z, Z = md5 of everything before."""
    parts = [f"D {_forum_date()}\n".encode("ascii")]
    if root_uuid:
        parts.append(f"G {root_uuid}\n".encode("ascii"))
    if title is not None:
        parts.append(f"H {_fossilize(title)}\n".encode("utf-8"))
    if parent_uuid:
        parts.append(f"I {parent_uuid}\n".encode("ascii"))
    parts.append(b"N text/x-markdown\n")
    parts.append(f"U {_fossilize(user)}\n".encode("utf-8"))
    parts.append(f"W {len(body)}\n".encode("ascii") + body + b"\n")
    head = b"".join(parts)
    return head + b"Z " + hashlib.md5(head).hexdigest().encode("ascii") + b"\n"


def _forum_body(artifact: bytes) -> str:
    """The W-card payload of a forum manifest: the body exactly as stored (cards before W are single-line)."""
    pos = 0
    while True:
        end = artifact.find(b"\n", pos)
        if end < 0:
            sys.exit("org: forum: malformed artifact: no W card")
        line = artifact[pos:end]
        pos = end + 1
        if line.startswith(b"W "):
            try:
                size = int(line[2:])
            except ValueError:
                sys.exit("org: forum: malformed W card")
            return artifact[pos:pos + size].decode("utf-8", "replace")


def _forum_title(comment: str) -> str:
    """The thread title from the event comment test-crosslink writes ('Post: T' / 'Edit: T', manifest.c)."""
    for prefix in ("Post: ", "Edit: "):
        if comment.startswith(prefix):
            return comment[len(prefix):]
    return comment


def _forum_rows(query: str, params: tuple = ()) -> list[sqlite3.Row]:
    """rows() over the forum tables: an org that never posted has no forumpost table (born-empty)."""
    try:
        return rows(query, params)
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return []


def cmd_forum(a) -> int:
    if a.thread:
        targets = _forum_rows(
            "SELECT f.fpid, f.froot FROM forumpost f JOIN blob b ON b.rid = f.fpid WHERE b.uuid LIKE ? || '%'",
            (a.thread,),
        )
        if not targets:
            sys.exit(f"org: no forum post {a.thread!r}")
        if len(targets) > 1:
            sys.exit(f"org: {a.thread!r} matches {len(targets)} posts — give more characters")
        root = int(targets[0]["froot"])
        posts = _forum_rows(
            "SELECT f.fpid, f.firt, datetime(f.fmtime) AS at, b.uuid,"
            "  (SELECT user FROM event WHERE objid = f.fpid AND type = 'f') AS user,"
            "  (SELECT comment FROM event WHERE objid = f.fpid AND type = 'f') AS comment"
            " FROM forumpost f JOIN blob b ON b.rid = f.fpid WHERE f.froot = ? ORDER BY f.fmtime, f.fpid",
            (root,),
        )
        names = {int(post["fpid"]): str(post["uuid"]) for post in posts}
        title = _forum_title(str(posts[0]["comment"] or "")) if posts else ""
        print(f'thread {names.get(root, "")[:10]}  "{title}"  ({len(posts)} post(s))')
        for post in posts:
            parent = f" -> {names.get(int(post['firt']), str(post['firt']))[:10]}" if post["firt"] else ""
            print(f"[{str(post['uuid'])[:10]}] {post['at']} {post['user'] or '-'}{parent}")
            stored = _fossil_bytes("artifact", str(post["uuid"]))
            if stored.returncode != 0:
                sys.exit(f"org: forum: cannot read artifact {str(post['uuid'])[:10]}:"
                         f" {(stored.stderr or stored.stdout).decode('utf-8', 'replace').strip()}")
            body = _forum_body(stored.stdout)
            sys.stdout.write(body)
            if not body.endswith("\n"):
                print()
        return 0
    found = _forum_rows(
        "SELECT f.froot AS root, count(*) AS n, datetime(max(f.fmtime)) AS at,"
        "  (SELECT uuid FROM blob WHERE rid = f.froot) AS uuid,"
        "  (SELECT comment FROM event WHERE objid = f.froot AND type = 'f') AS comment"
        " FROM forumpost f GROUP BY f.froot ORDER BY max(f.fmtime) DESC",
    )
    if not found:
        print("org: forum empty")
        return 0
    for entry in found:
        print(f"{str(entry['uuid'])[:10]}  {entry['n']:>3}  {entry['at']}  {_forum_title(str(entry['comment'] or ''))}")
    return 0


def cmd_forum_post(a) -> int:
    user = need_user(a)
    if (a.title is None) == (a.reply is None):
        sys.exit("org: forum-post: exactly one of --title (new thread) or --reply ID (reply) is required")
    known = rows("SELECT cap FROM user WHERE login = ?", (user,))
    if not known:
        sys.exit(f"org: forum-post: no such user {user!r} — create it first (fossil user new {user} robot <secret> -R <org>)")
    caps = str(known[0]["cap"] or "")
    if not set(caps) & FORUM_WRITE_CAPS:
        sys.exit(f"org: forum-post: login {user!r} lacks the forum write capability ('3'/'4'; 'a'/'s' imply them)")

    if a.file:
        try:
            raw = Path(a.file).read_bytes()
        except OSError as error:
            sys.exit(f"org: forum-post: cannot read {a.file!r}: {error}")
        source = a.file
    else:
        raw = sys.stdin.buffer.read()
        source = "stdin"
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        sys.exit(f"org: forum-post: {source} is not valid UTF-8: {error}")
    body = text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
    if not body.strip():
        sys.exit("org: forum-post: the body is empty — nothing to post")

    title: str | None = None
    root_uuid: str | None = None
    parent_uuid: str | None = None
    root_rid: int | None = None
    parent_rid: int | None = None
    if a.title is not None:
        kind = "thread"
        title = a.title
        if not title.strip():
            sys.exit("org: forum-post: --title is empty")
        if len(title) > FORUM_TITLE_MAX:
            sys.exit(f"org: forum-post: --title is longer than {FORUM_TITLE_MAX} characters (the forum editor's cap)")
        if any(ord(ch) < 32 for ch in title):
            sys.exit("org: forum-post: --title contains control characters")
    else:
        kind = "reply"
        parent = _forum_rows(
            "SELECT f.fpid, f.froot, b.uuid FROM forumpost f JOIN blob b ON b.rid = f.fpid"
            " WHERE b.uuid LIKE ? || '%'",
            (a.reply,),
        )
        if not parent:
            sys.exit(f"org: forum-post: no forum post {a.reply!r}")
        if len(parent) > 1:
            sys.exit(f"org: forum-post: {a.reply!r} matches {len(parent)} posts — give more characters")
        parent_rid = int(parent[0]["fpid"])
        parent_uuid = str(parent[0]["uuid"])
        root_rid = int(parent[0]["froot"])
        root = rows("SELECT uuid FROM blob WHERE rid = ?", (root_rid,))
        if not root:
            sys.exit(f"org: forum-post: cannot resolve the thread root of {a.reply!r}")
        root_uuid = str(root[0]["uuid"])

    if not checkout_marker().exists():
        sys.exit(f"org: forum-post: no check-out at {CHECKOUT} — run python {HOME / 'genesis' / 'init.py'} once (it creates it)")

    artifact = _forum_artifact(body, user, title, root_uuid, parent_uuid)
    handle = tempfile.NamedTemporaryFile("wb", suffix=".art", delete=False)
    try:
        handle.write(artifact)
        handle.close()
        written = fossil_in_checkout("test-content-put", handle.name, user=user)
        if written.returncode != 0:
            sys.exit(f"org: forum-post: fossil test-content-put failed:"
                     f" {(written.stderr or written.stdout).decode('utf-8', 'replace').strip()}")
        found = re.search(rb"inserted as record (\d+)", written.stdout)
        if not found:
            sys.exit(f"org: forum-post: cannot read the record id from test-content-put:"
                     f" {written.stdout.decode('utf-8', 'replace').strip()!r}")
        rid = int(found.group(1))
        # the ORG's own blob table must know this record: a check-out pointing elsewhere stops here
        stored = rows("SELECT uuid FROM blob WHERE rid = ?", (rid,))
        if not stored:
            sys.exit(f"org: forum-post: record {rid} is not in {ORG} — the check-out does not point at the org")
        address = str(stored[0]["uuid"])
        if address not in (hashlib.sha3_256(artifact).hexdigest(), hashlib.sha1(artifact).hexdigest()):
            sys.exit(f"org: forum-post: {ORG} stored unexpected content at record {rid} — refusing to crosslink")
        crossed = fossil_in_checkout("test-crosslink", address)
        if crossed.returncode != 0:
            sys.exit(f"org: forum-post: fossil test-crosslink failed:"
                     f" {(crossed.stderr or crossed.stdout).decode('utf-8', 'replace').strip()}")
        # READ BACK — never the writer's own return: stored bytes, the forumpost row, fossil's thread view
        back = _fossil_bytes("artifact", address)
        if back.returncode != 0 or back.stdout != artifact:
            sys.exit(f"org: forum-post: read-back mismatch for {address[:10]} — the stored artifact differs from the intended bytes")
        post = rows("SELECT froot, firt FROM forumpost WHERE fpid = ?", (rid,))
        expect_root = rid if root_rid is None else root_rid
        if not post:
            sys.exit(f"org: forum-post: {address[:10]} is not in the forumpost table after test-crosslink")
        if int(post[0]["froot"]) != expect_root:
            sys.exit(f"org: forum-post: {address[:10]} landed in froot {post[0]['froot']}, expected {expect_root}")
        if root_rid is None and post[0]["firt"] is not None:
            sys.exit(f"org: forum-post: a thread root must not carry firt ({post[0]['firt']})")
        if parent_rid is not None and int(post[0]["firt"] or 0) != parent_rid:
            sys.exit(f"org: forum-post: {address[:10]} replies to {post[0]['firt']}, expected {parent_rid}")
        view = fossil_in_checkout("test-forumthread", address)
        count = re.search(rb"^count = (\d+)$", view.stdout, re.M)
        if view.returncode != 0 or address[:8].encode("ascii") not in view.stdout or not count:
            sys.exit(f"org: forum-post: test-forumthread does not show {address[:10]}:"
                     f" {(view.stderr or view.stdout).decode('utf-8', 'replace').strip()}")
        print(f"forum-post: {address[:10]}: {kind} address={address} bytes={len(artifact)} user={user}"
              f" readback ok: artifact, forumpost, test-forumthread (posts={count.group(1).decode('ascii')})")
        return 0
    finally:
        try:
            Path(handle.name).unlink()
        except OSError as error:
            print(f"org: forum-post: could not remove {handle.name}: {error}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(prog="org.py", description="the organization's verbs over $ORG_HOME/org.fossil (default $HOME/.org)")
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
    p.add_argument("--watcher", help=f"orchestrator login watching a cross-worktree hand-off (default: {DEFAULT_WATCHER})")
    p.add_argument("--no-wake", action="store_true",
                   help="you cannot be woken (inbox-polled): record NO wake target; orgd never wakes you")
    p.set_defaults(func=cmd_delegate)

    p = sub.add_parser("claim", parents=[common], help="claim/lease a ticket (arbitrated by an epoch lock)")
    p.add_argument("ticket")
    p.add_argument("--lease", type=int, default=LEASE_S, help=f"lease seconds (default {LEASE_S})")
    p.set_defaults(func=cmd_claim)

    p = sub.add_parser("heartbeat", parents=[common], help="extend the lease; a stale lease wakes the delegator")
    p.add_argument("ticket")
    p.add_argument("--epoch", type=int, required=True, help="the epoch your claim won (a stale epoch is refused)")
    p.add_argument("--what", help="what you are doing (goes into the chat line)")
    p.add_argument("--lease", type=int, default=LEASE_S, help=f"lease seconds (default {LEASE_S})")
    p.set_defaults(func=cmd_heartbeat)

    p = sub.add_parser("report", parents=[common], help="create a technote and pin it to the ticket")
    p.add_argument("ticket")
    p.add_argument("--epoch", type=int, required=True, help="the epoch your claim won (a stale epoch is refused)")
    p.add_argument("--title", required=True, help="technote name")
    p.add_argument("--file", help="markdown file to attach")
    p.add_argument("--text", help="inline markdown")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("done", parents=[common], help="close the ticket DONE (wakes your delegator)")
    p.add_argument("ticket")
    p.add_argument("--epoch", type=int, required=True, help="the epoch your claim won (a stale epoch is refused)")
    p.add_argument("--report", help="technote name of the result")
    p.set_defaults(func=cmd_done)

    p = sub.add_parser("escalate", parents=[common], help="mark BLOCKED with a failure code (wakes your delegator)")
    p.add_argument("ticket")
    p.add_argument("--epoch", type=int, required=True, help="the epoch your claim won (a stale epoch is refused)")
    p.add_argument("--code", required=True, help="why it is blocked")
    p.set_defaults(func=cmd_escalate)


    p = sub.add_parser("verify", parents=[common], help="delegator: accept a DONE ticket (VERIFIED)")
    p.add_argument("ticket")
    p.set_defaults(func=cmd_verify)

    p = sub.add_parser("reject", parents=[common], help="delegator: send a DONE ticket back to READY with findings")
    p.add_argument("ticket")
    p.add_argument("--title", required=True, help="findings technote name")
    p.add_argument("--file", help="markdown file with the findings")
    p.add_argument("--text", help="inline findings markdown")
    p.set_defaults(func=cmd_reject)

    p = sub.add_parser("cancel", parents=[common], help="delegator: abandon a ticket (CANCELLED)")
    p.add_argument("ticket")
    p.add_argument("--code", required=True, help="why it is cancelled")
    p.set_defaults(func=cmd_cancel)

    p = sub.add_parser("inbox", parents=[common], help="list your tickets and register this session for wakes")
    p.add_argument("--json", action="store_true", help="machine-readable: one JSON document on stdout")
    p.add_argument("--no-presence", action="store_true",
                   help="read-only poll: post no PRESENCE line and resolve no session")
    p.set_defaults(func=cmd_inbox)

    p = sub.add_parser("chat", help="read the chat table since a msgid (a cursor poll)")
    p.add_argument("--since", type=int, default=0, help="highest msgid already seen (default 0: all)")
    p.set_defaults(func=cmd_chat)

    p = sub.add_parser("wiki", help="print a wiki page to stdout (no file is written)")
    p.add_argument("page")
    p.set_defaults(func=cmd_wiki)

    p = sub.add_parser("protocol", help="print the Protocol wiki page (== wiki Protocol)")
    p.set_defaults(func=cmd_wiki, page="Protocol")

    p = sub.add_parser("wiki-put", parents=[common], help="create/update a wiki page under an expected sha256 and a per-page lock")
    p.add_argument("page", help="wiki page name (Protocol is refused — init.py publishes that page)")
    p.add_argument("--file", required=True, help="UTF-8 file with the new page body (read only; no output path)")
    p.add_argument("--expect-sha256", required=True, dest="expect_sha256", help="the page's current sha256, or 'absent' to create it")
    p.set_defaults(func=cmd_wiki_put)

    p = sub.add_parser("forum", help="list forum threads, or print one thread to stdout")
    p.add_argument("thread", nargs="?", help="any post id (hash prefix) of the thread")
    p.set_defaults(func=cmd_forum)

    p = sub.add_parser("forum-post", parents=[common], help="post a forum thread or reply (the organization's forum)")
    p.add_argument("--title", help="title of a new thread (exactly one of --title / --reply)")
    p.add_argument("--reply", help="id (hash prefix) of the post being replied to")
    p.add_argument("--file", help="UTF-8 markdown body file (default: stdin)")
    p.set_defaults(func=cmd_forum_post)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
