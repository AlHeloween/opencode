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
  S6 — a mixed-case worktree path derives the CANONICAL lowercase resident (`smit-stand-case`) and creates
       it exactly once: no second spelling of the same project's login may appear in the user table.
  S7 — a login that already exists in the OTHER case is REUSED (present, one row), never duplicated, and
       the ticket records the org's real spelling — not the caller's.
  S8 — every login match folds the case: inbox, claim and heartbeat answer the assignee spelled in any
        case, and the orgd wake finds the assignee's PRESENCE the same way.
  S9 — a cross delegate to a worktree WITH a live host DELIVERS the ticket into a NEW session there,
        pinned to the fleet's model (never the worktree's recent free default), and records wake_session.
  S10 — a READY ticket whose host appears LATER is delivered by orgd on its next tick, exactly once.
  S11 — a READY ticket with NO wake target shows STALLED(ready/no-wake) in the watcher's inbox after N minutes.

Runs against a REAL isolated Fossil repository (tempfile.mkdtemp; no service, no production ORG_HOME):
every org.py call is a subprocess, and assertions read the repository back, never the report alone.
"""
from __future__ import annotations

import json
import os
import http.server
import importlib.util
import threading
import re
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
MIXED = FIXTURE / "Stand-Case"     # a mixed-case path: ONE project, ONE login
CASE_RESIDENT = "smit-stand-case"  # the canonical lowercase resident it must derive
REUSE = FIXTURE / "Stand-Mix"      # a worktree whose resident already exists in the OTHER case
REUSE_LOGIN = "smit-Stand-Mix"     # created by hand: it must be reused, never duplicated
NOWAKE = FIXTURE / "nowake-stand"   # no host ever: the ticket has no wake target (S11)
RESIDENT_NOWAKE = "smit-nowake-stand"
LIVE = FIXTURE / "live-stand"  # a worktree WITH a live fake host: delegate delivers at once (S9)
RESIDENT_LIVE = "smit-live-stand"
LATE = FIXTURE / "late-stand"  # no host at delegate time; the host appears later: orgd delivers (S10)
RESIDENT_LATE = "smit-late-stand"
ORGD_PY = GENESIS / "orgd.py"
DISPATCH = REPO / "experiments" / "2026-10-08_robot-wave" / "dispatch.py"  # the fleet's one model source


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


def case_variants(login: str) -> int:
    con = _db()
    try:
        return con.execute("SELECT count(*) FROM user WHERE lower(login) = lower(?)", (login,)).fetchone()[0]
    finally:
        con.close()




def slugify(title: str) -> str:
    """Deterministic kebab slug for a test title (titles are unique per fixture)."""
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "task"


def cross_delegate(title: str, worktree: Path = STAND, assignee: str = RESIDENT):
    out = run_cli("delegate", "--title", title, "--slug", slugify(title),
                  "--assignee", assignee, "--worktree", str(worktree),
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


def backdate_mtime(uuid: str, hours: int = 2, minutes: int = 0) -> None:
    ago = hours * 60 + minutes
    out = fossil("sql", f"UPDATE ticket SET tkt_mtime = datetime('now', '-{ago} minutes') WHERE tkt_uuid = '{uuid}';")


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
    (MIXED / "bin").mkdir(parents=True, exist_ok=True)
    (MIXED / "bin" / "opencode.exe").write_bytes(b"")  # the mixed-case worktree of S6/S8
    REUSE.mkdir(parents=True, exist_ok=True)


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
        omitted = run_cli("delegate", "--title", "s2 omitted worktree", "--slug", "s2-omitted-worktree",
                          "--assignee", BOSS, "--user", BOSS, "--no-wake")
        self.assertEqual(omitted.returncode, 0, (omitted.stdout, omitted.stderr))
        self.assertEqual(field(omitted.stdout.strip(), "watcher"), "")

        explicit = run_cli("delegate", "--title", "s2 explicit own worktree", "--slug", "s2-explicit-own-worktree",
                           "--assignee", BOSS, "--user", BOSS, "--no-wake", "--worktree", str(REPO))
        self.assertEqual(explicit.returncode, 0, (explicit.stdout, explicit.stderr))
        self.assertEqual(field(explicit.stdout.strip(), "watcher"), "")

        refused = run_cli("delegate", "--title", "s2 refused", "--slug", "s2-refused", "--assignee", BOSS,
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

        local = run_cli("delegate", "--title", "s4 unwatched", "--slug", "s4-unwatched",
                          "--assignee", BOSS, "--user", BOSS, "--no-wake")
        self.assertEqual(local.returncode, 0, (local.stdout, local.stderr))
        self.assertIsNone(watch_of(inbox_json(WATCHER), local.stdout.strip()),
                          "a same-worktree ticket carries no watcher and must not appear")

    def test_s5_stalled_ready_by_age_and_stalled_working_by_lease(self):
        out, uuid = cross_delegate("s5 ready age")
        entry = watch_of(inbox_json(WATCHER), uuid)
        self.assertIsNotNone(entry)
        self.assertFalse(entry["stalled"])
        # this ticket HAS a wake target: the >1h rule is what must fire for it (the no-wake rule is S11)
        set_wake = fossil("ticket", "set", uuid, "wake_session", "ses-has-target")
        self.assertEqual(set_wake.returncode, 0, set_wake.stderr)

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


class ResidentCaseFoldTest(unittest.TestCase):
    """S6-S8 — one project, ONE identity. The resident login is derived in its canonical lowercase form, an
    existing login matching case-insensitively is reused, and every verb that matches a login folds the
    case: the case-preserving path stops forking the organization into two spellings of one project."""

    def test_s6_mixed_case_path_derives_the_canonical_login_once(self):
        out, uuid = cross_delegate("s6 mixed case", worktree=MIXED, assignee=CASE_RESIDENT)
        self.assertIn(f"resident {CASE_RESIDENT} (created)", out.stderr)
        self.assertEqual(field(uuid, "assigned_to"), CASE_RESIDENT)
        self.assertEqual(user_count(CASE_RESIDENT), 1)
        self.assertEqual(case_variants(CASE_RESIDENT), 1,
                         "one project, one login: no second spelling of the resident may exist")

    def test_s7_an_existing_login_in_another_case_is_reused(self):
        made = fossil("user", "new", REUSE_LOGIN, stdin="s3cret\ns3cret\n")
        self.assertEqual(made.returncode, 0, (REUSE_LOGIN, made.stderr))
        out, uuid = cross_delegate("s7 reuse", worktree=REUSE, assignee=REUSE_LOGIN.lower())
        self.assertIn(f"resident {REUSE_LOGIN} (present)", out.stderr, "the existing spelling must be reused")
        self.assertEqual(case_variants(REUSE_LOGIN), 1, "reuse must not create a second login")
        self.assertEqual(field(uuid, "assigned_to"), REUSE_LOGIN,
                         "the ticket names the org's real login, not the caller's spelling")

    def test_s8_matching_folds_the_case_across_verbs_and_the_wake(self):
        out, uuid = cross_delegate("s8 match", worktree=MIXED, assignee=CASE_RESIDENT)
        shouted = CASE_RESIDENT.upper()
        doc = inbox_json(shouted)
        self.assertIn(uuid, [t["id"] for t in doc["tickets"]], "inbox must match the assignee across case")

        claim = run_cli("claim", uuid, "--user", shouted)
        self.assertEqual(claim.returncode, 0, (claim.stdout, claim.stderr))
        beat = run_cli("heartbeat", uuid, "--user", CASE_RESIDENT, "--epoch", field(uuid, "lease_epoch"))
        self.assertEqual(beat.returncode, 0, (beat.stdout, beat.stderr))

        # the wake: orgd knocks only at the assignee's own PRESENCE — its login folds the case too
        data = MIXED / ".opencode" / "data"
        data.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(str(data / "opencode.db"))
        try:
            con.execute("CREATE TABLE session(id TEXT)")
            con.execute("INSERT INTO session(id) VALUES('ses_casefold')")
            con.commit()
        finally:
            con.close()
        presence = fossil("sql",
                          "CREATE TABLE IF NOT EXISTS chat(msgid INTEGER PRIMARY KEY, mtime, xfrom TEXT, xmsg TEXT);"
                          f"INSERT INTO chat(msgid, xfrom, xmsg) VALUES(9001,'claude','PRESENCE {shouted} "
                          f"ses_casefold {str(MIXED).upper()}');")
        self.assertEqual(presence.returncode, 0, presence.stderr)
        import orgd  # noqa: E402 — imported here: the module binds $ORG_HOME at import
        session_id, why = orgd.assignee_session(CASE_RESIDENT, str(MIXED))
        self.assertEqual(session_id, "ses_casefold", why)




class NoWakeSignalTest(unittest.TestCase):
    """S11 — a READY ticket with NO wake target is a signal, not a delivery: the watcher's inbox flags it
    STALLED(ready/no-wake) once it is older than N minutes."""

    def test_s11_a_ready_ticket_with_no_wake_target_is_stalled_after_n_minutes(self):
        out, uuid = cross_delegate("s11 no wake", worktree=NOWAKE, assignee=RESIDENT_NOWAKE)
        self.assertEqual(field(uuid, "wake_session"), "")
        entry = watch_of(inbox_json(WATCHER), uuid)
        self.assertIsNotNone(entry)
        self.assertFalse(entry["stalled"])
        backdate_mtime(uuid, hours=0, minutes=11)
        entry = watch_of(inbox_json(WATCHER), uuid)
        self.assertTrue(entry["stalled"], "a READY ticket with no wake target must stall after N minutes")
        self.assertEqual(entry["stalled_reason"], "ready/no-wake")

class _FakeHostHandler(http.server.BaseHTTPRequestHandler):
    """The honest stand for a worktree's live host: a real /global/health nonce echo and the real
    /session + /prompt_async shapes (no provider spend, no session on any real host)."""

    nonce = "fake-nonce-1"
    received: list = []

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split("?")[0] == "/global/health":
            return self._json({"host": _FakeHostHandler.nonce})
        return self._json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError:
            body = {}
        _FakeHostHandler.received.append((self.path.split("?")[0], body))
        if self.path.split("?")[0] == "/session":
            return self._json({"id": "ses_fakehost1"})
        if self.path.split("?")[0].endswith("/prompt_async"):
            return self._json({})
        return self._json({"error": "not found"}, 404)

    def log_message(self, *args):
        pass


_FAKE_HOST = None
_FAKE_PORT = 0


def start_fake_host() -> int:
    """One fake host per test process (started once, on a free port)."""
    global _FAKE_HOST, _FAKE_PORT
    if _FAKE_HOST is not None:
        return _FAKE_PORT
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _FakeHostHandler)
    _FAKE_PORT = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    _FAKE_HOST = server
    return _FAKE_PORT


def make_host_record(worktree: Path, port: int) -> None:
    """Point this worktree's server_host row at the fake host (the shape opencode_host.lookup reads)."""
    data = worktree / ".opencode" / "data"
    data.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(data / "opencode.db"))
    try:
        con.execute("CREATE TABLE IF NOT EXISTS server_host(id TEXT PRIMARY KEY, url TEXT, pid INTEGER, "
                    "nonce TEXT, token TEXT, time_started INTEGER)")
        con.execute("INSERT OR REPLACE INTO server_host(id, url, pid, nonce, token, time_started) "
                    "VALUES('host', ?, ?, ?, ?, ?)",
                    (f"http://127.0.0.1:{port}/", 424242, _FakeHostHandler.nonce, "fake-token", 0))
        con.commit()
    finally:
        con.close()


