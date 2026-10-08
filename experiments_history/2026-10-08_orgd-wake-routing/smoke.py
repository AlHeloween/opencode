"""Orgd wake-routing smoke suite S6-S8 — plans/2026-10-08_org-verbs-and-heartbeat.md (T6).

The defect under test (found 2026-10-08, reported from code review): `orgd.assignee_session`
fell back to the worktree's NEWEST session when the assignee had no PRESENCE there, so a
«new ticket in your inbox» wake could land in another robot's session or the owner's live
one. And `org.py delegate` demanded `--session`, so a delegator that cannot be woken (a
Claude session polling its inbox) had no way to say so.

Isolation — the live organization and every live host are untouched:
  - a SANDBOX org repo in %TEMP% (ORG_HOME): `fossil new` + ticket-schema.sql + robot
    users + a chat table mirroring the live org's shape (a fresh repo has none, measured);
  - a FIXTURE worktree in %TEMP% (outside any git repo, so opencode serves IT and not
    this checkout), served by its own `opencode serve` (dist/bin, provider env stripped)
    — a real wake target: live host record, sessions, message rows. Qualified first by
    probe_serve.py (host live 4.2 s; prompt_async leaves a user row with keys stripped).

Phases (assertions read the target session's message rows and the sandbox orgd.log —
never a verb's own print):
  S6 no PRESENCE      -> orgd sends NOTHING to the target session and logs the reason
                         ONCE across >2 ticks (RED on the current orgd: the newest
                         session receives the wake).
  S7 delegate --no-wake -> child DONE -> NO wake attempt, NO retry lines (RED on the
                         current org.py: the flag does not exist).
  S8 presence         -> the assignee's PRESENCE session still receives the wake
                         (regression guard for the S6 edit).

Run: python smoke.py            (writes runs/<stamp>_orgd-wake-routing-summary.json)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ORG_PY = REPO / "scripts" / "org-genesis" / "org.py"
ORGD = REPO / "scripts" / "org-genesis" / "orgd.py"
DEFAULT_EXE = REPO / "dist" / "bin" / "opencode.exe"
DELEGATOR = "smit-delegator"
ASSIGNEE = "smit-fixture"

ROOT = Path(tempfile.mkdtemp(prefix="orgd-wake-routing-"))
ORG_HOME = ROOT / "org-home"
ORG = ORG_HOME / "org.fossil"
PROJECT = ROOT / "project"

RESULTS: dict = {}
TARGET = ""  # fixture session id (the wake target)
SERVE = None  # fixture serve process

sys.path.insert(0, str(REPO / "tools"))
import opencode_host  # noqa: E402


def sha16(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def fossil(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    """Run fossil. `fossil sql` reports a SQL error on STDERR and exits 0 (measured
    2026-10-08: 'Error: in prepare, 2 values for 3 columns' with rc=0, nothing written) —
    so rc alone is not success, and an stderr error raises."""
    out = subprocess.run(["fossil", *args], capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    if check and (out.returncode != 0 or "Error:" in out.stderr):
        raise RuntimeError(f"fossil {args[0]} failed: {out.stderr.strip() or out.stdout.strip()}")
    return out


def env_org() -> dict:
    env = dict(os.environ)
    env["ORG_HOME"] = str(ORG_HOME)
    return env


def org(*args: str, user: str = DELEGATOR) -> tuple[int, str, str]:
    out = subprocess.run([sys.executable, str(ORG_PY), *args, "--user", user],
                         capture_output=True, text=True, encoding="utf-8", errors="replace",
                         env=env_org())
    return out.returncode, (out.stdout or "").strip(), (out.stderr or "").strip()


def read_rows(query: str, params: tuple = (), db: Path | None = None) -> list[sqlite3.Row]:
    con = sqlite3.connect("file:" + urllib.request.pathname2url(str(db or ORG)) + "?mode=ro",
                          uri=True, timeout=15)
    try:
        con.row_factory = sqlite3.Row
        return con.execute(query, params).fetchall()
    finally:
        con.close()


def ticket(uuid: str) -> sqlite3.Row:
    return read_rows("SELECT * FROM ticket WHERE tkt_uuid = ?", (uuid,))[0]


def fixture_counts(needle: str) -> tuple[int, int]:
    """(user message rows in the target session, message parts carrying `needle`)."""
    db = PROJECT / ".opencode" / "data" / "opencode.db"
    if not db.exists():
        return 0, 0
    con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=15)
    try:
        users = con.execute(
            "SELECT count(*) FROM message WHERE session_id = ? AND data LIKE '%\"role\":\"user\"%'",
            (TARGET,)).fetchone()[0]
        hits = con.execute(
            "SELECT count(*) FROM part WHERE session_id = ? AND data LIKE ?",
            (TARGET, f"%{needle}%")).fetchone()[0]
        return users, hits
    finally:
        con.close()


def read_log() -> list[str]:
    log = ORG_HOME / "orgd.log"
    if not log.exists():
        return []
    return [line for line in log.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]


def build_org() -> None:
    ORG_HOME.mkdir(parents=True, exist_ok=True)
    PROJECT.mkdir(parents=True, exist_ok=True)
    fossil("new", str(ORG))  # its output carries the admin password: captured, never printed
    schema = (REPO / "scripts" / "org-genesis" / "ticket-schema.sql").read_text(encoding="utf-8").replace("'", "''")
    fossil("sql", "-R", str(ORG),
           f"INSERT OR REPLACE INTO config(name,value,mtime) VALUES('ticket-table','{schema}',now());")
    fossil("rebuild", str(ORG))
    for user in (DELEGATOR, ASSIGNEE):
        fossil("user", "new", user, "robot", "x" * 16, "-R", str(ORG))
    # orgd reads `SELECT xmsg FROM chat`; a fresh fossil repo has NO chat table (measured),
    # so mirror the live org's shape — the suite must exercise routing, not a missing table.
    fossil("sql", "-R", str(ORG),
           "CREATE TABLE chat(msgid INTEGER PRIMARY KEY AUTOINCREMENT, mtime JULIANDAY, "
           "lmtime TEXT, xfrom TEXT, xmsg TEXT, fname TEXT, fmime TEXT, mdel INT, file BLOB);")


def register_presence(user: str, session: str, worktree: str) -> None:
    fossil("sql", "-R", str(ORG),
           "INSERT INTO chat(mtime, lmtime, xfrom, xmsg) VALUES(now(), datetime('now'), "
           f"'{user}', 'PRESENCE {user} {session} {worktree}');")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_serve(exe: Path) -> "opencode_host.Host":
    global SERVE
    env = dict(os.environ)
    dropped = sorted(k for k in env if k.endswith(("_API_KEY", "_TOKEN", "_SECRET")))
    for k in dropped:
        env.pop(k, None)
    log = open(ROOT / "serve.log", "wb")
    SERVE = subprocess.Popen([str(exe), "serve", "--port", str(free_port())],
                             cwd=str(PROJECT), env=env, stdout=log, stderr=subprocess.STDOUT)
    deadline, last = time.time() + 60, None
    while time.time() < deadline:
        if SERVE.poll() is not None:
            tail = (ROOT / "serve.log").read_text(encoding="utf-8", errors="replace")[-600:]
            raise RuntimeError(f"fixture serve exited rc={SERVE.returncode}: {tail}")
        try:
            return opencode_host.connect(str(PROJECT))
        except Exception as error:
            last = error
        time.sleep(1)
    raise RuntimeError(f"fixture serve not live after 60 s: {last}")


def run_orgd(seconds: float, until=None, interval: int = 1) -> float:
    """Run the sandbox orgd daemon; stop early when `until()` turns true."""
    proc = subprocess.Popen([sys.executable, str(ORGD), "--interval", str(interval)],
                            env=env_org(), cwd=str(REPO),
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    started = time.time()
    try:
        while time.time() - started < seconds:
            time.sleep(min(2, interval))
            if until is not None and until():
                break
        return time.time() - started
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()


def setup(exe: Path) -> dict:
    global TARGET
    if not exe.exists():
        raise RuntimeError(f"serve binary missing: {exe} — build dist first (_build.ps1)")
    build_org()
    host = start_serve(exe)
    TARGET = host.post("/session", {"title": "orgd-wake-routing fixture target"})["id"]
    return {"org": str(ORG), "project": str(PROJECT), "session": TARGET, "host": repr(host)}


def s6() -> dict:
    """No PRESENCE -> nothing sent, reason logged once (>2 ticks)."""
    code, out, err = org("delegate", "--title", "S6 fixture - assignee has no PRESENCE",
                         "--assignee", ASSIGNEE, "--worktree", str(PROJECT),
                         "--session", "ses_s6_fixture_delegator")
    assert code == 0, f"delegate failed rc={code}: {err or out}"
    t = out.splitlines()[-1].strip()
    head = t[:10]
    before = fixture_counts(head)
    ticked = run_orgd(6)  # ~6 ticks at interval 1
    after = fixture_counts(head)
    lines = [line for line in read_log() if head in line]
    row = ticket(t)
    assert after[0] == before[0] and after[1] == 0, \
        f"a ticket with NO PRESENCE was sent somewhere: {before} -> {after}; log={lines}"
    assert len(lines) == 1 and "not woken" in lines[0] and "no PRESENCE" in lines[0], \
        f"expected exactly one reason line, got: {lines}"
    assert str(row["woken_state"] or "").upper() != "NEW", f"woken_state={row['woken_state']!r}"
    return {"ticket": head, "ticks_s": round(ticked, 1), "counts": {"before": list(before), "after": list(after)},
            "reason_line": lines[0]}


def s7() -> dict:
    """--no-wake delegation: child DONE -> no attempt, no retry lines."""
    code, out, err = org("delegate", "--title", "S7 fixture - inbox-polled delegator (--no-wake)",
                         "--assignee", ASSIGNEE, "--worktree", str(PROJECT), "--no-wake")
    assert code == 0, f"`delegate --no-wake` must work without --session: rc={code}: {err or out}"
    t = out.splitlines()[-1].strip()
    head = t[:10]
    row = ticket(t)
    assert not str(row["wake_session"] or "").strip(), f"wake_session recorded despite --no-wake: {row['wake_session']!r}"
    code, out, err = org("done", t, user=ASSIGNEE)
    assert code == 0, f"done failed: {err or out}"
    assert str(ticket(t)["agent_state"]).upper() == "DONE"
    ticked = run_orgd(6)
    lines = [line for line in read_log() if head in line]
    assert not lines, f"a --no-wake ticket was woken or retried: {lines}"
    assert fixture_counts(head)[1] == 0, "wake text landed in the fixture session"
    return {"ticket": head, "ticks_s": round(ticked, 1), "log_lines": lines}


def s8() -> dict:
    """Presence still wakes: the registered session receives the ticket (regression guard)."""
    code, out, err = org("delegate", "--title", "S8 fixture - presence wake must still land",
                         "--assignee", ASSIGNEE, "--worktree", str(PROJECT),
                         "--session", "ses_s8_fixture_delegator")
    assert code == 0, f"delegate failed rc={code}: {err or out}"
    t = out.splitlines()[-1].strip()
    head = t[:10]
    register_presence(ASSIGNEE, TARGET, str(PROJECT))
    before = fixture_counts(head)
    elapsed = run_orgd(30, until=lambda: fixture_counts(head)[1] > before[1])
    lines = [line for line in read_log() if head in line]
    assert fixture_counts(head)[1] > before[1], f"presence wake did not land; log={lines}"
    assert any("woke" in line for line in lines), f"no 'woke' line: {lines}"
    assert str(ticket(t)["woken_state"]).upper() == "NEW", f"woken_state={ticket(t)['woken_state']!r}"
    return {"ticket": head, "wake_s": round(elapsed, 1), "log_lines": lines}


def phase(name: str, fn) -> None:
    print(f"== {name} ==", flush=True)
    started = time.time()
    try:
        detail = fn() or {}
        detail["elapsed_s"] = round(time.time() - started, 1)
        RESULTS[name] = {"pass": True, **detail}
        print(f"{name} PASS {json.dumps(detail)}", flush=True)
    except Exception as error:
        RESULTS[name] = {"pass": False, "error": f"{type(error).__name__}: {error}",
                         "elapsed_s": round(time.time() - started, 1)}
        print(f"{name} FAIL {type(error).__name__}: {error}", flush=True)


def teardown() -> None:
    if SERVE is not None and SERVE.poll() is None:
        SERVE.terminate()
        try:
            SERVE.wait(10)
        except subprocess.TimeoutExpired:
            SERVE.kill()


def main() -> int:
    parser = argparse.ArgumentParser(prog="smoke.py")
    parser.add_argument("--serve-exe", default=str(DEFAULT_EXE))
    parser.add_argument("--which", default="all")
    args = parser.parse_args()

    print(f"sandbox: {ROOT}\norgd under test: {ORGD} sha={sha16(ORGD)}\norg.py under test: {ORG_PY} sha={sha16(ORG_PY)}",
          flush=True)
    try:
        phase("setup", lambda: setup(Path(args.serve_exe)))
        if not RESULTS.get("setup", {}).get("pass"):
            return 1
        for name, fn in (("s6", s6), ("s7", s7), ("s8", s8)):
            if args.which in ("all", name):
                phase(name, fn)
    finally:
        teardown()

    RESULTS["under_test"] = {"orgd_sha256_16": sha16(ORGD), "org_py_sha256_16": sha16(ORG_PY),
                             "sandbox": str(ROOT)}
    RESULTS["orgd_log"] = read_log()
    runs = Path(__file__).resolve().parent / "runs"
    runs.mkdir(exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    summary = runs / f"{stamp}_orgd-wake-routing-summary.json"
    summary.write_text(json.dumps(RESULTS, indent=2), encoding="utf-8")
    print(f"summary: {summary}", flush=True)
    print(json.dumps(RESULTS, indent=2), flush=True)
    return 0 if all(r.get("pass") for r in RESULTS.values() if isinstance(r, dict) and "pass" in r) else 1


if __name__ == "__main__":
    raise SystemExit(main())
