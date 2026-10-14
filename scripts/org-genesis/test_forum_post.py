"""test_forum_post.py — the focused oracle for `org.py forum` / `org.py forum-post` (2026-10-14).

Runs against a REAL isolated Fossil repository (tempfile.mkdtemp; no service, no production ORG_HOME):
every org.py call is a subprocess whose ORG_HOME/FOSSIL point at the fixture. Reject cases assert the
refusal AND that repository content is untouched (row counts), never the exit code alone.

The route under test (measured 2026-10-14, fossil 2.28 [52445a27f1]): fossil 2.28 has NO CLI verb that
posts to a forum, and a loopback web post authenticates through --localauth as the first setup-capable
login (src/login.c) — every post would be authored by the administrator, not by --user. So forum-post
builds the forum manifest itself (D/G/H/I/N/U/W/Z — the bytes src/forum.c writes), inserts it with
`fossil test-content-put` INSIDE the org's check-out, crosslinks it with `fossil test-crosslink`
(src/manifest.c populates forumpost + event — the tables the web forum reads), and proves the post by
READING IT BACK: stored artifact byte-for-byte, the forumpost row, `fossil test-forumthread`.

Primitive facts this fixture relies on (measured, experiments through .temp probes + src):
  * forum artifact uuid = SHA3-256 of the artifact bytes (repo hash policy "shun-sha1" is the 2.28 default).
  * `fossil test-content-put FILE` prints "inserted as record RID"; it refuses a bare -R repository
    (db_must_be_within_tree) — it must run inside an open check-out.
  * manifest card values are fossilized (space->\\s, newline->\\n, '\\'->'\\\\'); W carries an explicit byte
    count, so a body may contain anything.
  * capabilities '2'/'3'/'4' = forum read / write / trusted write (src/login.c:1741-1745,
    src/capabilities.c "Forum-Read/Write/Trusted"); the fossil CLI does NOT enforce caps for -U users
    (measured, test_wiki_put.py) — the guard lives in org.py.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import socket
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

FIXTURE = Path(tempfile.mkdtemp(prefix="org-forum-"))
os.environ["ORG_HOME"] = str(FIXTURE)
os.environ["ORG_PORT"] = "1"  # nothing listens: no org.py call here may need the server
os.environ["FOSSIL"] = FOSSIL
os.environ.pop("ORG_USER", None)
os.environ.pop("ORG_SESSION", None)
sys.path.insert(0, str(GENESIS))
import org  # noqa: E402 — imported AFTER ORG_HOME is pinned: its constants must bind to the fixture

assert org.ORG == FIXTURE / "org.fossil", "fixture must own ORG — refusing to run against a production org"

SMIT = "smit-q"      # capabilities 'kf3' — can post to the forum
READER = "reader-q"  # capabilities 'o' — no forum ability at all

CHECKOUT = FIXTURE / "checkout"
MARKER = CHECKOUT / ("_FOSSIL_" if os.name == "nt" else ".fslckout")


def fossil(*args: str, user: str | None = None, data: bytes | None = None):
    cmd = [FOSSIL, *args, "-R", str(org.ORG)]
    if user:
        cmd += ["-U", user]
    return subprocess.run(cmd, input=data, capture_output=True)


def _db() -> sqlite3.Connection:
    con = sqlite3.connect(
        "file:" + urllib.request.pathname2url(str(org.ORG)) + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def snapshot() -> dict:
    con = _db()
    try:
        counts = {"blob": con.execute("SELECT count(*) FROM blob").fetchone()[0],
                  "event": con.execute("SELECT count(*) FROM event").fetchone()[0]}
        try:
            counts["forumpost"] = con.execute("SELECT count(*) FROM forumpost").fetchone()[0]
        except sqlite3.OperationalError:
            counts["forumpost"] = None  # born-empty: the table appears with the first post
    finally:
        con.close()
    return counts


def post_row(uuid: str):
    con = _db()
    try:
        return con.execute(
            "SELECT f.fpid, f.froot, f.firt, (SELECT rid FROM blob WHERE uuid = ?) AS rid "
            "FROM forumpost f WHERE f.fpid = (SELECT rid FROM blob WHERE uuid = ?)",
            (uuid, uuid)).fetchone()
    finally:
        con.close()


def event_of(rid: int):
    con = _db()
    try:
        return con.execute("SELECT user, comment, type FROM event WHERE objid = ?", (rid,)).fetchone()
    finally:
        con.close()


def run_cli(*args: str, stdin: str | None = None, extra_env: dict | None = None):
    env = dict(os.environ)
    env.pop("ORG_USER", None)
    env.pop("ORG_SESSION", None)
    env["ORG_HOME"] = str(FIXTURE)
    env["ORG_PORT"] = "1"
    env["FOSSIL"] = FOSSIL
    env["PYTHONUTF8"] = "1"
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-X", "utf8", str(ORG_PY), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        input=stdin, cwd=str(REPO), env=env,
    )


def write_input(name: str, data: bytes) -> Path:
    path = FIXTURE / name
    path.write_bytes(data)
    return path


def post(*args: str, stdin: str | None = None):
    return run_cli("forum-post", *args, stdin=stdin)


def address_of(result) -> str:
    match = re.search(r"address=([0-9a-f]{40,64})", result.stdout)
    assert match, f"stdout must carry the artifact address: {result.stdout!r}"
    return match.group(1)


def stored_artifact(uuid: str) -> bytes:
    out = fossil("artifact", uuid)
    assert out.returncode == 0, out.stderr
    return out.stdout


def thread_view(uuid: str):
    return fossil("test-forumthread", uuid)


def setUpModule() -> None:
    out = subprocess.run([FOSSIL, "init", str(org.ORG)], capture_output=True)
    assert out.returncode == 0, out.stderr
    for login, caps in ((SMIT, "kf3"), (READER, "o")):
        out = fossil("user", "new", login, data=b"s3cret\ns3cret\n")
        assert out.returncode == 0, (login, out.stderr)
        out = fossil("user", "capabilities", login, caps)
        assert out.returncode == 0, (login, caps, out.stderr)
    # the check-out forum-post writes through — created exactly the way init.py does
    CHECKOUT.mkdir(parents=True, exist_ok=True)
    out = subprocess.run([FOSSIL, "open", str(org.ORG)], capture_output=True, cwd=str(CHECKOUT))
    assert out.returncode == 0, out.stderr
    assert MARKER.exists(), "fixture check-out missing its marker"


def tearDownModule() -> None:
    shutil.rmtree(FIXTURE, ignore_errors=True)


class ForumPostTest(unittest.TestCase):
    maxDiff = None
    root = ""  # the first thread's uuid, set by test_02

    def reject(self, result, marker: str, before: dict) -> None:
        self.assertNotEqual(result.returncode, 0, msg=f"expected refusal, got: {result.stdout!r}")
        self.assertIn(marker, (result.stdout + result.stderr).lower(), msg=f"refusal must name {marker!r}: {result.stderr!r}")
        self.assertEqual(snapshot(), before, msg="a refused call must not change the repository")

    # --- accepted paths -------------------------------------------------------------------

    def test_01_forum_is_born_empty(self) -> None:
        result = run_cli("forum")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("forum empty", result.stdout)
        self.assertIsNone(snapshot()["forumpost"], "reading an empty forum must not create the table")

    def test_02_thread_roundtrip(self) -> None:
        body = "первый пост 🌍\nвторой рядок\n"
        path = write_input("thread.md", body.encode("utf-8"))
        title = "Фикстура нить"
        result = post("--title", title, "--file", str(path), "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("thread", result.stdout)
        self.assertIn(f"user={SMIT}", result.stdout)
        uuid = address_of(result)
        ForumPostTest.root = uuid

        row = post_row(uuid)
        self.assertIsNotNone(row, "the post must be in the forumpost table")
        self.assertEqual(row["froot"], row["rid"], "a thread root is its own froot")
        self.assertIsNone(row["firt"], "a thread root replies to nothing")
        event = event_of(row["rid"])
        self.assertEqual(event["user"], SMIT)
        self.assertEqual(event["comment"], f"Post: {title}")
        self.assertEqual(event["type"], "f")

        # the stored artifact: exact W payload, the author, the title, and a valid Z checksum
        artifact = stored_artifact(uuid)
        self.assertIn(f"U {SMIT}\n".encode(), artifact)
        self.assertIn(f"H {title.replace(' ', chr(92) + 's')}\n".encode("utf-8"), artifact)
        self.assertIn(f"W {len(body.encode('utf-8'))}\n".encode() + body.encode("utf-8") + b"\n", artifact)
        checksum = re.search(rb"\nZ ([0-9a-f]{32})\n$", artifact)
        self.assertIsNotNone(checksum, "the artifact must end with a Z checksum")
        self.assertEqual(hashlib.md5(artifact[:checksum.start() + 1]).hexdigest(),
                         checksum.group(1).decode(), "Z must be the md5 of the cards before it")

        view = thread_view(uuid)
        self.assertEqual(view.returncode, 0, view.stderr)
        self.assertIn(f"count = 1", view.stdout.decode("utf-8", "replace"))

        listing = run_cli("forum")
        self.assertEqual(listing.returncode, 0, listing.stderr)
        self.assertIn(uuid[:10], listing.stdout)
        self.assertIn(title, listing.stdout)

        single = run_cli("forum", uuid)
        self.assertEqual(single.returncode, 0, single.stderr)
        self.assertIn(title, single.stdout)
        self.assertIn(SMIT, single.stdout)
        self.assertIn(body, single.stdout)

    def test_03_reply_roundtrip(self) -> None:
        self.assertTrue(ForumPostTest.root, "fixture chain: test_02 must have opened the thread")
        reply = "ответ на нить\n"
        path = write_input("reply.md", reply.encode("utf-8"))
        result = post("--reply", ForumPostTest.root, "--file", str(path), "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("reply", result.stdout)
        uuid = address_of(result)

        row = post_row(uuid)
        self.assertIsNotNone(row, "the reply must be in the forumpost table")
        self.assertEqual(row["firt"], post_row(ForumPostTest.root)["rid"], "the reply's parent is the root")
        self.assertEqual(row["froot"], post_row(ForumPostTest.root)["rid"], "the reply's froot stays the root")

        view = thread_view(ForumPostTest.root)
        self.assertEqual(view.returncode, 0, view.stderr)
        self.assertIn("count = 2", view.stdout.decode("utf-8", "replace"))
        self.assertIn(uuid[:8], view.stdout.decode("utf-8", "replace"))

        single = run_cli("forum", ForumPostTest.root)
        self.assertEqual(single.returncode, 0, single.stderr)
        self.assertIn(reply, single.stdout)
        self.assertIn(uuid[:10], single.stdout)

    def test_04_body_from_stdin(self) -> None:
        result = post("--title", "нить со stdin", "--user", SMIT, stdin="тело из stdin\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        uuid = address_of(result)
        self.assertIn("тело из stdin", run_cli("forum", uuid).stdout)

    # --- reject paths (refusal + untouched repository) ------------------------------------

    def test_05_exactly_one_target_required(self) -> None:
        before = snapshot()
        path = write_input("target.md", b"x\n")
        result = post("--file", str(path), "--user", SMIT)
        self.reject(result, "exactly one", before)
        result = post("--title", "both", "--reply", ForumPostTest.root, "--file", str(path), "--user", SMIT)
        self.reject(result, "exactly one", before)

    def test_06_bad_targets_rejected(self) -> None:
        before = snapshot()
        path = write_input("bad-target.md", b"x\n")
        result = post("--reply", "deadbeefdeadbeef", "--file", str(path), "--user", SMIT)
        self.reject(result, "no forum post", before)
        result = post("--title", "", "--file", str(path), "--user", SMIT)
        self.reject(result, "empty", before)
        result = post("--title", "x" * 126, "--file", str(path), "--user", SMIT)
        self.reject(result, "125", before)

    def test_07_bad_bodies_rejected(self) -> None:
        before = snapshot()
        blank = write_input("blank.md", b"   \n\t\n")
        result = post("--title", "blank", "--file", str(blank), "--user", SMIT)
        self.reject(result, "empty", before)
        bad = write_input("bad-utf8.md", b"\xff\xfe\x00bad\n")
        result = post("--title", "utf8", "--file", str(bad), "--user", SMIT)
        self.reject(result, "utf-8", before)
        result = post("--title", "missing", "--file", str(FIXTURE / "no-such.md"), "--user", SMIT)
        self.reject(result, "cannot read", before)

    def test_08_identity_and_capability_rejected(self) -> None:
        before = snapshot()
        path = write_input("who.md", b"x\n")
        result = post("--title", "ghost", "--file", str(path), "--user", "ghost-q")
        self.reject(result, "no such user", before)
        result = post("--title", "reader", "--file", str(path), "--user", READER)
        self.reject(result, "capability", before)
        result = post("--title", "anon", "--file", str(path))
        self.reject(result, "user is required", before)

    def test_09_missing_checkout_rejected(self) -> None:
        before = snapshot()
        path = write_input("checkout.md", b"x\n")
        backup = MARKER.read_bytes()
        MARKER.unlink()
        try:
            result = post("--title", "no checkout", "--file", str(path), "--user", SMIT)
            self.reject(result, "check-out", before)
        finally:
            MARKER.write_bytes(backup)
        result = post("--title", "checkout back", "--file", str(path), "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_10_unknown_thread_rejected(self) -> None:
        before = snapshot()
        result = run_cli("forum", "deadbeefdeadbeef")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no forum post", (result.stdout + result.stderr).lower())
        self.assertEqual(snapshot(), before)

    def test_11_init_enables_forum_and_grants_caps_idempotently(self) -> None:
        """init.py is the other half of the contract: it creates the check-out forum-post writes through,
        grants the forum capabilities to every robot login (existing ones included), and republishes the
        Protocol page — all idempotently. No service: a dummy listener holds ORG_PORT so init.py never
        spawns a real server, and ORG_NO_ORGD keeps orgd out."""

        env = dict(os.environ)
        env.update({"ORG_HOME": str(FIXTURE), "ORG_NO_ORGD": "1", "FOSSIL": FOSSIL, "PYTHONUTF8": "1"})
        env.pop("ORG_USER", None)
        with socket.socket() as dummy:
            dummy.bind(("127.0.0.1", 0))
            dummy.listen(1)
            env["ORG_PORT"] = str(dummy.getsockname()[1])
            shutil.rmtree(CHECKOUT, ignore_errors=True)  # force the check-out creation path
            first = subprocess.run([sys.executable, "-X", "utf8", str(GENESIS / "init.py")],
                           capture_output=True, text=True, encoding="utf-8", errors="replace",
                           cwd=str(REPO), env=env)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("check-out created", first.stdout)
            self.assertIn("forum caps granted", first.stdout)
            second = subprocess.run([sys.executable, "-X", "utf8", str(GENESIS / "init.py")],
                            capture_output=True, text=True, encoding="utf-8", errors="replace",
                            cwd=str(REPO), env=env)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("check-out present", second.stdout)
        self.assertIn("forum caps present", second.stdout)
        self.assertTrue(MARKER.exists(), "init.py must leave an open check-out")

        con = _db()
        try:
            caps = {row["login"]: row["cap"] for row in con.execute("SELECT login, cap FROM user")}
        finally:
            con.close()
        self.assertEqual(caps.get("claude"), "Cnrwcjfkm234", "the robot logins must carry the forum caps")
        self.assertTrue(set("234") <= set(caps.get(SMIT, "")), "an existing robot login must be granted the forum caps")
        self.assertEqual(caps.get(READER), "o", "a non-robot login must be left alone")

        protocol = run_cli("wiki", "Protocol")
        self.assertEqual(protocol.returncode, 0, protocol.stderr)
        self.assertIn("Where a problem goes", protocol.stdout, "init.py must publish the Protocol section")


if __name__ == "__main__":
    unittest.main(verbosity=2)
