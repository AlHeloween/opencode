"""test_ticket_slugs.py — the focused oracle for human ticket slugs (plan 2026-10-16_org-ticket-slugs).

Owner, 2026-10-14: «есть номера тикетов, а о чем они никому не известно» — every
ticket carries a required kebab slug, unique among open tickets, and every verb
and report shows slug + title.

  T1 — `delegate` requires `--slug` (kebab-case, 1-64 chars); garbage is refused
       with a clear error; a valid slug lands in the ticket's `slug` field.
  T2 — a second open ticket with the same slug is refused, naming the conflict;
       after the first ticket is VERIFIED the slug is free again.
  T3 — every verb that takes a ticket accepts a slug or an id: claim, heartbeat,
       report, done, verify, and `delegate --parent <slug>` lineage.
  T4 — `inbox --json` and the text inbox show slug + title; a legacy ticket
       without a slug stays readable (text slug «-»).
  T5 — the «Active tasks» report prints slug + title (sqlcode carries slug, and
       the stored SELECT returns slug values, legacy included).
  T6 — a superseded ticket is cancelled with a code naming the successor slug
       (`cancel --successor <slug>`); an unknown successor is refused.
  T7 — an unknown slug reads as «no ticket», never as an empty result.

Runs against a REAL isolated Fossil repository under .temp/test/ (no service, no
production ORG_HOME): every org.py call is a subprocess, and assertions read the
repository back, never the report alone. No mocks.
"""
from __future__ import annotations

import json
import os
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

_CANDIDATES = [
    os.environ.get("FOSSIL"),
    str(REPO / "external" / "fossil" / "fossil.exe"),
    str(REPO / "tools" / "fossil.exe"),
]
FOSSIL = next(str(c) for c in _CANDIDATES if c and Path(c).exists())

SANDBOX = REPO / ".temp" / "test"
SANDBOX.mkdir(parents=True, exist_ok=True)
FIXTURE = Path(tempfile.mkdtemp(prefix="org-slugs-", dir=str(SANDBOX)))
os.environ["ORG_HOME"] = str(FIXTURE)
os.environ["ORG_PORT"] = "1"  # nothing listens: chat sends fail fast and never reach the live org
os.environ["FOSSIL"] = FOSSIL
os.environ["PYTHONUTF8"] = "1"
os.environ.pop("ORG_USER", None)
os.environ.pop("ORG_SESSION", None)
sys.path.insert(0, str(GENESIS))
import org  # noqa: E402 — imported AFTER ORG_HOME is pinned: its constants must bind to the fixture

assert org.ORG == FIXTURE / "org.fossil", "fixture must own ORG — refusing to run against a production org"

BOSS = "boss-s"  # the delegator of every ticket here
W1 = "w1-s"      # the worker
W2 = "w2-s"      # a second login (verdict fence checks)


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


def delegate(title: str, slug: str | None = None, assignee: str = W1,
             extra: tuple[str, ...] = ()) -> subprocess.CompletedProcess:
    args = ["delegate", "--title", title, "--assignee", assignee, "--user", BOSS, "--no-wake"]
    if slug is not None:
        args += ["--slug", slug]
    args += list(extra)
    return run_cli(*args)


def inbox_json(user: str) -> dict:
    out = run_cli("inbox", "--user", user, "--json", "--no-presence")
    assert out.returncode == 0, (out.stdout, out.stderr)
    return json.loads(out.stdout)


def apply_branding() -> None:
    """branding.sql into the fixture the way init.py does — then read it back."""
    text = (GENESIS / "branding.sql").read_text(encoding="utf-8")
    out = subprocess.run([FOSSIL, "sql", "-R", str(FIXTURE / "org.fossil")],
                         input=text, capture_output=True, text=True,
                         encoding="utf-8", errors="replace")
    assert out.returncode == 0, out.stderr
    con = _db()
    try:
        counts = con.execute(
            "SELECT count(*) FROM config WHERE name IN"
            " ('project-name','short-project-name','project-description','index-page');").fetchone()[0]
        active = con.execute(
            "SELECT count(*) FROM reportfmt WHERE title='Active tasks';").fetchone()[0]
    finally:
        con.close()
    # `fossil sql` discards a failed statement's exit code (measured 2026-10-08, t11):
    # the outcome is read back from the artifact, never trusted from the exit code.
    assert (counts, active) == (4, 1), ("branding failed its read-back", counts, active)


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
    assert "agent_state" in out.stdout and "slug" in out.stdout, ("fixture ticket schema did not land", out.stdout)
    for login, caps in ((BOSS, "kf"), (W1, "k"), (W2, "k")):
        out = fossil("user", "new", login, stdin="s3cret\ns3cret\n")
        assert out.returncode == 0, (login, out.stderr)
        out = fossil("user", "capabilities", login, caps)
        assert out.returncode == 0, (login, caps, out.stderr)
    apply_branding()