def run_orgd_once():
    return subprocess.run(
        [sys.executable, "-X", "utf8", str(ORGD_PY), "--once"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(REPO), env=_env(),
    )


def posts_to(suffix: str):
    """The fake host's received POST bodies whose path is (or ends with) `suffix`."""
    return [body for seen_path, body in _FakeHostHandler.received
            if seen_path == suffix or seen_path.endswith(suffix)]


class DeliveryTest(unittest.TestCase):
    """S9-S10 — the hand-off DELIVERS the ticket into a NEW session on the target's live host, pinned to the
    fleet's model (never the worktree's recent free default); orgd delivers when the host appears later."""

    @classmethod
    def setUpClass(cls):
        cls.port = start_fake_host()
        for stand in (LIVE, LATE):
            (stand / "bin").mkdir(parents=True, exist_ok=True)
            (stand / "bin" / "opencode.exe").write_bytes(b"")

    def setUp(self):
        _FakeHostHandler.received.clear()

    def test_s9_live_host_delegate_delivers_and_pins_the_fleet_model(self):
        make_host_record(LIVE, self.port)
        out, uuid = cross_delegate("s9 live deliver", worktree=LIVE, assignee=RESIDENT_LIVE)
        session = field(uuid, "wake_session")
        self.assertTrue(session.startswith("ses_"), f"delivery must record the new session, got {session!r}")
        self.assertEqual(field(uuid, "wake_worktree"), str(LIVE))
        self.assertEqual(field(uuid, "woken_state"), "NEW")
        self.assertIn("delivered into a NEW session", out.stderr)
        self.assertEqual(len(posts_to("/session")), 1, "exactly one session is opened")
        delivered = [body for seen_path, body in _FakeHostHandler.received
                     if seen_path.endswith("/prompt_async")]
        self.assertEqual(len(delivered), 1, "exactly one prompt carries the ticket")
        self.assertIn(uuid, delivered[0].get("parts", [{}])[0].get("text", ""))
        self.assertEqual(delivered[0].get("model"),
                         {"providerID": "opencode-go", "modelID": "muse-spark-1.3-contributor"})
        self.assertEqual(delivered[0].get("variant"), "xhigh")

    def test_s10_orgd_delivers_when_the_host_appears_later_exactly_once(self):
        out, uuid = cross_delegate("s10 late host", worktree=LATE, assignee=RESIDENT_LATE)
        self.assertEqual(field(uuid, "wake_session"), "", "no host yet — nothing delivered at delegate time")
        self.assertIn("cmd_runner start", out.stderr, "no host → the ONE launch command is printed")
        self.assertEqual(posts_to("/session"), [], "no session opened without a host")
        make_host_record(LATE, self.port)
        first = run_orgd_once()
        self.assertEqual(first.returncode, 0, (first.stdout, first.stderr))
        session = field(uuid, "wake_session")
        self.assertTrue(session.startswith("ses_"), f"orgd must deliver once the host appears, got {session!r}")
        self.assertEqual(field(uuid, "woken_state"), "NEW")
        self.assertIn(uuid, "\n".join(str(body) for body in posts_to("/prompt_async")))
        _FakeHostHandler.received.clear()
        second = run_orgd_once()
        self.assertEqual(second.returncode, 0, (second.stdout, second.stderr))
        self.assertEqual(posts_to("/session"), [], "woken NEW — the ticket is never delivered twice")


class FleetModelMirrorTest(unittest.TestCase):
    """The pin is a verified mirror: dispatch.py is the fleet's one model source, org.py must agree with it."""

    def test_fleet_pin_mirrors_the_dispatch_source(self):
        spec = importlib.util.spec_from_file_location("fleet_dispatch", str(DISPATCH))
        dispatch = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(dispatch)
        self.assertEqual(org.FLEET_MODEL, dispatch.MODEL)
        self.assertEqual(org.FLEET_VARIANT, dispatch.VARIANT)

if __name__ == "__main__":
    unittest.main(verbosity=2)
