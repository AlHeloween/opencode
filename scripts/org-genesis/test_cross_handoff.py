"""test_cross_handoff.py — the focused oracle for the cross-worktree hand-off (plan 2026-10-13_cross-worktree-handoff).

A delegation that leaves its own worktree used to die silently: orgd wakes the assignee ONLY through that
worktree's live host PRESENCE, and the hourly orchestrator (which reads `inbox --user claude`) was told
nothing. The cases below pin the repair:

  S1 — `delegate --worktree W` (W outside the caller's worktree) ensures W's resident login `smit-<project>`
       (created exactly once; the random password never printed), records `watcher` = claude, and — with no
       live host in W and W/bin/opencode.exe present — prints the ONE launch command
       (`cmd_runner start --terminal wt --cwd W -- W\\bin\\opencode.exe --port N`). stdout stays exactly the
       new ticket uuid.
  S2 — a same-worktree delegate (omitted or explicit --worktree) carries NO watcher; `--watcher` there is
       refused, naming the cross-worktree scope.
  S3 — cross delegate to a worktree without bin/opencode.exe: it says so, prints no launch line, ticket READY.
  S4 — `inbox --user claude --json` lists the ticket under `watching` (state, workspace_repo, assignee,
       heartbeat fields); an unwatched ticket is absent from `watching`.
  S5 — a READY ticket backdated 2 h reports STALLED(ready>1h); a WORKING ticket with an expired lease
       reports STALLED(lease).

Runs against a REAL isolated Fossil repository (tempfile.mkdtemp; no service, no production ORG_HOME):
every org.py call is a subprocess, and assertions read the repository back, never the report alone.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GENESIS = REPO / "scripts" / "org-genesis"
ORG_PY = GENESIS / "org.py"

_CANDIDATES = [
    os.environ.get("FOSSIL"),
    str(REPO / "external" / "fossil" / "fossil.exe"),
    str(REPO / "tools" / "fossil.exe"),
]
FOSSIL = next(str(c) for c in _CANDIDATES if c and Path(c).exists())

FIXTURE = Path(tempfile.mkdtemp(prefix="org-cross-"))
os.environ["ORG_HOME"] = str(FIXTURE)
os.environ["ORG_PORT"] = "1"  # nothing listens: chat sends fail fast and never reach the live org
os.environ["FOSSIL"] = FOSSIL
os.environ["PYTHONUTF8"] = "1"
os.environ.pop("ORG_USER", None)
os.environ.pop("ORG_SESSION", None)
sys.path.insert(0, str(GENESIS))
import org  # noqa: E402 — imported AFTER ORG_HOME is pinned: its constants must bind to the fixture

assert org.ORG == FIXTURE / "org.fossil", "fixture must own ORG — refusing to run against a production org"

BOSS = "boss-x"          # the delegator of every ticket here
WATCHER = "claude"       # the orchestrator login the watching section is read with
RESIDENT = "smit-stand"  # the resident login `delegate` must ensure for the scratch worktree
STAND = FIXTURE / "stand"  # the OTHER worktree: no host record → the launch command must print
EXE = STAND / "bin" / "opencode.exe"
BARE = FIXTURE / "stand2"  # a worktree with no bin/opencode.exe at all


def _env() -> dict:
    env = dict(os.environ)
    env["ORG_HOME"] = str(FIXTURE)
    env["ORG_PORT"] = "1"
    env["FOSSIL"] = FOSSIL
    env["PYTHONUTF8"] = "1"
    env.pop("ORG_USER", None)
    env.pop("ORG_SESSION", None)
    return env


def run_cli(*args: str):
    return subprocess.run(
        [sys.executable, "-X", "utf8", str(ORG_PY), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(REPO), env=_env(),
    )


def fossil(*args: str, user: str | None = None, stdin: str | None = None):
    cmd = [FOSSIL, *args, "-R", str(FIXTURE / "org.fossil")]
    if user:
        cmd += ["-U", user]
    return subprocess.run(cmd, input=stdin, capture_output=True, text=True, encoding="utf-8", errors="replace")


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(
        "file:" + urllib.request.pathname2url(str(FIXTURE / "org.fossil")) + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def ticket_row(uuid: str):
    con = _db()
    try:
        return con.execute("SELECT * FROM ticket WHERE tkt_uuid = ?", (uuid,)).fetchone()
    finally:
        con.close()


def field(uuid: str, name: str) -> str:
    value = ticket_row(uuid)[name]
    return "" if value is None else str(value)


def user_count(login: str) -> int:
    con = _db()
    try:
        return con.execute("SELECT count(*) FROM user WHERE login = ?", (login,)).fetchone()[0]
    finally:
        con.close()


def cross_delegate(title: str, worktree: Path = STAND, assignee: str = RESIDENT):
    out = run_cli("delegate", "--title", title, "--assignee", assignee, "--worktree", str(worktree),
                  "--user", BOSS, "--no-wake")
    assert out.returncode == 0, (out.stdout, out.stderr)
    uuid = out.stdout.strip()
    assert "\n" not in uuid and len(uuid) >= 40, ("stdout must be exactly the ticket uuid", out.stdout)
    return out, uuid


def inbox_json(user: str) -> dict:
    out = run_cli("inbox", "--user", user, "--json", "--no-presence")
    assert out.returncode == 0, (out.stdout, out.stderr)
    return json.loads(out.stdout)


def watch_of(doc: dict, uuid: str) -> dict | None:
    for entry in doc.get("watching", []):
        if entry["id"] == uuid:
            return entry
    return None


def backdate_mtime(uuid: str, hours: int = 2) -> None:
    out = fossil("sql", f"UPDATE ticket SET tkt_mtime = datetime('now', '-{hours} hours') WHERE tkt_uuid = '{uuid}';")
    assert out.returncode == 0, out.stderr


def setUpModule() -> None:
    out = subprocess.run([FOSSIL, "init", str(FIXTURE / "org.fossil")], capture_output=True)
    assert out.returncode == 0, out.stderr
    schema = (GENESIS / "ticket-schema.sql").read_text(encoding="utf-8").replace("'", "''")
    out = subprocess.run([FOSSIL, "sql", "-R", str(FIXTURE / "org.fossil"),
                          f"INSERT OR REPLACE INTO config(name,value,mtime) VALUES('ticket-table','{schema}',now());"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert out.returncode == 0, out.stderr
    out = subprocess.run([FOSSIL, "rebuild", str(FIXTURE / "org.fossil")], capture_output=True)
    assert out.returncode == 0, out.stderr
    # `fossil sql` discards a failed statement's exit code (measured 2026-10-08, t11): read the artifact back
    out = subprocess.run([FOSSIL, "sql", "-R", str(FIXTURE / "org.fossil"),
                          "SELECT sql FROM sqlite_master WHERE name='ticket';"],
                         capture_output=True, text=True, encoding="utf-8", errors="replace")
    assert "agent_state" in out.stdout and "watcher" in out.stdout, ("fixture ticket schema did not land", out.stdout)
    out = fossil("user", "new", BOSS, stdin="s3cret\ns3cret\n")
    assert out.returncode == 0, (BOSS, out.stderr)
    out = fossil("user", "capabilities", BOSS, "kf")
    assert out.returncode == 0, (BOSS, out.stderr)
    (STAND / "bin").mkdir(parents=True, exist_ok=True)
    EXE.write_bytes(b"")  # stands in for the project's own opencode: only its presence is checked
    BARE.mkdir(parents=True, exist_ok=True)


def tearDownModule() -> None:
    shutil.rmtree(FIXTURE, ignore_errors=True)


class CrossHandoffTest(unittest.TestCase):
    maxDiff = None

    def test_s1_cross_delegate_ensures_the_resident_once_and_prints_the_launch_command(self):
        out, uuid = cross_delegate("s1 cross")
        self.assertEqual(field(uuid, "watcher"), WATCHER)
        self.assertEqual(field(uuid, "workspace_repo"), str(STAND))
        self.assertEqual(field(uuid, "assigned_to"), RESIDENT)
        self.assertIn(f"resident {RESIDENT} (created)", out.stderr)
        self.assertIn(f"watcher {WATCHER}", out.stderr)
        self.assertIn("cmd_runner start --terminal wt --cwd", out.stderr)
        self.assertIn("opencode.exe", out.stderr)
        self.assertIn("--port", out.stderr)
        self.assertEqual(user_count(RESIDENT), 1)
        self.assertNotIn("password", (out.stdout + out.stderr).lower())

        again, uuid2 = cross_delegate("s1 cross again")
        self.assertNotEqual(uuid2, uuid)
        self.assertIn(f"resident {RESIDENT} (present)", again.stderr)
        self.assertEqual(user_count(RESIDENT), 1, "the resident login is created exactly once")

    def test_s2_same_worktree_delegate_carries_no_watcher_and_refuses_the_override(self):
        omitted = run_cli("delegate", "--title", "s2 omitted worktree", "--assignee", BOSS,
                          "--user", BOSS, "--no-wake")
        self.assertEqual(omitted.returncode, 0, (omitted.stdout, omitted.stderr))
        self.assertEqual(field(omitted.stdout.strip(), "watcher"), "")

        explicit = run_cli("delegate", "--title", "s2 explicit own worktree", "--assignee", BOSS,
                           "--user", BOSS, "--no-wake", "--worktree", str(REPO))
        self.assertEqual(explicit.returncode, 0, (explicit.stdout, explicit.stderr))
        self.assertEqual(field(explicit.stdout.strip(), "watcher"), "")

        refused = run_cli("delegate", "--title", "s2 refused", "--assignee", BOSS,
                          "--user", BOSS, "--no-wake", "--worktree", str(REPO), "--watcher", WATCHER)
        self.assertNotEqual(refused.returncode, 0, "a same-worktree --watcher must be refused, never ignored")
        self.assertIn("cross-worktree", refused.stdout + refused.stderr)

    def test_s3_cross_without_bin_says_so_and_leaves_the_ticket_ready(self):
        out, uuid = cross_delegate("s3 no exe", worktree=BARE, assignee="smit-stand2")
        self.assertEqual(field(uuid, "agent_state"), "READY")
        self.assertIn(str(BARE / "bin" / "opencode.exe"), out.stderr)
        self.assertIn("stays READY", out.stderr)
        self.assertNotIn("cmd_runner start", out.stderr, "no exe → no launch command may be printed")
        self.assertEqual(user_count("smit-stand2"), 1)

    def test_s4_inbox_lists_watching_with_fields_and_hides_unwatched_tickets(self):
        out, uuid = cross_delegate("s4 watched")
        entry = watch_of(inbox_json(WATCHER), uuid)
        self.assertIsNotNone(entry, "the cross-hand-off ticket must be in the watcher's inbox")
        self.assertEqual(entry["state"], "READY")
        self.assertEqual(entry["workspace_repo"], str(STAND))
        self.assertEqual(entry["assignee"], RESIDENT)
        self.assertFalse(entry["stalled"], "a fresh READY ticket is not stalled")
        self.assertIsNone(entry["stalled_reason"])
        self.assertIsNone(entry["heartbeat_age_s"])

        text = run_cli("inbox", "--user", WATCHER, "--no-presence")
        self.assertEqual(text.returncode, 0, (text.stdout, text.stderr))
        self.assertIn(f"watching for {WATCHER}:", text.stdout)
        self.assertIn(uuid[:10], text.stdout)

        local = run_cli("delegate", "--title", "s4 unwatched", "--assignee", BOSS, "--user", BOSS, "--no-wake")
        self.assertEqual(local.returncode, 0, (local.stdout, local.stderr))
        self.assertIsNone(watch_of(inbox_json(WATCHER), local.stdout.strip()),
                          "a same-worktree ticket carries no watcher and must not appear")

    def test_s5_stalled_ready_by_age_and_stalled_working_by_lease(self):
        out, uuid = cross_delegate("s5 ready age")
        entry = watch_of(inbox_json(WATCHER), uuid)
        self.assertIsNotNone(entry)
        self.assertFalse(entry["stalled"])

        backdate_mtime(uuid, hours=2)
        entry = watch_of(inbox_json(WATCHER), uuid)
        self.assertTrue(entry["stalled"], "a READY ticket unclaimed past an hour must show STALLED")
        self.assertEqual(entry["stalled_reason"], "ready>1h")

        out2, uuid2 = cross_delegate("s5 lease expired")
        claim = run_cli("claim", uuid2, "--user", RESIDENT)
        self.assertEqual(claim.returncode, 0, (claim.stdout, claim.stderr))
        set_lease = fossil("ticket", "set", uuid2, "lease_until", str(int(time.time()) - 30), user=BOSS)
        self.assertEqual(set_lease.returncode, 0, set_lease.stderr)
        entry2 = watch_of(inbox_json(WATCHER), uuid2)
        self.assertIsNotNone(entry2)
        self.assertEqual(entry2["state"], "WORKING")
        self.assertTrue(entry2["stalled"], "a WORKING ticket past its lease must show STALLED")
        self.assertEqual(entry2["stalled_reason"], "lease")
        self.assertIsNotNone(entry2["heartbeat_age_s"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
