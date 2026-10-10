"""test_wiki_put.py — the focused oracle for `org.py wiki-put` (plan W1, 2026-10-10).

Runs against a REAL isolated Fossil repository (`tempfile.mkdtemp`; no service, no production
ORG_HOME): every org.py call is a subprocess whose ORG_HOME/FOSSIL point at the fixture.
Reject cases assert the refusal AND that repository content is untouched (page digests + lock
files), never the exit code alone.

Contract under test (plans/2026-10-10_organization-wiki-and-reporting.md W1):
    wiki-put PAGE --file UTF8.md --expect-sha256 HASH|absent --user LOGIN
Canonical page content = strict UTF-8, LF line endings, one trailing newline; the sha256 is
taken over that canonical form — the same form a read-back yields (fossil's Windows wiki
export re-emits CRLF and guarantees the trailing newline, so both sides are pinned here).

Primitive facts this fixture relies on (qualified 2026-10-10, fossil 2.28 [52445a27f1], see
experiments/2026-10-10_organization-wiki/worker/qualify_fossil.py):
  * `fossil wiki create` / `commit` read the page body from stdin; `export` writes it to stdout.
  * `create` on an existing page and `commit` of a missing page exit non-zero with a message.
  * `wiki list` prints one page name per line; `timeline -t w` names the artifact hash.
  * the CLI does NOT enforce wiki capabilities for `-U` users: create/commit succeed even for a
    login lacking them (measured) — the capability guard must live in org.py itself.
  * user capabilities: `k` = wiki write, `f` = wiki create, `a`/`s` imply both (fossil
    src/login.c:1704-1727).
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
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

FIXTURE = Path(tempfile.mkdtemp(prefix="org-wiki-put-"))
os.environ["ORG_HOME"] = str(FIXTURE)
os.environ["FOSSIL"] = FOSSIL
os.environ.pop("ORG_USER", None)
os.environ.pop("ORG_SESSION", None)
sys.path.insert(0, str(GENESIS))
import org  # noqa: E402 — imported AFTER ORG_HOME is pinned: its constants must bind to the fixture

assert org.ORG == FIXTURE / "org.fossil", "fixture must own ORG — refusing to run against a production org"

SMIT = "smit-q"          # capabilities 'kf' — can create and update wiki pages
READER = "reader-q"      # capabilities 'o' — no wiki ability at all


def fossil(*args: str, user: str | None = None, data: bytes | None = None):
    cmd = [FOSSIL, *args, "-R", str(org.ORG)]
    if user:
        cmd += ["-U", user]
    return subprocess.run(cmd, input=data, capture_output=True)


def canon_bytes(raw: bytes) -> bytes:
    text = raw.decode("utf-8")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if text and not text.endswith("\n"):
        text += "\n"
    return text.encode("utf-8")


def digest_bytes(raw: bytes) -> str:
    return hashlib.sha256(canon_bytes(raw)).hexdigest()


def digest_of_page(page: str) -> str | None:
    out = fossil("wiki", "export", page)
    return digest_bytes(out.stdout) if out.returncode == 0 else None


def wiki_events(page: str) -> int:
    out = fossil("timeline", "-n", "80", "-t", "w")
    text = out.stdout.decode("utf-8", "replace")
    return sum(1 for line in text.splitlines() if f'wiki page "{page}"' in line)


def snapshot() -> dict:
    pages = {}
    listing = fossil("wiki", "list")
    for name in listing.stdout.decode("utf-8").splitlines():
        pages[name] = digest_of_page(name)
    locks = sorted(p.name for p in org.LOCKS.glob("*.lock")) if org.LOCKS.exists() else []
    return {"pages": pages, "locks": locks}


def run_cli(*args: str, extra_env: dict | None = None):
    env = dict(os.environ)
    env.pop("ORG_USER", None)
    env.pop("ORG_SESSION", None)
    env["ORG_HOME"] = str(FIXTURE)
    env["FOSSIL"] = FOSSIL
    env["PYTHONUTF8"] = "1"
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [sys.executable, "-X", "utf8", str(ORG_PY), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(REPO), env=env,
    )


def write_input(name: str, data: bytes) -> Path:
    path = FIXTURE / name
    path.write_bytes(data)
    return path


def setUpModule() -> None:
    out = subprocess.run([FOSSIL, "init", str(org.ORG)], capture_output=True)
    assert out.returncode == 0, out.stderr
    for login, caps in ((SMIT, "kf"), (READER, "o")):
        out = fossil("user", "new", login, data=b"s3cret\ns3cret\n")
        assert out.returncode == 0, (login, out.stderr)
        out = fossil("user", "capabilities", login, caps)
        assert out.returncode == 0, (login, caps, out.stderr)
    for page, body in (("Fixture-Page", b"fixture v1\n"), ("Stale-Page", b"stale v1\n"), ("Protocol", b"protocol fixture v1\n")):
        out = fossil("wiki", "create", page, user=SMIT, data=body)
        assert out.returncode == 0, (page, out.stderr)


def tearDownModule() -> None:
    shutil.rmtree(FIXTURE, ignore_errors=True)


class WikiPutTest(unittest.TestCase):
    maxDiff = None

    def reject(self, result, marker: str, before: dict) -> None:
        self.assertNotEqual(result.returncode, 0, msg=f"expected refusal, got: {result.stdout!r}")
        self.assertIn(marker, result.stderr.lower(), msg=f"refusal must name {marker!r}: {result.stderr!r}")
        self.assertEqual(snapshot(), before, msg="a refused call must not change the repository")

    # --- accepted paths -------------------------------------------------------------------

    def test_01_create_unicode_readback(self) -> None:
        page = "Юни-Кб"
        content = "Привет, мир 🌍\nвторой рядок\n"
        path = write_input("create.md", content.encode("utf-8"))
        result = run_cli("wiki-put", page, "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("created", result.stdout)
        digest = digest_bytes(content.encode("utf-8"))
        self.assertIn(f"sha256={digest}", result.stdout)
        self.assertRegex(result.stdout, r"address=[0-9a-f]{6,}")
        self.assertEqual(digest_of_page(page), digest)
        export = fossil("wiki", "export", page)
        self.assertEqual(canon_bytes(export.stdout), canon_bytes(content.encode("utf-8")))
        self.assertFalse(org.wiki_lock_path(page).exists())

    def test_02_update_readback(self) -> None:
        page = "Юни-Кб"
        current = digest_of_page(page)
        self.assertIsNotNone(current, "fixture chain: test_01 must have created the page")
        content = "Привет, мир 🌍\nвторой рядок\nтретий\n"
        path = write_input("update.md", content.encode("utf-8"))
        result = run_cli("wiki-put", page, "--file", str(path), "--expect-sha256", current, "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("updated", result.stdout)
        digest = digest_bytes(content.encode("utf-8"))
        self.assertIn(f"sha256={digest}", result.stdout)
        self.assertRegex(result.stdout, r"address=[0-9a-f]{6,}")
        self.assertEqual(digest_of_page(page), digest)

    def test_03_unchanged_is_idempotent(self) -> None:
        page = "Юни-Кб"
        current = digest_of_page(page)
        path = write_input("unchanged.md", (FIXTURE / "update.md").read_bytes())
        events_before = wiki_events(page)
        result = run_cli("wiki-put", page, "--file", str(path), "--expect-sha256", current, "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("unchanged", result.stdout)
        self.assertIn(f"sha256={current}", result.stdout)
        self.assertEqual(digest_of_page(page), current)
        self.assertEqual(wiki_events(page), events_before, "unchanged must not add a revision")
        self.assertFalse(org.wiki_lock_path(page).exists())

    # --- reject paths (refusal + untouched repository) ------------------------------------

    def test_04_stale_hash_rejected(self) -> None:
        page = "Stale-Page"
        stale = digest_of_page(page)
        v2 = write_input("stale-v2.md", b"stale v2\n")
        result = run_cli("wiki-put", page, "--file", str(v2), "--expect-sha256", stale, "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        fresh = digest_of_page(page)
        self.assertNotEqual(fresh, stale)
        before = snapshot()
        v3 = write_input("stale-v3.md", b"stale v3\n")
        result = run_cli("wiki-put", page, "--file", str(v3), "--expect-sha256", stale, "--user", SMIT)
        self.reject(result, "stale", before)
        self.assertEqual(digest_of_page(page), fresh, "the stale call must not write")
        self.assertFalse(org.wiki_lock_path(page).exists(), "the lock must be released on refusal")
        result = run_cli("wiki-put", page, "--file", str(v3), "--expect-sha256", fresh, "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(digest_of_page(page), digest_bytes(b"stale v3\n"))

    def test_05_absent_on_existing_rejected(self) -> None:
        before = snapshot()
        path = write_input("absent.md", b"never lands\n")
        result = run_cli("wiki-put", "Fixture-Page", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "already exists", before)

    def test_06_hash_on_missing_rejected(self) -> None:
        before = snapshot()
        path = write_input("missing.md", b"never lands\n")
        result = run_cli("wiki-put", "Ghost-Page", "--file", str(path), "--expect-sha256", "a" * 64, "--user", SMIT)
        self.reject(result, "does not exist", before)
        self.assertIsNone(digest_of_page("Ghost-Page"))

    def test_07_page_validation(self) -> None:
        before = snapshot()
        path = write_input("page.md", b"x\n")
        result = run_cli("wiki-put", "", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "empty", before)
        result = run_cli("wiki-put", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT, "--", "-x")
        self.reject(result, "option", before)
        result = run_cli("wiki-put", "Bad\x07Name", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "control", before)
        result = run_cli("wiki-put", "-x", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.assertNotEqual(result.returncode, 0, "a bare option-like page must be refused")
        self.assertEqual(snapshot(), before)

    def test_08_expect_hash_validation(self) -> None:
        before = snapshot()
        path = write_input("hash.md", b"x\n")
        for bad in ("deadbeef", "z" * 64, "A" * 64):
            result = run_cli("wiki-put", "Kb-Uni", "--file", str(path), "--expect-sha256", bad, "--user", SMIT)
            self.reject(result, "hex", before)
        result = run_cli("wiki-put", "Kb-Uni", "--file", str(path), "--user", SMIT)
        self.reject(result, "required", before)          # --expect-sha256 is mandatory
        result = run_cli("wiki-put", "Kb-Uni", "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "required", before)          # --file is mandatory

    def test_09_missing_user_and_file(self) -> None:
        before = snapshot()
        path = write_input("user.md", b"x\n")
        result = run_cli("wiki-put", "Kb-Uni", "--file", str(path), "--expect-sha256", "absent")
        self.reject(result, "user is required", before)
        result = run_cli("wiki-put", "Kb-Uni", "--file", str(FIXTURE / "no-such-file.md"), "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "cannot read", before)

    def test_10_unknown_login_rejected(self) -> None:
        before = snapshot()
        path = write_input("ghost.md", b"x\n")
        result = run_cli("wiki-put", "New-For-Ghost", "--file", str(path), "--expect-sha256", "absent", "--user", "ghost-q")
        self.reject(result, "no such user", before)

    def test_11_login_without_capability_rejected(self) -> None:
        before = snapshot()
        path = write_input("cap.md", b"cap content\n")
        result = run_cli("wiki-put", "New-For-Reader", "--file", str(path), "--expect-sha256", "absent", "--user", READER)
        self.reject(result, "capability", before)
        result = run_cli("wiki-put", "Fixture-Page", "--file", str(path), "--expect-sha256", digest_of_page("Fixture-Page"), "--user", READER)
        self.reject(result, "capability", before)
        caps = fossil("user", "capabilities", READER)
        self.assertEqual(caps.stdout.strip(), b"o", "the refusal must not change the login's capabilities")

    def test_12_invalid_utf8_rejected(self) -> None:
        before = snapshot()
        path = write_input("bad-utf8.md", b"\xff\xfe\x00bad\n")
        result = run_cli("wiki-put", "Utf8-Page", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "utf-8", before)

    def test_13_protocol_protected(self) -> None:
        before = snapshot()
        path = write_input("protocol.md", b"new protocol body\n")
        result = run_cli("wiki-put", "Protocol", "--file", str(path), "--expect-sha256", digest_of_page("Protocol"), "--user", SMIT)
        self.reject(result, "protected", before)
        result = run_cli("wiki-put", "Protocol", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "protected", before)
        result = run_cli("wiki-put", "protocol", "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.reject(result, "protected", before)
        self.assertIsNotNone(digest_of_page("Protocol"))

    def test_14_lock_contention_and_cleanup(self) -> None:
        page = "Lock-Page"
        path = write_input("lock.md", b"lock content\n")
        lock = org.wiki_lock_path(page)
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text("held by test", encoding="ascii")
        try:
            before = snapshot()
            result = run_cli("wiki-put", page, "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
            self.reject(result, "locked", before)
            self.assertIsNone(digest_of_page(page), "a locked call must not create the page")
        finally:
            lock.unlink(missing_ok=True)
        result = run_cli("wiki-put", page, "--file", str(path), "--expect-sha256", "absent", "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(lock.exists(), "the lock must not persist after success")
        # an error path after acquisition must release the lock too
        v2 = write_input("lock-v2.md", b"lock content v2\n")
        result = run_cli("wiki-put", page, "--file", str(v2), "--expect-sha256", "0" * 64, "--user", SMIT)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stale", result.stderr.lower())
        self.assertFalse(lock.exists(), "the lock must be released after an error")
        result = run_cli("wiki-put", page, "--file", str(v2), "--expect-sha256", digest_of_page(page), "--user", SMIT)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_15_fossil_nonzero_rejected(self) -> None:
        before = snapshot()
        path = write_input("fossil.md", b"never lands\n")
        # sys.executable IS an existing executable that exits non-zero for argv[1]="wiki":
        # a real subprocess failure without touching the fixture tooling.
        result = run_cli("wiki-put", "Fixture-Page", "--file", str(path), "--expect-sha256", digest_of_page("Fixture-Page"),
                         "--user", SMIT, extra_env={"FOSSIL": sys.executable})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("fossil", result.stderr.lower())
        self.assertIn("failed", result.stderr.lower())
        self.assertEqual(snapshot(), before, "a fossil failure must leave the repository untouched")
        self.assertFalse(org.wiki_lock_path("Fixture-Page").exists(), "a fossil failure must release the lock")


if __name__ == "__main__":
    unittest.main(verbosity=2)
