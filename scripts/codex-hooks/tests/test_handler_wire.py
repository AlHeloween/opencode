"""A3: official JSON hook contract via real subprocess stdin/stdout — valid
event JSON on stdout, diagnostics on stderr, pinned context budget,
>8500-char content delivered on SessionStart, PostCompact receipt-only."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import helpers

HOOK = helpers.MODULE_DIR / "codex_hooks.py"


class TestHandlerWire(unittest.TestCase):
    def setUp(self):
        self.module = helpers.module()
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.worktree = helpers.make_worktree(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def run_handler(self, event: dict) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(HOOK), "handler"],
            input=json.dumps(event).encode("utf-8"),
            capture_output=True,
            cwd=str(self.worktree),
            timeout=120,
        )

    def make_fixture(self, session: str):
        decision = "DECISION-WIRE: the wire contract delivers full primary records."
        filler = "wire filler 0123456789 " * 600  # ~13 KiB
        transcript = self.tmp / f"rollout-{session}.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.row("user", f"TASK-WIRE with {decision}"),
                helpers.row("assistant", f"{decision}\n{filler}"),
            ],
        )
        return transcript, decision

    def precompact_event(self, session: str, transcript: Path) -> dict:
        return {
            "hook_event_name": "PreCompact",
            "session_id": session,
            "cwd": str(self.worktree),
            "transcript_path": str(transcript),
        }

    def test_precompact_stdout_strict_event_json(self):
        transcript, _decision = self.make_fixture("ses-w")
        proc = self.run_handler(self.precompact_event("ses-w", transcript))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)  # exactly one JSON value on stdout
        self.assertTrue(out["continue"])
        self.assertIn("codex-hooks", proc.stderr.decode())  # diagnostics on stderr

    def test_sessionstart_context_exceeds_old_limit_within_budget(self):
        transcript, decision = self.make_fixture("ses-w")
        self.run_handler(self.precompact_event("ses-w", transcript))
        proc = self.run_handler(
            {
                "hook_event_name": "SessionStart",
                "session_id": "ses-w",
                "cwd": str(self.worktree),
                "source": "compact",
            }
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        ctx = out["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertGreater(len(ctx.encode("utf-8")), 8500)  # old fold_restore limit exceeded
        self.assertLessEqual(len(ctx.encode("utf-8")), 256 * 1024)  # pinned budget
        self.assertIn("HISTORICAL EVIDENCE", ctx)
        self.assertIn(decision, ctx)

    def test_postcompact_records_receipt_without_injection(self):
        # plan revision2: PostCompact only records the projection/capture receipt;
        # additionalContext is NOT promised on this event
        transcript, _decision = self.make_fixture("ses-p")
        self.run_handler(self.precompact_event("ses-p", transcript))
        proc = self.run_handler(
            {
                "hook_event_name": "PostCompact",
                "session_id": "ses-p",
                "cwd": str(self.worktree),
                "transcript_path": str(transcript),
                "source": "auto",
            }
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertEqual(out, {"continue": True})
        self.assertNotIn("hookSpecificOutput", out)
        store = self.module.Store(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite")
        try:
            count = store.db.execute(
                "SELECT COUNT(*) c FROM codex_hook_capture"
                " WHERE session_id='ses-p' AND kind='postcompact-receipt'"
            ).fetchone()["c"]
        finally:
            store.close()
        self.assertEqual(count, 1)

    def test_unknown_event_passthrough(self):
        proc = self.run_handler(
            {"hook_event_name": "SomethingElse", "session_id": "ses-x", "cwd": str(self.worktree)}
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = json.loads(proc.stdout)
        self.assertEqual(out, {"continue": True})

    def test_malformed_stdin_visible(self):
        proc = subprocess.run(
            [sys.executable, str(HOOK), "handler"],
            input=b"{broken",
            capture_output=True,
            cwd=str(self.worktree),
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0)
        out = json.loads(proc.stdout)
        self.assertTrue(out["continue"])
        self.assertIn("not valid JSON", proc.stderr.decode())


if __name__ == "__main__":
    unittest.main()
