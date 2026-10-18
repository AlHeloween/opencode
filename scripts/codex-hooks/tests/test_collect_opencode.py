"""A5 + review criteria 4/7/8: external OpenCode completion via a qualified
local HTTP fixture using the same client protocol. An absent status-map key IS
idle (set_idle removes the key) but only with a valid map + assistant checks;
a newer user turn is not complete; incomplete runs are saved with an address;
reports retain message ids/tools/errors/host identity and mark unavailable
fields explicitly. Only GET requests are ever sent (no prompt replay)."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import helpers


def make_handler(nonce, status_payload, messages_payload, seen):
    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.path)
            if self.path.startswith("/global/health"):
                self._json({"host": nonce})
            elif self.path.startswith("/session/status"):
                self._json(status_payload)
            elif "/message" in self.path:
                self._json(messages_payload)
            else:
                self.send_response(404)
                self.end_headers()

        def _json(self, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    return FixtureHandler


class FixtureHost:
    def __init__(self, nonce, status_payload, messages_payload):
        self.seen: list[str] = []
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), make_handler(nonce, status_payload, messages_payload, self.seen)
        )
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


def make_host_db(worktree: Path, url: str, nonce: str) -> None:
    db = sqlite3.connect(worktree / ".opencode" / "data" / "opencode.db")
    db.execute(
        "CREATE TABLE server_host (id TEXT PRIMARY KEY, url TEXT, pid INTEGER,"
        " nonce TEXT, token TEXT, time_started INTEGER)"
    )
    db.execute(
        "INSERT INTO server_host VALUES ('host', ?, 4321, ?, 'fixture-token', 1697600000000)",
        (url, nonce),
    )
    db.commit()
    db.close()


def assistant_message(reason=None, completed=None, error=None, texts=("FINAL: done",), msg_id="m-assist-1"):
    parts = []
    if reason is not None:
        parts.append({"type": "step-finish", "reason": reason})
    for text in texts:
        parts.append({"type": "text", "text": text})
    info = {"role": "assistant", "id": msg_id, "time": {"created": 1}}
    if completed is not None:
        info["time"]["completed"] = completed
    if error:
        info["error"] = error
    return {"info": info, "parts": parts}


def user_message(text="next task", msg_id="m-user-2"):
    return {"info": {"role": "user", "id": msg_id, "time": {"created": 2}}, "parts": [{"type": "text", "text": text}]}


class TestCollectOpencode(unittest.TestCase):
    def setUp(self):
        self.module = helpers.module()
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.worktree = helpers.make_worktree(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def open_report(self, db_path: str, report_id: str):
        store = self.module.Store(Path(db_path))
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

    def test_complete_yields_report_with_identity_and_unavailable_markers(self):
        with FixtureHost("nonce-1", {"ses-1": {"type": "idle"}}, [assistant_message(reason="stop", completed=42, texts=("PART ONE;", "PART TWO done"))]) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            result = self.module.collect_opencode("ses-1", self.worktree)
        self.assertEqual(result["status"], "COMPLETE")
        report, receipt = self.open_report(result["db"], result["report_id"])
        self.assertEqual(report["completed"], 1)
        self.assertIn("PART ONE;", report["final_message"])  # ALL final text parts kept
        self.assertIn("PART TWO done", report["final_message"])
        refs = json.loads(report["external_refs"])
        self.assertIn("m-assist-1", refs["message_ids"])  # message ids retained
        self.assertEqual(refs["host"]["url"], f"http://127.0.0.1:{fixture.port}")  # host identity
        self.assertEqual(refs["host"]["pid"], 4321)
        self.assertNotIn("fixture-token", report["external_refs"])  # auth never leaves the client
        self.assertIn("unavailable", report["changed_paths"])  # explicit, not verified-empty
        self.assertIn("unavailable", report["test_evidence"])
        self.assertIsNotNone(receipt)
        self.assertTrue(all(p.startswith(("/global/health", "/session/")) for p in fixture.seen))

    def test_absent_key_is_idle_when_map_valid(self):
        # criterion 4: set_idle REMOVES the session key — an absent key in a
        # valid status map is the idle state; the assistant checks still decide
        with FixtureHost("nonce-1", {}, [assistant_message(reason="stop", completed=42)]) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            result = self.module.collect_opencode("ses-1", self.worktree)
        self.assertEqual(result["status"], "COMPLETE")

    def test_invalid_status_map_refused(self):
        with FixtureHost("nonce-1", ["not", "a", "map"], [assistant_message(reason="stop", completed=42)]) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            result = self.module.collect_opencode("ses-1", self.worktree)
        self.assertEqual(result["status"], "NOT_COMPLETE")
        self.assertTrue(any("invalid /session/status" in reason for reason in result["reasons"]))

    def test_new_user_turn_not_complete(self):
        # criterion 7: a completed assistant followed by a NEW user turn is not done
        with FixtureHost(
            "nonce-1",
            {"ses-1": {"type": "idle"}},
            [assistant_message(reason="stop", completed=42), user_message()],
        ) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            result = self.module.collect_opencode("ses-1", self.worktree)
        self.assertEqual(result["status"], "NOT_COMPLETE")
        self.assertTrue(any("new user turn" in reason for reason in result["reasons"]))

    def test_idle_alone_not_complete_but_saved_with_address(self):
        # criterion 4: errors/history of incomplete runs are saved with an
        # address; no acceptance inferred
        with FixtureHost("nonce-1", {"ses-1": {"type": "idle"}}, [assistant_message(reason="stop")]) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            result = self.module.collect_opencode("ses-1", self.worktree)
        self.assertEqual(result["status"], "NOT_COMPLETE")
        self.assertTrue(any("time.completed" in reason for reason in result["reasons"]))
        self.assertIn("codex_hook_report", result["address"])
        report, receipt = self.open_report(
            str(self.worktree / ".opencode" / "data" / "codex-hooks.sqlite"), result["report_id"]
        )
        self.assertEqual(report["completed"], 0)
        self.assertIn("time.completed", report["errors"])  # the failure history is retained
        self.assertIsNotNone(receipt)

    def test_tool_calls_finish_not_complete(self):
        with FixtureHost("nonce-1", {"ses-1": {"type": "idle"}}, [assistant_message(reason="tool-calls", completed=42)]) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            result = self.module.collect_opencode("ses-1", self.worktree)
        self.assertEqual(result["status"], "NOT_COMPLETE")
        self.assertTrue(any("tool-calls" in reason for reason in result["reasons"]))

    def test_provider_error_not_complete(self):
        with FixtureHost("nonce-1", {"ses-1": {"type": "idle"}}, [assistant_message(reason="error", completed=42)]) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            result = self.module.collect_opencode("ses-1", self.worktree)
        self.assertEqual(result["status"], "NOT_COMPLETE")
        self.assertTrue(any("error" in reason for reason in result["reasons"]))

    def test_stale_host_refuses(self):
        opencode_host = helpers.host_module()
        with FixtureHost("other-nonce", {}, []) as fixture:
            make_host_db(self.worktree, f"http://127.0.0.1:{fixture.port}", "nonce-1")
            with self.assertRaises(opencode_host.HostError) as caught:
                self.module.collect_opencode("ses-1", self.worktree)
        self.assertIn("STALE", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
