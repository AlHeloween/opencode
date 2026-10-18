"""A2 + review criteria 1/10 + HARNESS repair: real disposable Fossil fixtures.

HARNESS defect (root run 20261018T052824Z_c55ab9b6: fossil pid 33296 stalled on
`fossil user new robot robot@example.com` inside cmd_runner/ConPTY): the setup
subprocesses inherited the ConPTY stdin, so fossil's interactive password prompt
stalled the runner before a verdict could print. Repair — fixture only: every
Fossil subprocess gets stdin=DEVNULL and an explicit disposable password; no
real auth/config is touched. Also: vvar pointer verification, exact sv: label
match, prose mention never matches, AMBIGUOUS on repeated labels, huge comments
whole-or-omitted, cross-repo refuses, schema drift visible, SHA-unchanged reads."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

import helpers

FIXTURE_PASSWORD = "fixture-disposable-password"  # disposable repo only, never real auth


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checkout_db_path(checkout: Path) -> Path:
    for name in ("_FOSSIL_", ".fslckout"):
        candidate = checkout / name
        if candidate.is_file():
            return candidate
    raise AssertionError(f"no fossil checkout db in {checkout}")


class TestFossilProvenance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = helpers.module()
        if not helpers.FOSSIL_EXE.is_file():
            raise AssertionError(f"native fossil missing: {helpers.FOSSIL_EXE}")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.md5_a = "a" * 32
        self.md5_b = "b" * 32
        self.repo, self.checkout, self.env = self.make_repo(self.tmp / "repo1", self.md5_a, self.md5_b)

    def tearDown(self):
        self._tmp.cleanup()

    def make_repo(self, base: Path, md5_a: str, md5_b: str | None = None):
        base.mkdir(parents=True)
        repo = base / "fixture.fsl"
        checkout = base / "co"
        checkout.mkdir()
        home = base / "home"
        home.mkdir()
        env = dict(os.environ)
        env.update(
            {
                "HOME": str(home),
                "USERPROFILE": str(home),
                "APPDATA": str(home / "appdata"),
                "LOCALAPPDATA": str(home / "appdata"),
            }
        )

        def run(*args: str) -> None:
            proc = subprocess.run(
                [str(helpers.FOSSIL_EXE), *args],
                cwd=str(checkout),
                env=env,
                capture_output=True,
                text=True,
                timeout=120,
                stdin=subprocess.DEVNULL,  # a ConPTY-inherited prompt can never stall the runner
            )
            if proc.returncode != 0:
                raise AssertionError(
                    f"fossil {' '.join(args)} rc={proc.returncode}: {proc.stderr.strip()}"
                )

        run("init", str(repo))
        run("open", str(repo))
        # explicit disposable password+contact: `user new` must never prompt
        run("user", "new", "robot", "robot@example.com", FIXTURE_PASSWORD)
        run("user", "capabilities", "robot", "s")
        run("user", "default", "robot")
        (checkout / "a.txt").write_text("alpha", encoding="utf-8")
        run("add", "a.txt")
        run(
            "commit",
            "-m",
            f"auto-snapshot sv:{md5_a} dominant=alpha Keywords: alpha 1.0"
            f" md5: {md5_a} prev-md5: {helpers.ZERO} parent-goal-md5: {helpers.ZERO}",
        )
        if md5_b:
            (checkout / "b.txt").write_text("beta", encoding="utf-8")
            run("add", "b.txt")
            run(
                "commit",
                "-m",
                f"auto-snapshot sv:{md5_b} dominant=beta Keywords: beta 1.0"
                f" md5: {md5_b} prev-md5: {md5_a} parent-goal-md5: {helpers.ZERO}",
            )
        return repo, checkout, env

    def fossil(self, *args: str, cwd: Path) -> subprocess.CompletedProcess:
        return subprocess.run(
            [str(helpers.FOSSIL_EXE), *args],
            cwd=str(cwd),
            env=self.env,
            capture_output=True,
            text=True,
            timeout=120,
            stdin=subprocess.DEVNULL,  # same rule for every later fixture call
        )

    def test_checkout_db_is_sqlite_with_vvar_pointer(self):
        # criterion 1: _FOSSIL_ is an SQLite checkout db whose vvar table holds
        # name='repository' — the verified pointer, not a JSON {repo} file
        co_db = checkout_db_path(self.checkout)
        db = sqlite3.connect(f"file:{co_db.as_posix()}?mode=ro", uri=True)
        try:
            row = db.execute("SELECT value FROM vvar WHERE name = 'repository'").fetchone()
        finally:
            db.close()
        self.assertIsNotNone(row)
        self.assertEqual(Path(row[0]).resolve(), self.repo.resolve())

    def test_discovery_from_checkout_file(self):
        repo, note = self.module.discover_fossil_repo(self.checkout)
        self.assertIsNone(note)
        self.assertEqual(repo.resolve(), self.repo.resolve())

    def test_discovery_broken_pointer_visible(self):
        # a vvar pointer naming a missing repository is a visible error
        repo2, checkout2, _env = self.make_repo(self.tmp / "repo2", "d" * 32, None)
        co_db = checkout_db_path(checkout2)
        db = sqlite3.connect(co_db)
        try:
            db.execute("UPDATE vvar SET value = ? WHERE name = 'repository'", (str(self.tmp / "gone.fsl"),))
            db.commit()
        finally:
            db.close()
        repo, note = self.module.discover_fossil_repo(checkout2)
        self.assertIsNone(repo)
        self.assertIn("missing repository", note)

    def test_exact_label_match(self):
        result = self.module.fossil_lookup([self.md5_a], self.repo)
        self.assertEqual(result["status"], "MATCH")
        match = result["matches"][0]
        self.assertEqual(match["labels"], [self.md5_a])
        self.assertIn(f"sv:{self.md5_a}", match["comment"])
        self.assertIn("dominant=alpha", match["comment"])
        self.assertRegex(match["uuid"], r"^[0-9a-f]{40,64}$")  # SHA1 or SHA3-256 builds
        self.assertIn("sha256head16=", result["db_pin"])  # DB pin for the root

    def test_absent_label_no_match(self):
        result = self.module.fossil_lookup(["f" * 32], self.repo)
        self.assertEqual(result["status"], "NO_MATCH")

    def test_mention_without_sv_prefix_never_matches(self):
        (self.checkout / "c.txt").write_text("gamma", encoding="utf-8")
        proc = self.fossil("add", "c.txt", cwd=self.checkout)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.fossil(
            "commit", "-m", f"prose mention md5: {'c' * 32} without sv prefix", cwd=self.checkout
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = self.module.fossil_lookup(["c" * 32], self.repo)
        self.assertEqual(result["status"], "NO_MATCH")

    def test_multiple_checkins_per_label_ambiguous(self):
        # criterion 10: two check-ins carrying the SAME sv: label are AMBIGUOUS,
        # never one verified match
        (self.checkout / "d.txt").write_text("delta", encoding="utf-8")
        proc = self.fossil("add", "d.txt", cwd=self.checkout)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.fossil(
            "commit",
            "-m",
            f"auto-snapshot sv:{self.md5_a} dominant=alpha-again Keywords: alpha 1.0"
            f" md5: {self.md5_a} prev-md5: {helpers.ZERO} parent-goal-md5: {helpers.ZERO}",
            cwd=self.checkout,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = self.module.fossil_lookup([self.md5_a], self.repo)
        self.assertEqual(result["status"], "AMBIGUOUS")
        self.assertEqual(result["ambiguous_labels"], [self.md5_a])
        self.assertEqual(len(result["matches"]), 2)
        self.assertEqual(len({m["uuid"] for m in result["matches"]}), 2)  # two DISTINCT check-ins

    def test_huge_comment_whole_or_omitted_never_midcut(self):
        # criterion 2/10: a huge fossil comment is rendered whole or omitted with
        # its pin — never cut mid-text; the WHOLE context stays within budget
        message = self.tmp / "bigmsg.txt"
        comment = f"auto-snapshot sv:{self.md5_b} dominant=big " + "Ж" * 100_000
        message.write_text(comment, encoding="utf-8")
        (self.checkout / "e.txt").write_text("epsilon", encoding="utf-8")
        proc = self.fossil("add", "e.txt", cwd=self.checkout)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc = self.fossil("commit", "-M", str(message), cwd=self.checkout)
        self.assertEqual(proc.returncode, 0, proc.stderr)

        # a session whose current chain carries md5_b, restored against the repo
        transcript = self.tmp / "rollout-fossil.jsonl"
        helpers.write_transcript(
            transcript,
            [helpers.row("assistant", f"decision\n\n{helpers.sv_block(self.md5_b, helpers.ZERO)}")],
        )
        worktree = helpers.make_worktree(self.tmp, "wt-fossil")
        self.module.capture_pre_compact(helpers.event("ses-f", worktree, transcript))
        ctx = self.module.restore_context(
            helpers.event("ses-f", worktree), budget=32 * 1024, fossil_repository=self.repo
        )
        self.assertLessEqual(len(ctx.encode("utf-8")), 32 * 1024)
        self.assertTrue(
            f"comment: {comment}" in ctx or "comment omitted" in ctx,
            "the huge comment is whole or omitted-with-pin, never mid-cut",
        )
        self.assertNotIn("Ж" * 50000, ctx)  # no mid-cut rendering of a half comment

        # with the default budget the full comment is delivered whole
        ctx_full = self.module.restore_context(helpers.event("ses-f", worktree), fossil_repository=self.repo)
        self.assertIn(comment, ctx_full)

    def test_cross_repo_refuses(self):
        other_repo, _other_checkout, _env = self.make_repo(self.tmp / "repo3", "d" * 32, None)
        result = self.module.fossil_lookup([self.md5_a], other_repo)
        self.assertEqual(result["status"], "NO_MATCH")

    def test_schema_drift_visible(self):
        drift = self.tmp / "drift.fsl"
        db = sqlite3.connect(drift)
        db.execute("CREATE TABLE other (x INTEGER)")
        db.commit()
        db.close()
        result = self.module.fossil_lookup([self.md5_a], drift)
        self.assertEqual(result["status"], "SCHEMA_DRIFT")

    def test_discovery_without_checkout_visible(self):
        empty = self.tmp / "empty-wt"
        empty.mkdir()
        repo, note = self.module.discover_fossil_repo(empty)
        self.assertIsNone(repo)
        self.assertIn("no fossil checkout", note)

    def test_queries_leave_db_and_checkout_unchanged(self):
        co_db = checkout_db_path(self.checkout)
        before = (sha(self.repo), sha(co_db))
        self.module.fossil_lookup([self.md5_a, self.md5_b], self.repo)
        self.module.fossil_lookup(["f" * 32], self.repo)
        after = (sha(self.repo), sha(co_db))
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