def tearDownModule() -> None:
    shutil.rmtree(FIXTURE, ignore_errors=True)


class SlugRequiredTest(unittest.TestCase):
    maxDiff = None

    def test_t1_delegate_requires_a_kebab_slug(self):
        missing = delegate("t1 missing slug")
        self.assertNotEqual(missing.returncode, 0, "delegate without --slug must be refused")
        self.assertIn("slug", missing.stdout + missing.stderr)

        for bad in ("Bad_Slug!", "-lead", "trail-", "two  spaces", "UPPER", "x" * 65, ""):
            out = delegate("t1 bad slug", slug=bad)
            self.assertNotEqual(out.returncode, 0, f"slug {bad!r} must be refused")
            self.assertIn("slug", out.stdout + out.stderr)

        out = delegate("t1 good slug", slug="t1-good-slug")
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        uuid = out.stdout.strip()
        self.assertTrue(len(uuid) >= 40, ("stdout must stay exactly the ticket uuid", out.stdout))
        self.assertEqual(field(uuid, "slug"), "t1-good-slug")

    def test_t2_slug_is_unique_among_open_tickets_and_free_after_close(self):
        first = delegate("t2 first", slug="t2-dup")
        self.assertEqual(first.returncode, 0, (first.stdout, first.stderr))
        uuid1 = first.stdout.strip()

        clash = delegate("t2 clash", slug="t2-dup")
        self.assertNotEqual(clash.returncode, 0, "a duplicate slug among open tickets must be refused")
        both = clash.stdout + clash.stderr
        self.assertIn("t2-dup", both, "the refusal must name the slug")
        self.assertIn(uuid1[:10], both, "the refusal must name the ticket holding it")

        # close the holder through the real verdict path, by slug
        self.assertEqual(run_cli("claim", "t2-dup", "--user", W1).returncode, 0)
        epoch = field(uuid1, "lease_epoch")
        self.assertEqual(run_cli("done", "t2-dup", "--user", W1, "--epoch", epoch).returncode, 0)
        self.assertEqual(run_cli("verify", "t2-dup", "--user", BOSS).returncode, 0)
        self.assertEqual(field(uuid1, "agent_state"), "VERIFIED")

        again = delegate("t2 again", slug="t2-dup")
        self.assertEqual(again.returncode, 0, (again.stdout, again.stderr))
        self.assertNotEqual(again.stdout.strip(), uuid1)


class SlugResolutionTest(unittest.TestCase):
    maxDiff = None

    def test_t3_every_verb_takes_a_slug_or_an_id(self):
        out = delegate("t3 lifecycle", slug="t3-cycle")
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        uuid = out.stdout.strip()

        claim = run_cli("claim", "t3-cycle", "--user", W1)
        self.assertEqual(claim.returncode, 0, (claim.stdout, claim.stderr))
        epoch = field(uuid, "lease_epoch")

        beat = run_cli("heartbeat", "t3-cycle", "--user", W1, "--epoch", epoch, "--what", "by slug")
        self.assertEqual(beat.returncode, 0, (beat.stdout, beat.stderr))

        report = run_cli("report", "t3-cycle", "--user", W1, "--epoch", epoch,
                         "--title", "T3 result", "--text", "done by slug")
        self.assertEqual(report.returncode, 0, (report.stdout, report.stderr))

        done = run_cli("done", "t3-cycle", "--user", W1, "--epoch", epoch, "--report", "T3 result")
        self.assertEqual(done.returncode, 0, (done.stdout, done.stderr))
        self.assertEqual(field(uuid, "agent_state"), "DONE")

        # the id still works beside the slug
        self.assertEqual(run_cli("verify", uuid, "--user", BOSS).returncode, 0)

        child = delegate("t3 child", slug="t3-child", extra=("--parent", "t3-cycle"))
        self.assertEqual(child.returncode, 0, (child.stdout, child.stderr))
        self.assertEqual(field(child.stdout.strip(), "parent_task"), uuid)

    def test_t7_an_unknown_slug_is_no_ticket(self):
        out = run_cli("claim", "no-such-slug", "--user", W1)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("no ticket", out.stdout + out.stderr)


