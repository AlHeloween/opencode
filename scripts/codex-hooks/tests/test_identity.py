"""Review criterion 9: identity refusals and session+worktree isolation on a
shared explicit DB — no 'unknown' shared bucket, no cross-worktree bleed,
degraded historical status only for old fixtures without session_meta."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import helpers


class TestIdentity(unittest.TestCase):
    def setUp(self):
        self.module = helpers.module()
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.worktree = helpers.make_worktree(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def test_missing_session_id_capture_refused(self):
        transcript = self.tmp / "rollout-nosid.jsonl"
        helpers.write_transcript(transcript, [helpers.row("user", "hello")])
        event = {"cwd": str(self.worktree), "transcript_path": str(transcript)}  # no session_id
        summary = self.module.capture_pre_compact(event)
        self.assertEqual(summary["status"], "REFUSED_NO_SESSION")
        store = self.module.Store(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite")
        try:
            count = store.db.execute(
                "SELECT COUNT(*) c FROM codex_hook_capture WHERE session_id = 'unknown'"
            ).fetchone()["c"]
        finally:
            store.close()
        self.assertEqual(count, 0)  # nothing lands in the shared bucket

    def test_missing_session_id_restore_refused(self):
        ctx = self.module.restore_context({"cwd": str(self.worktree)})
        self.assertIn("REFUSED", ctx)

    def test_session_meta_mismatch_refused(self):
        transcript = self.tmp / "rollout-foreign.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.session_meta_row("ses-OTHER"),
                helpers.row("user", "foreign content"),
            ],
        )
        summary = self.module.capture_pre_compact(
            helpers.event("ses-mine", self.worktree, transcript)
        )
        self.assertEqual(summary["status"], "REFUSED_IDENTITY")
        store = self.module.Store(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite")
        try:
            count = store.db.execute("SELECT COUNT(*) c FROM codex_hook_capture").fetchone()["c"]
        finally:
            store.close()
        self.assertEqual(count, 0)  # a runtime identity mismatch stores NOTHING

    def test_no_session_meta_degraded_but_captured(self):
        transcript = self.tmp / "rollout-old.jsonl"
        helpers.write_transcript(transcript, [helpers.row("user", "old fixture content")])
        summary = self.module.capture_pre_compact(helpers.event("ses-old", self.worktree, transcript))
        self.assertEqual(summary["status"], "CAPTURED")  # degraded historical status allowed
        problems = " ".join(a["problem"] for a in summary["anomalies"])
        self.assertIn("degraded historical status", problems)  # explicit, not silent
        ctx = self.module.restore_context(helpers.event("ses-old", self.worktree))
        self.assertIn("old fixture content", ctx)
        self.assertIn("degraded historical status", ctx)

    def test_shared_db_isolates_session_and_worktree(self):
        shared = self.tmp / "shared.sqlite"
        worktree_a = helpers.make_worktree(self.tmp, "wt-a")
        worktree_b = helpers.make_worktree(self.tmp, "wt-b")
        transcript_a = self.tmp / "rollout-a.jsonl"
        transcript_b = self.tmp / "rollout-b.jsonl"
        helpers.write_transcript(transcript_a, [helpers.row("user", "WORKTREE-A-ONLY content")])
        helpers.write_transcript(transcript_b, [helpers.row("user", "WORKTREE-B-ONLY content")])
        store = self.module.Store(shared)
        try:
            self.module.capture_pre_compact(helpers.event("ses-shared", worktree_a, transcript_a), store)
            self.module.capture_pre_compact(helpers.event("ses-shared", worktree_b, transcript_b), store)
            ctx_a = self.module.restore_context(helpers.event("ses-shared", worktree_a), store)
            ctx_b = self.module.restore_context(helpers.event("ses-shared", worktree_b), store)
        finally:
            store.close()
        self.assertIn("WORKTREE-A-ONLY", ctx_a)
        self.assertNotIn("WORKTREE-B-ONLY", ctx_a)
        self.assertIn("WORKTREE-B-ONLY", ctx_b)
        self.assertNotIn("WORKTREE-A-ONLY", ctx_b)


if __name__ == "__main__":
    unittest.main()
