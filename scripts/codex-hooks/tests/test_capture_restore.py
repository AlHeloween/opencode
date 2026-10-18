"""A1 + review criteria 2/3/5/6 + overflow-boundary repair: byte-exact
capture/restore, WHOLE-context 256KiB cap with a MANDATORY overflow footer
(reserved first — the wayback never disappears at the cap), current-chain/
parent-goal relevance, full transcript paths, self-block non-reingestion,
unknown-schema refusal."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import helpers


class TestCaptureRestore(unittest.TestCase):
    def setUp(self):
        self.module = helpers.module()
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.worktree = helpers.make_worktree(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def open_store(self):
        return self.module.Store(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite")

    def build_fixture(self):
        decision = "DECISION: derived state goes to SQLite under codex_hook_* namespace."
        ground = "GROUND: two-plane storage rule; LMDB is for hot keyed state, not projections."
        filler = "filler line about the weather of the build 0123456789 " * 800  # > 40 KiB
        retraction = (
            "RETRACTION: the earlier LMDB projection idea is superseded — grounds: "
            "a projection is relational, see storage-paradigm."
        )
        vector_text = f"{retraction}\n\n{helpers.sv_block('b' * 32, 'a' * 32, dominant='retraction recorded')}"
        constraint = "CONSTRAINT: stdlib only, no new JSON runtime store."
        rows = [
            helpers.session_meta_row("ses-a"),
            helpers.row("user", f"TASK: implement codex hooks. {constraint}"),
            helpers.row("assistant", f"{decision}\n\n{ground}"),
            helpers.row("assistant", filler),
            helpers.row("assistant", vector_text),
        ]
        transcript = self.tmp / "rollout-fixture.jsonl"
        helpers.write_transcript(transcript, rows)
        with transcript.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write("{broken json row\n")  # genuinely malformed — json.dumps must not escape it
        return transcript, decision, ground, retraction, constraint, filler

    def test_capture_restore_keeps_decisions_byte_exact(self):
        transcript, decision, ground, retraction, constraint, filler = self.build_fixture()
        summary = self.module.capture_pre_compact(helpers.event("ses-a", self.worktree, transcript))
        self.assertEqual(summary["status"], "CAPTURED")
        self.assertEqual(summary["captured"], 4)  # user, decision, filler, vector record
        self.assertEqual(len(summary["anomalies"]), 1)  # the malformed row, visible

        ctx = self.module.restore_context(helpers.event("ses-a", self.worktree))
        self.assertIn("HISTORICAL EVIDENCE", ctx)
        self.assertIn(decision, ctx)  # the decision from the START survives
        self.assertIn(ground, ctx)
        self.assertIn(retraction, ctx)
        self.assertIn(constraint, ctx)
        self.assertIn("malformed JSONL row", ctx)  # anomaly rendered, never silent
        self.assertIn("[START]", ctx)  # chain edge over labels
        self.assertIn("sv=" + "b" * 32, ctx)
        self.assertIn(str(transcript.resolve()), ctx)  # FULL transcript path, not basename
        self.assertGreater(len(filler.encode("utf-8")), 40 * 1024)

        store = self.open_store()
        try:
            rows = store.db.execute(
                "SELECT text, line_address FROM codex_hook_capture WHERE session_id='ses-a' AND kind='assistant'"
            ).fetchall()
        finally:
            store.close()
        self.assertIn(filler, [r["text"] for r in rows])  # source byte-exact in storage
        for r in rows:
            self.assertTrue(r["line_address"].startswith(str(transcript.resolve()) + ":"))

    def test_other_session_gets_nothing(self):
        transcript, decision, *_rest = self.build_fixture()
        self.module.capture_pre_compact(helpers.event("ses-a", self.worktree, transcript))
        ctx = self.module.restore_context(helpers.event("ses-b", self.worktree))
        self.assertNotIn(decision, ctx)
        self.assertIn("captured_records=0", ctx)
        self.assertIn("NO_SV", ctx)

    def test_missing_sv_visible(self):
        transcript = self.tmp / "rollout-nosv.jsonl"
        helpers.write_transcript(
            transcript,
            [helpers.row("user", "hello"), helpers.row("assistant", "no vectors here")],
        )
        self.module.capture_pre_compact(helpers.event("ses-c", self.worktree, transcript))
        ctx = self.module.restore_context(helpers.event("ses-c", self.worktree))
        self.assertIn("NO_SV", ctx)
        self.assertIn("no vectors here", ctx)

    def test_overflow_footer_survives_exact_cap_boundary(self):
        # root oracle/overflow-boundary trial-16 (filler 261462 chars, ctx 262143,
        # footer gone): the mandatory footer/count/recall is RESERVED first inside
        # the cap, then whole records fill the rest — the wayback never disappears.
        # Fixture mirrors the trial's order: the oversized record is OLDER, the
        # big filler NEWER (newest-first selection includes the filler).
        transcript = self.tmp / "rollout-boundary.jsonl"
        oversized = "Z" * 5000  # cannot fit after the filler — excluded WHOLE
        filler = "B" * 258000  # fits under the reserved cap — included whole
        rows = [
            helpers.row("user", "CONSTRAINT-BOUNDARY: the wayback is mandatory."),
            helpers.row("assistant", oversized),
            helpers.row("assistant", filler),
        ]
        helpers.write_transcript(transcript, rows)
        self.module.capture_pre_compact(helpers.event("ses-boundary", self.worktree, transcript))
        ctx = self.module.restore_context(helpers.event("ses-boundary", self.worktree))
        self.assertLessEqual(len(ctx.encode("utf-8")), 256 * 1024)
        self.assertIn(filler, ctx)  # the big record itself included, byte-exact
        self.assertNotIn(oversized, ctx)  # excluded WHOLE, never mid-cut
        self.assertIn("== OVERFLOW (excluded whole records: 1)", ctx)  # footer AT the boundary
        self.assertIn("recall exactly with", ctx)
        self.assertIn("--after", ctx)
        self.assertIn("ses-boundary", ctx)  # the recall command names the session

    def test_whole_context_cap_with_big_overflow_and_unicode(self):
        # criterion 2: the cap covers the WHOLE additionalContext (headers, chain,
        # overflow index, anomalies included), records stay whole, unicode intact
        transcript = self.tmp / "rollout-cap.jsonl"
        unicode_record = "РЕШЕНИЕ: юникод-запись остаётся целой — 🚛 no mid-cut. " * 10
        rows = [
            helpers.row("user", "CONSTRAINT-CAP: newest constraint survives."),
            helpers.row("assistant", f"{unicode_record}\n\n{helpers.sv_block('e' * 32, helpers.ZERO)}"),
        ]
        for index in range(200):  # 200 × ~3 KiB ≈ 600 KiB — far over the cap
            rows.append(helpers.row("assistant", f"F{index} " + "п" * 3000))
        helpers.write_transcript(transcript, rows)
        self.module.capture_pre_compact(helpers.event("ses-cap", self.worktree, transcript))
        ctx = self.module.restore_context(helpers.event("ses-cap", self.worktree))
        self.assertLessEqual(len(ctx.encode("utf-8")), 256 * 1024)  # WHOLE context capped
        self.assertIn("CONSTRAINT-CAP", ctx)  # tier 1
        self.assertIn(unicode_record.strip().split()[0], ctx)  # unicode record whole
        self.assertIn("OVERFLOW (excluded whole records:", ctx)
        self.assertIn("recall exactly with", ctx)
        self.assertIn("--after", ctx)
        # the full inventory is reachable through the recall CLI
        proc = subprocess.run(
            [
                sys.executable,
                str(helpers.MODULE_DIR / "codex_hooks.py"),
                "recall",
                "--db",
                str(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite"),
                "--worktree",
                str(self.worktree),
                "--session",
                "ses-cap",
                "--after",
                "1",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("п" * 100, proc.stdout)  # excluded records reachable, whole

    def test_selection_current_chain_parent_goal_and_latest_constraints(self):
        # criterion 3: relevance = CURRENT chain + parent goal; having any SV is
        # not relevance; the latest constraint/retraction survives a >cap corpus.
        # The old-chain records are padded beyond any leftover budget so the
        # greedy walk can never sneak them in — the exclusion is deterministic.
        transcript = self.tmp / "rollout-sel.jsonl"
        old_chain_text = "OLD-CHAIN-DECISION: superseded topic A record."
        current_text = "CURRENT-CHAIN-DECISION: topic B record tied to the live chain."
        old_pad = "a" * 6000
        rows = [
            helpers.row("user", "OLD-CONSTRAINT: initial topic A constraint."),
            helpers.row("assistant", f"{old_chain_text}\n{old_pad}\n\n{helpers.sv_block('a1' * 16, helpers.ZERO, dominant='topic A start')}"),
            helpers.row("assistant", f"more A {old_pad}\n\n{helpers.sv_block('a2' * 16, 'a1' * 16, dominant='topic A end')}"),
        ]
        for index in range(30):  # 30 × ~5 KiB of filler — the budget cuts inside it
            rows.append(helpers.row("assistant", f"filler-{index} " + "x" * 5000))
        rows += [
            helpers.row("assistant", f"{current_text}\n\n{helpers.sv_block('b1' * 16, helpers.ZERO, dominant='topic B start')}"),
            helpers.row("assistant", f"more B\n\n{helpers.sv_block('b2' * 16, 'b1' * 16, dominant='topic B end')}"),
            helpers.row("user", "LATEST-RETRACTION: topic A is abandoned; topic B is current."),
        ]
        helpers.write_transcript(transcript, rows)
        self.module.capture_pre_compact(helpers.event("ses-sel", self.worktree, transcript))
        ctx = self.module.restore_context(helpers.event("ses-sel", self.worktree), budget=32 * 1024)
        self.assertLessEqual(len(ctx.encode("utf-8")), 32 * 1024)
        self.assertIn("LATEST-RETRACTION", ctx)  # newest constraint survives
        self.assertIn("OLD-CONSTRAINT", ctx)  # small enough to fit — chronology intact
        self.assertIn(current_text, ctx)  # current-chain records included
        self.assertNotIn(old_chain_text, ctx)  # old chain is NOT relevant — excluded whole
        self.assertIn("current_chain=2", ctx)  # b1, b2 walked by labels

    def test_self_block_not_reingested(self):
        # criterion 5: a re-capture after compaction must not fold the hook's own
        # injected historical context back into primary memory
        transcript, *_rest = self.build_fixture()
        self.module.capture_pre_compact(helpers.event("ses-a", self.worktree, transcript))
        ctx = self.module.restore_context(helpers.event("ses-a", self.worktree))
        post = self.tmp / "rollout-post.jsonl"
        helpers.write_transcript(post, [helpers.row("user", ctx)])  # Codex echoes the block
        summary = self.module.capture_pre_compact(helpers.event("ses-a", self.worktree, post))
        self.assertEqual(summary["captured"], 0)  # the self block was NOT captured
        problems = " ".join(a["problem"] for a in summary["anomalies"])
        self.assertIn("self-injected historical block", problems)
        store = self.open_store()
        try:
            count = store.db.execute(
                "SELECT COUNT(*) c FROM codex_hook_capture WHERE session_id='ses-a' AND text LIKE '%CODEX HOOKS | HISTORICAL EVIDENCE%'"
            ).fetchone()["c"]
        finally:
            store.close()
        self.assertEqual(count, 0)  # no geometric multiplication of primary memory

    def test_unknown_schema_visible_refusal(self):
        # criterion 6: an unfamiliar transcript schema is a visible refusal,
        # never a silent empty green
        transcript = self.tmp / "rollout-alien.jsonl"
        helpers.write_transcript(
            transcript,
            [{"type": "alien_record", "data": "unknown shape"}] * 5,
        )
        summary = self.module.capture_pre_compact(helpers.event("ses-x", self.worktree, transcript))
        self.assertEqual(summary["status"], "REFUSED_SCHEMA")
        ctx = self.module.restore_context(helpers.event("ses-x", self.worktree))
        self.assertIn("UNKNOWN_SCHEMA", ctx)

    def test_record_larger_than_budget_excluded_whole(self):
        transcript = self.tmp / "rollout-huge.jsonl"
        huge = "H" * 5000
        helpers.write_transcript(transcript, [helpers.row("assistant", huge)])
        self.module.capture_pre_compact(helpers.event("ses-e", self.worktree, transcript))
        ctx = self.module.restore_context(helpers.event("ses-e", self.worktree), budget=4096)
        self.assertLessEqual(len(ctx.encode("utf-8")), 4096)  # whole context capped
        self.assertNotIn(huge, ctx)  # never truncated mid-record
        self.assertIn("OVERFLOW (excluded whole records: 1)", ctx)
        proc = subprocess.run(
            [
                sys.executable,
                str(helpers.MODULE_DIR / "codex_hooks.py"),
                "recall",
                "--db",
                str(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite"),
                "--worktree",
                str(self.worktree),
                "--session",
                "ses-e",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn(huge, proc.stdout)  # recall returns the full record


if __name__ == "__main__":
    unittest.main()