class SlugReportingTest(unittest.TestCase):
    maxDiff = None

    def test_t4_inbox_json_and_text_show_slug_and_title(self):
        out = delegate("t4 watched title", slug="t4-slug")
        self.assertEqual(out.returncode, 0, (out.stdout, out.stderr))
        uuid = out.stdout.strip()

        doc = inbox_json(W1)
        mine = [t for t in doc["tickets"] if t["id"] == uuid]
        self.assertEqual(len(mine), 1, "the ticket must be in the assignee's inbox")
        self.assertEqual(mine[0]["slug"], "t4-slug")
        self.assertEqual(mine[0]["title"], "t4 watched title")

        text = run_cli("inbox", "--user", W1, "--no-presence")
        self.assertEqual(text.returncode, 0, (text.stdout, text.stderr))
        line = next(ln for ln in text.stdout.splitlines() if ln.startswith(uuid[:10]))
        self.assertIn("t4-slug", line, "the text inbox must show the slug")
        self.assertIn("t4 watched title", line, "the text inbox must show the title")

    def test_t4_legacy_ticket_without_slug_stays_readable(self):
        # a ticket from before slugs: the raw fossil verb never set the field
        out = fossil("ticket", "add", "title", "t4 legacy", "type", "Task", "status", "Open",
                     "agent_state", "READY", "delegated_by", BOSS, "assigned_to", W1,
                     "delegation_depth", "0", "workspace_repo", str(REPO), user=BOSS)
        self.assertEqual(out.returncode, 0, out.stderr)
        legacy = next(t for t in out.stdout.replace("\n", " ").split() if len(t.strip(".,:;")) in (40, 64)).strip(".,:;")
        self.assertEqual(field(legacy, "slug"), "", "the legacy ticket carries no slug")

        doc = inbox_json(W1)
        mine = [t for t in doc["tickets"] if t["id"] == legacy]
        self.assertEqual(len(mine), 1, "the legacy ticket must stay listed")
        self.assertEqual(mine[0]["slug"], "")

        text = run_cli("inbox", "--user", W1, "--no-presence")
        self.assertEqual(text.returncode, 0, (text.stdout, text.stderr))
        line = next(ln for ln in text.stdout.splitlines() if ln.startswith(legacy[:10]))
        self.assertIn("  -  ", line, "a ticket without a slug prints slug «-»")
        self.assertIn("t4 legacy", line)

    def test_t5_active_tasks_report_prints_slug_and_title(self):
        seen = delegate("t5 reported", slug="t5-slug")
        self.assertEqual(seen.returncode, 0, (seen.stdout, seen.stderr))
        con = _db()
        try:
            sqlcode = con.execute(
                "SELECT sqlcode FROM reportfmt WHERE title='Active tasks';").fetchone()[0]
        finally:
            con.close()
        self.assertIn("slug", str(sqlcode), "the Active tasks report must select the slug")
        self.assertIn("title", str(sqlcode), "the Active tasks report must select the title")
        con = _db()
        try:
            found = con.execute(str(sqlcode)).fetchall()
        finally:
            con.close()
        by_slug = {str(row["slug"] or ""): str(row["title"] or "") for row in found}
        self.assertIn("t5-slug", by_slug)
        self.assertEqual(by_slug["t5-slug"], "t5 reported")


class SlugSupersedeTest(unittest.TestCase):
    maxDiff = None

    def test_t6_cancel_with_successor_names_its_slug(self):
        old = delegate("t6 old", slug="t6-old")
        self.assertEqual(old.returncode, 0, (old.stdout, old.stderr))
        new = delegate("t6 new", slug="t6-new")
        self.assertEqual(new.returncode, 0, (new.stdout, new.stderr))

        gone = run_cli("cancel", "t6-old", "--user", BOSS, "--code", "replaced", "--successor", "t6-new")
        self.assertEqual(gone.returncode, 0, (gone.stdout, gone.stderr))
        code = field(old.stdout.strip(), "failure_code")
        self.assertIn("t6-new", code, "the cancel code must name the successor slug")
        self.assertIn("superseded", code)
        self.assertEqual(field(old.stdout.strip(), "agent_state"), "CANCELLED")

        lost = run_cli("cancel", new.stdout.strip(), "--user", BOSS,
                       "--code", "x", "--successor", "t6-ghost")
        self.assertNotEqual(lost.returncode, 0, "an unknown successor slug must be refused")
        self.assertEqual(field(new.stdout.strip(), "agent_state"), "READY",
                         "a refused cancel must not touch the state")


if __name__ == "__main__":
    unittest.main(verbosity=2)
