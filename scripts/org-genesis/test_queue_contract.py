"""test_queue_contract.py — the focused oracle for the queue contract repair (plan 2026-10-08_org-fencing-and-effects).

Three gaps an outside review found in the organization's queue (2026-10-08), each pinned here as a
case that FAILS on the pre-change scripts:

  F — fencing: `claim` takes an epoch, but heartbeat/report/done/escalate did not present it, so a
      worker whose lease was taken over could still write DONE. Now every mutating verb carries
      `--epoch N`; a stale epoch is refused with the current holder named.
  E — the wake effect: orgd wrote woken_state only AFTER the POST answered 2xx, so a crash between
      the answer and the write re-sent the same wake. Now every wake is recorded as an effect
      (idempotency_key, status PENDING -> COMMITTED|UNKNOWN) BEFORE the POST; a crash leaves PENDING
      and the next tick RESOLVES it by reading the target session for the wake marker — never by
      resending blind.
  V — the verdict: DONE was the worker's own testimony with no acceptance step. Now the delegator
      either VERIFIES (terminal), REJECTS back to READY with a findings technote (rework), or
      CANCELS; only the delegator may pass a verdict and illegal transitions are refused.

Runs against a REAL isolated Fossil repository (tempfile.mkdtemp; no service, no production
ORG_HOME): every org.py call is a subprocess, the orgd tick is a subprocess. Refusals assert the
message AND that repository content is untouched, never the exit code alone. `ORG_PORT` points at a
port with no listener so `chat` can never reach the live org.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GENESIS = REPO / "scripts" / "org-genesis"
ORG_PY = GENESIS / "org.py"
ORGD_PY = GENESIS / "orgd.py"

_CANDIDATES = [
    os.environ.get("FOSSIL"),
    str(REPO / "external" / "fossil" / "fossil.exe"),
    str(REPO / "tools" / "fossil.exe"),
]
FOSSIL = next(str(c) for c in _CANDIDATES if c and Path(c).exists())

FIXTURE = Path(tempfile.mkdtemp(prefix="org-queue-"))
os.environ["ORG_HOME"] = str(FIXTURE)
os.environ["ORG_PORT"] = "1"  # nothing listens: chat sends fail fast and never reach the live org
os.environ["FOSSIL"] = FOSSIL
os.environ["PYTHONUTF8"] = "1"
os.environ.pop("ORG_USER", None)
os.environ.pop("ORG_SESSION", None)
sys.path.insert(0, str(GENESIS))
import org  # noqa: E402 — imported AFTER ORG_HOME is pinned: its constants must bind to the fixture
import orgd  # noqa: E402

assert org.ORG == FIXTURE / "org.fossil", "fixture must own ORG — refusing to run against a production org"
assert orgd.ORG == FIXTURE / "org.fossil", "fixture must own ORG (orgd) — refusing to run against a production org"

BOSS = "boss-q"  # the delegator: every ticket below is delegated by this login
W1 = "w1-q"      # the worker
W2 = "w2-q"      # the worker that takes over an expired lease
SESSION = "ses_deadbeefdeadbeefdeadbeef"  # the wake target (a fake session in a fake worktree)


def fossil(*args: str, user: str | None = None, stdin: str | None = None):
    cmd = [FOSSIL, *args, "-R", str(FIXTURE / "org.fossil")]
    if user:
        cmd += ["-U", user]
    return subprocess.run(cmd, input=stdin, capture_output=True, text=True, encoding="utf-8", errors="replace")


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


def run_orgd_once():
    return subprocess.run(
        [sys.executable, "-X", "utf8", str(ORGD_PY), "--once"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(REPO), env=_env(),
    )


def ticket_row(uuid: str):
    con = sqlite3.connect(
        "file:" + urllib.request.pathname2url(str(FIXTURE / "org.fossil")) + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        return con.execute("SELECT * FROM ticket WHERE tkt_uuid = ?", (uuid,)).fetchone()
    finally:
        con.close()


def field(uuid: str, name: str) -> str:
    value = ticket_row(uuid)[name]
    return "" if value is None else str(value)


def fossil_set(uuid: str, **fields: str) -> None:
    """The crash writer: the same shape orgd uses, bypassing the verbs."""
    args: list[str] = []
    for key, value in fields.items():
        args += [key, str(value)]
    out = fossil("ticket", "set", uuid, *args, user=BOSS)
    assert out.returncode == 0, out.stderr


def slugify(title: str) -> str:
    """Deterministic kebab slug for a test title (titles are unique per fixture)."""
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or "task"


def delegate(title: str, assignee: str = W1, worktree: str | None = None,
             session: str | None = None, no_wake: bool = True) -> str:
    args = ["delegate", "--title", title, "--slug", slugify(title), "--assignee", assignee, "--user", BOSS]
    if no_wake:
        args.append("--no-wake")
    if session:
        args += ["--session", session]
    if worktree:
        args += ["--worktree", worktree]
    out = run_cli(*args)
    assert out.returncode == 0, (out.stdout, out.stderr)
    return out.stdout.strip()


def claim(uuid: str, user: str = W1, lease: int | None = None):
    args = ["claim", uuid, "--user", user]
    if lease is not None:
        args += ["--lease", str(lease)]
    return run_cli(*args)


def done(uuid: str, user: str, epoch: int | None = None, report: str | None = None):
    args = ["done", uuid, "--user", user]
    if epoch is not None:
        args += ["--epoch", str(epoch)]
    if report:
        args += ["--report", report]
    return run_cli(*args)


def make_worktree(name: str) -> Path:
    """A worktree the queue can read: one session, an empty part table."""
    wt = FIXTURE / name
    (wt / ".opencode" / "data").mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(wt / ".opencode" / "data" / "opencode.db"))
    con.execute("CREATE TABLE session (id TEXT PRIMARY KEY)")
    con.execute("CREATE TABLE part (id TEXT, session_id TEXT, data TEXT)")
    con.execute("INSERT INTO session (id) VALUES (?)", (SESSION,))
    con.commit()
    con.close()
    return wt


def add_part(wt: Path, session_id: str, text: str) -> None:
    con = sqlite3.connect(str(wt / ".opencode" / "data" / "opencode.db"))
    con.execute("INSERT INTO part (id, session_id, data) VALUES (?, ?, ?)",
                ("part-1", session_id, json.dumps({"type": "text", "text": text})))
    con.commit()
    con.close()


def part_count(wt: Path) -> int:
    con = sqlite3.connect(str(wt / ".opencode" / "data" / "opencode.db"))
    try:
        return con.execute("SELECT count(*) FROM part").fetchone()[0]
    finally:
        con.close()


def effect_ticket(name: str, worktree: Path) -> str:
    """A DONE ticket whose wake target is `worktree`, closed through the real verbs."""
    uuid = delegate(name, worktree=str(worktree), session=SESSION, no_wake=False)
    out = claim(uuid, W1)
    assert out.returncode == 0, (out.stdout, out.stderr)
    out = done(uuid, W1, epoch=1)
    assert out.returncode == 0, (out.stdout, out.stderr)
    return uuid


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
    assert "agent_state" in out.stdout, ("fixture ticket schema did not land", out.stdout, out.stderr)
    for login, caps in ((BOSS, "kf"), (W1, "k"), (W2, "k")):
        out = fossil("user", "new", login, stdin="s3cret\ns3cret\n")
        assert out.returncode == 0, (login, out.stderr)
        out = fossil("user", "capabilities", login, caps)
        assert out.returncode == 0, (login, caps, out.stderr)


def tearDownModule() -> None:
    shutil.rmtree(FIXTURE, ignore_errors=True)


class FencingTest(unittest.TestCase):
    maxDiff = None

    def test_f1_stale_epoch_done_is_refused_with_the_current_holder_named(self):
        uuid = delegate("f1 stale done")
        self.assertEqual(claim(uuid, W1, lease=0).returncode, 0)  # expires immediately...
        out = claim(uuid, W2)                                     # ...so W2 takes over, epoch 2
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "lease_epoch"), "2")

        out = done(uuid, W1, epoch=1)
        self.assertNotEqual(out.returncode, 0, "a stale epoch closed the ticket")
        both = out.stdout + out.stderr
        self.assertIn("stale epoch", both)
        self.assertIn(W2, both, "the refusal must name the current holder")
        self.assertEqual(field(uuid, "agent_state"), "WORKING", "a refused done must not touch the state")

        out = done(uuid, W2, epoch=2)  # the live holder still closes it
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "agent_state"), "DONE")

    def test_f2_stale_epoch_heartbeat_report_escalate_refused_and_repo_untouched(self):
        uuid = delegate("f2 stale verbs")
        self.assertEqual(claim(uuid, W1, lease=0).returncode, 0)
        self.assertEqual(claim(uuid, W2).returncode, 0)

        out = run_cli("heartbeat", uuid, "--user", W1, "--epoch", "1")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("stale epoch", out.stdout + out.stderr)
        self.assertIn(W2, out.stdout + out.stderr)

        out = run_cli("report", uuid, "--user", W1, "--epoch", "1", "--title", "f2 stale report", "--text", "x")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("stale epoch", out.stdout + out.stderr)
        self.assertEqual(field(uuid, "report_ref"), "", "a refused report must not pin report_ref")
        self.assertNotIn("f2 stale report", fossil("timeline", "-t", "e", "-n", "80").stdout,
                         "a refused report must not create its technote (tech notes list under `timeline -t e`, never `wiki list`)")

        out = run_cli("escalate", uuid, "--user", W1, "--epoch", "1", "--code", "why")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("stale epoch", out.stdout + out.stderr)
        self.assertEqual(field(uuid, "failure_code"), "", "a refused escalate must not set failure_code")
        self.assertEqual(field(uuid, "agent_state"), "WORKING")

    def test_f3_epoch_is_required_and_the_live_epoch_still_closes(self):
        uuid = delegate("f3 live done")
        self.assertEqual(claim(uuid, W1).returncode, 0)

        out = done(uuid, W1)  # no --epoch
        self.assertNotEqual(out.returncode, 0, "a mutating verb without --epoch must be refused")
        self.assertEqual(field(uuid, "agent_state"), "WORKING")

        out = run_cli("heartbeat", uuid, "--user", W1, "--epoch", "1")  # the live epoch passes the fence
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))

        out = done(uuid, W1, epoch=1)
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "agent_state"), "DONE")


class VerdictTest(unittest.TestCase):
    maxDiff = None

    def test_v1_verify_is_delegator_only_and_done_only(self):
        uuid = delegate("v1 verify")

        out = run_cli("verify", uuid, "--user", BOSS)  # READY: nothing to verify
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("DONE", out.stdout + out.stderr)

        self.assertEqual(claim(uuid, W1).returncode, 0)
        self.assertEqual(done(uuid, W1, epoch=1).returncode, 0)

        out = run_cli("verify", uuid, "--user", W1)  # not the delegator
        self.assertNotEqual(out.returncode, 0)
        self.assertIn(BOSS, out.stdout + out.stderr, "the refusal must name the delegator")
        self.assertEqual(field(uuid, "agent_state"), "DONE", "a refused verdict must not touch the state")

        out = run_cli("verify", uuid, "--user", BOSS)
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "agent_state"), "VERIFIED")

        self.assertNotEqual(claim(uuid, W2).returncode, 0, "a VERIFIED ticket is not claimable")

    def test_v2_reject_returns_to_ready_with_findings_and_the_assignee_reclaims(self):
        uuid = delegate("v2 reject")
        self.assertEqual(claim(uuid, W1).returncode, 0)
        self.assertEqual(done(uuid, W1, epoch=1).returncode, 0)

        out = run_cli("reject", uuid, "--user", W1, "--title", "v2 nope", "--text", "not mine to reject")
        self.assertNotEqual(out.returncode, 0)
        self.assertNotIn("v2 nope", fossil("timeline", "-t", "e", "-n", "80").stdout)

        out = run_cli("reject", uuid, "--user", BOSS, "--title", "V2 findings", "--text", "## findings\nredo X")
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        row = ticket_row(uuid)
        self.assertEqual(str(row["agent_state"]), "READY")
        self.assertEqual(str(row["attempt"]), "1")
        findings = str(row["knowledge_ref"] or "")
        self.assertTrue(findings.startswith("V2 findings"), findings)
        ledger = fossil("timeline", "-t", "e", "-n", "80").stdout
        self.assertIn(findings, ledger, "the findings must exist as a technote (listed by `timeline -t e`)")
        self.assertIn(f"task-{uuid[:10]}", ledger, "the findings technote must carry the task tag")

        out = claim(uuid, W1)  # the rework is claimable again, on the next epoch
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "agent_state"), "WORKING")
        self.assertEqual(field(uuid, "lease_epoch"), "2")

    def test_v3_cancel_closes_and_blocked_claim(self):
        uuid = delegate("v3 cancel")

        out = run_cli("cancel", uuid, "--user", W1, "--code", "not mine")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn(BOSS, out.stdout + out.stderr)

        out = run_cli("cancel", uuid, "--user", BOSS, "--code", "obsolete")
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "agent_state"), "CANCELLED")

        self.assertNotEqual(claim(uuid, W1).returncode, 0, "a CANCELLED ticket is not claimable")
        self.assertEqual(field(uuid, "agent_state"), "CANCELLED")


class WakeEffectTest(unittest.TestCase):
    maxDiff = None

    def test_e1_pending_effect_is_resolved_by_reading_not_resent(self):
        wt = make_worktree("wt-e1")
        uuid = effect_ticket("e1 effect", wt)

        key = orgd.effect_key(ticket_row(uuid), "DONE", SESSION)
        add_part(wt, SESSION, f"ORG ticket {uuid} is DONE. [wake {key[:16]}]")  # the wake DID arrive...
        fossil_set(uuid, idempotency_key=key, woken_state="PENDING")            # ...then the crash landed
        self.assertEqual(part_count(wt), 1)

        out = run_orgd_once()
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "woken_state"), "DONE",
                         "the PENDING effect must be resolved by reading the target session")
        self.assertEqual(part_count(wt), 1, "the wake must not be re-sent")
        self.assertIn("resolved by reading", out.stdout)
        self.assertNotIn(f"woke {SESSION}", out.stdout)

    def test_e2_pending_effect_with_unreadable_target_is_never_sent(self):
        wt = FIXTURE / "wt-e2-missing"
        wt.mkdir(parents=True, exist_ok=True)  # no .opencode/data/opencode.db: the target cannot be read
        uuid = effect_ticket("e2 unreadable", wt)

        key = orgd.effect_key(ticket_row(uuid), "DONE", SESSION)
        fossil_set(uuid, idempotency_key=key, woken_state="PENDING")

        out = run_orgd_once()
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        self.assertEqual(field(uuid, "woken_state"), "UNKNOWN",
                         "an unreadable target leaves the effect UNKNOWN, never confirmed")
        self.assertNotIn(f"woke {SESSION}", out.stdout, "nothing may be sent while the outcome is unknown")


if __name__ == "__main__":
    unittest.main(verbosity=2)
