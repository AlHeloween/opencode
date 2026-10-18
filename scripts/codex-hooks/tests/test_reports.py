"""A4 + review criteria 7 + final repair round: subagent reports — the child's
primary source is agent_transcript_path (never the parent); completion requires
an ACTUAL FINAL in the CURRENT child turn: a channel="final" assistant message
as the LAST message, no outstanding tool call ids, no errors. Commentary text
is kept as the observed report text but never counts as final; a new user turn
invalidates the previous final; a legacy transcript with NO channel field
anywhere qualifies EXPLICITLY (legacy-no-channel-marker), never silently green.
Idempotent duplicates, missing-receipt control EXPECTED_FAIL, one bounded Stop
reminder."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import helpers


class TestReports(unittest.TestCase):
    def setUp(self):
        self.module = helpers.module()
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.worktree = helpers.make_worktree(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def open_store(self):
        return self.module.Store(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite")

    def stop_event(self, transcript: Path | None, **extra):
        payload = helpers.event(
            "ses-r",
            self.worktree,
            hook_event_name="SubagentStop",
            agent="coder_agent",
            task="implement X",
            **extra,
        )
        if transcript is not None:
            payload["agent_transcript_path"] = str(transcript)  # the child's primary source
        return payload

    def completed_transcript(self, name: str) -> Path:
        transcript = self.tmp / name
        helpers.write_transcript(
            transcript,
            [
                helpers.row("user", "do X"),
                helpers.row("assistant", "FINAL: implemented X, tests pass.", channel="final"),
            ],
        )
        return transcript

    def open_report(self, report_id: str):
        store = self.open_store()
        try:
            report = store.db.execute(
                "SELECT * FROM codex_hook_report WHERE report_id=?", (report_id,)
            ).fetchone()
            receipt = store.db.execute(
                "SELECT * FROM codex_hook_receipt WHERE report_id=?", (report_id,)
            ).fetchone()
        finally:
            store.close()
        return report, receipt

    def test_completed_report_with_receipt(self):
        result = self.module.record_subagent_stop(self.stop_event(self.completed_transcript("done.jsonl")))
        self.assertTrue(result["completed"])
        self.assertEqual(result["basis"], "final-assistant-message")
        report, receipt = self.open_report(result["report_id"])
        self.assertIsNotNone(report)
        self.assertIn("FINAL: implemented X", report["final_message"])
        self.assertIn("done.jsonl", report["source_transcript"])
        self.assertIsNotNone(receipt)
        self.assertEqual(receipt["address"], result["address"])

    def test_commentary_only_cannot_complete(self):
        # core37 job-completed:incomplete — a channel=commentary message is
        # observed report text but NEVER a final
        transcript = self.tmp / "commentary.jsonl"
        helpers.write_transcript(
            transcript,
            [helpers.row("assistant", "progress note: still working", channel="commentary")],
        )
        result = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertFalse(result["completed"])
        self.assertEqual(result["basis"], "commentary-not-final")
        report, _receipt = self.open_report(result["report_id"])
        self.assertIn("progress note: still working", report["final_message"])  # text retained
        self.assertEqual(report["completed"], 0)

    def test_stale_final_invalidated_by_new_user(self):
        # edges13 incomplete:stale-final-new-user — a final assistant followed by
        # a NEW USER turn is not a completed execution
        transcript = self.tmp / "stale.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.row("user", "do X"),
                helpers.row("assistant", "FINAL: implemented X.", channel="final"),
                helpers.row("user", "now also do Y"),
            ],
        )
        result = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertFalse(result["completed"])
        self.assertEqual(result["basis"], "stale-final-new-user")

    def test_commentary_then_final_completes_with_final_text(self):
        transcript = self.tmp / "then-final.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.row("assistant", "working note", channel="commentary"),
                helpers.row("assistant", "FINAL: done.", channel="final"),
            ],
        )
        result = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertTrue(result["completed"])
        self.assertEqual(result["basis"], "final-assistant-message")
        report, _receipt = self.open_report(result["report_id"])
        self.assertEqual(report["final_message"], "FINAL: done.")

    def test_legacy_no_channel_marker_qualified_explicitly(self):
        # an old fixture with NO channel field anywhere qualifies EXPLICITLY —
        # it is never relaxed into the same bucket as commentary-green
        transcript = self.tmp / "legacy.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.row("user", "do X"),
                helpers.row("assistant", "FINAL: implemented X, tests pass."),
            ],
        )
        result = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertTrue(result["completed"])
        self.assertEqual(result["basis"], "final-assistant-message:legacy-no-channel-marker")

    def test_parent_transcript_never_read_as_child(self):
        # official payload carries the PARENT transcript_path; without
        # agent_transcript_path the report must NOT mine the parent for a final
        # message and must NOT complete
        parent_transcript = self.completed_transcript("parent.jsonl")
        event = helpers.event(
            "ses-r",
            self.worktree,
            parent_transcript,  # parent only — no agent_transcript_path
            hook_event_name="SubagentStop",
            agent="coder_agent",
        )
        result = self.module.record_subagent_stop(event)
        self.assertFalse(result["completed"])
        self.assertEqual(result["basis"], "no-child-transcript")
        report, _receipt = self.open_report(result["report_id"])
        self.assertIsNone(report["final_message"])  # no PARENT SENTINEL stored as child final
        self.assertNotIn("FINAL: implemented X", report["final_message"] or "")

    def test_outstanding_call_ids_block_completion(self):
        # commentary + TWO outstanding call ids + ONE result does NOT complete
        transcript = self.tmp / "outstanding.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.row("assistant", "commentary while working...", channel="commentary"),
                helpers.call_row("c1"),
                helpers.call_row("c2"),
                helpers.call_output_row("c1"),
            ],
        )
        result = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertFalse(result["completed"])
        self.assertEqual(result["basis"], "unfinished-tool-call")

    def test_unfinished_tool_call_cannot_complete(self):
        transcript = self.tmp / "pending.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.row("assistant", "working...", channel="commentary"),
                helpers.call_row("c1"),
            ],
        )
        result = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertFalse(result["completed"])
        self.assertEqual(result["basis"], "unfinished-tool-call")

    def test_error_case_differentiated(self):
        transcript = self.tmp / "error.jsonl"
        helpers.write_transcript(
            transcript,
            [
                helpers.row("assistant", "tried", channel="commentary"),
                helpers.call_row("c1"),
                helpers.call_output_row("c1", error="tool exploded"),
            ],
        )
        result = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertFalse(result["completed"])
        self.assertEqual(result["basis"], "error")
        report, _receipt = self.open_report(result["report_id"])
        self.assertIn("tool exploded", report["tool_errors"])

    def test_duplicate_event_idempotent(self):
        transcript = self.completed_transcript("dup.jsonl")
        first = self.module.record_subagent_stop(self.stop_event(transcript))
        second = self.module.record_subagent_stop(self.stop_event(transcript))
        self.assertEqual(first["report_id"], second["report_id"])
        store = self.open_store()
        try:
            reports = store.db.execute("SELECT COUNT(*) c FROM codex_hook_report").fetchone()["c"]
            receipts = store.db.execute("SELECT COUNT(*) c FROM codex_hook_receipt").fetchone()["c"]
        finally:
            store.close()
        self.assertEqual(reports, 1)
        self.assertEqual(receipts, 1)

    def test_missing_receipt_control_expected_fail(self):
        # control: a receipt for a never-recorded report must not exist —
        # the lookup FAILS as predicted (EXPECTED_FAIL), it never invents one
        store = self.open_store()
        try:
            row = store.db.execute(
                "SELECT * FROM codex_hook_receipt WHERE report_id=?", ("deadbeef" * 4,)
            ).fetchone()
        finally:
            store.close()
        self.assertIsNone(row)

    def test_stop_reminder_once_then_pass(self):
        result = self.module.record_subagent_stop(self.stop_event(self.completed_transcript("rem.jsonl")))
        first = self.module.stop_reminder(helpers.event("ses-r", self.worktree, hook_event_name="Stop"))
        self.assertEqual(first.get("decision"), "block")
        self.assertIn("NOT acceptance", first["reason"])
        self.assertIn(result["address"], first["reason"])
        second = self.module.stop_reminder(helpers.event("ses-r", self.worktree, hook_event_name="Stop"))
        self.assertEqual(second, {"continue": True})  # no infinite re-prompts


if __name__ == "__main__":
    unittest.main()
