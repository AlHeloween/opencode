"""Requirement predicates exercised against a real, independent HTTP fixture."""

import contextlib
import http.server
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import cache_probe


TOKEN = "fixture-private-token"


class CacheServer(http.server.ThreadingHTTPServer):
    daemon_threads = True


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        now = time.monotonic()
        self.server.received.append((now, body, dict(self.headers)))
        mode = self.server.mode
        if mode == "timeout":
            time.sleep(0.08)
        status = 302 if mode == "redirect" else 400 if mode == "error" else 200
        hit = self.server.last is not None and now - self.server.last < 0.2 and mode != "nohit"
        self.server.last = now
        usage = {"prompt_tokens": 100, "prompt_tokens_details": {"cached_tokens": 80 if hit else 0}}
        payload = {"usage": usage, "echo": TOKEN, "choices": []}
        if mode == "missing":
            del payload["usage"]
        if mode == "boolean":
            usage["prompt_tokens_details"]["cached_tokens"] = True
        raw = json.dumps(payload).encode()
        if mode == "invalidjson":
            raw = b"invalid JSON"
        if mode == "oversize":
            raw = b"x" * (cache_probe.MAX_RESPONSE_BYTES + 2)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Location", "http://127.0.0.1:1/forbidden")
        self.send_header("Set-Cookie", TOKEN)
        self.send_header("x-cache-ttl", "60")
        self.send_header("x-opencode-cache-ttl-seconds", "120")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass


@contextlib.contextmanager
def fixture(mode="normal"):
    server = CacheServer(("127.0.0.1", 0), Handler)
    server.received, server.last, server.mode = [], None, mode
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.005})
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="кеш тест ")
        self.root = Path(self.temp.name)
        self.request = self.root / "запрос проба.json"
        self.body = '{"model":"fixture","max_tokens":4,"messages":[{"role":"user","content":"проверка"}]}\n'.encode()
        self.request.write_bytes(self.body)
        self.auth = self.root / "ключ.json"
        self.auth.write_text(json.dumps({"opencode-go": {"key": TOKEN}}))

    def tearDown(self):
        self.temp.cleanup()

    def args(self, endpoint="http://127.0.0.1:1/chat/completions", live=True, idle="0.3", timeout="1"):
        result = ["--request", str(self.request), "--endpoint", endpoint,
                  "--auth-file", str(self.auth), "--provider", "opencode-go",
                  "--idle-seconds", idle, "--timeout-seconds", timeout,
                  "--out", str(self.root / "отчёт")]
        return result + (["--live"] if live else [])

    def execute(self, server, **kwargs):
        code = cache_probe.main(self.args(f"http://127.0.0.1:{server.server_port}/chat/completions", **kwargs))
        report = json.loads((self.root / "отчёт" / "report.json").read_text())
        return code, report

    def test_cold_warm_expired_and_exact_wire_readback(self):
        with fixture() as server:
            code, report = self.execute(server)
            self.assertEqual(code, 0)
            self.assertEqual([r["cached_tokens"] for r in report["observations"]], [0, 80, 0])
            self.assertEqual(len(server.received), 3)
            self.assertTrue(all(r[1] == self.body for r in server.received))
            headers = [r[2] for r in server.received]
            for name in ["x-opencode-session", "x-opencode-project", "x-opencode-client", "x-session-id", "x-session-affinity", "User-Agent"]:
                self.assertEqual(len({h[name] for h in headers}), 1)
            self.assertEqual(len({h["x-request-id"] for h in headers}), 3)
            self.assertTrue(all(h["x-request-id"] == h["x-opencode-request"] for h in headers))
            self.assertTrue(all(h["Authorization"] == "Bearer " + TOKEN for h in headers))
            self.assertGreaterEqual(server.received[2][0] - server.received[1][0], 0.3)
            self.assertIsNone(report["measured_ttl_seconds"])
            self.assertGreaterEqual(report["observations"][2]["idle_seconds"], 0.3)
            self.assertEqual(headers[0]["x-opencode-client"], "cli")
            self.assertRegex(headers[0]["x-opencode-project"], r"^[0-9a-f]{40}$")

    def test_dry_run_does_not_connect_or_read_auth(self):
        self.auth.unlink()
        with patch("http.client.HTTPConnection.connect", side_effect=AssertionError("network forbidden")):
            self.assertEqual(cache_probe.main(self.args(live=False)), 0)
        report = json.loads((self.root / "отчёт" / "report.json").read_text())
        self.assertEqual(report["observations"], [])

    def test_missing_usage_is_unknown(self):
        with fixture("missing") as server:
            code, report = self.execute(server)
            self.assertNotEqual(code, 0)
            self.assertEqual(report["observations"][0]["status"], "unknown")
            self.assertEqual(len(server.received), 1)

    def test_boolean_usage_rejected(self):
        with fixture("boolean") as server:
            code, report = self.execute(server)
            self.assertNotEqual(code, 0)
            self.assertEqual(report["observations"][0]["status"], "unknown")

    def test_http_error_records_response_and_stops(self):
        with fixture("error") as server:
            code, report = self.execute(server)
            self.assertNotEqual(code, 0)
            self.assertEqual(report["observations"][0]["http_status"], 400)
            self.assertEqual(len(server.received), 1)
            self.assertTrue((self.root / "отчёт" / "01_response.bin").exists())

    def test_redirect_not_followed(self):
        with fixture("redirect") as server:
            code, report = self.execute(server)
            self.assertNotEqual(code, 0)
            self.assertEqual(report["observations"][0]["http_status"], 302)
            self.assertEqual(len(server.received), 1)

    def test_timeout_no_retry(self):
        with fixture("timeout") as server:
            code, report = self.execute(server, timeout="0.01")
            self.assertNotEqual(code, 0)
            self.assertEqual(len(server.received), 1)
            self.assertEqual(report["observations"][0]["status"], "unknown")

    def test_secret_redacted_in_all_outputs(self):
        with fixture() as server:
            code, report = self.execute(server)
            self.assertEqual(code, 0)
        for path in (self.root / "отчёт").iterdir():
            self.assertNotIn(TOKEN.encode(), path.read_bytes(), path.name)
        self.assertEqual(report["observations"][0]["advertised_cache_headers"],
                         {"x-cache-ttl": "60", "x-opencode-cache-ttl-seconds": "120"})

    def test_no_warm_hit_stops_without_sleep(self):
        with fixture("nohit") as server, patch("cache_probe.time.sleep", side_effect=AssertionError("must not sleep")):
            code, report = self.execute(server)
            self.assertEqual(code, 1)
            self.assertEqual(len(server.received), 2)
            self.assertEqual(report["state"], "failed")
            self.assertEqual([r["status"] for r in report["observations"]], ["observed_miss", "observed_miss"])

    def test_warm_receipts_persist_before_interruption_during_idle(self):
        def interrupt(seconds):
            report = json.loads((self.root / "отчёт" / "report.json").read_text())
            self.assertEqual(report["state"], "in_progress")
            self.assertEqual(len(report["observations"]), 2)
            self.assertEqual(report["observations"][1]["status"], "observed_hit")
            raise KeyboardInterrupt
        with fixture() as server, patch("cache_probe.time.sleep", side_effect=interrupt):
            code, report = self.execute(server)
            self.assertEqual(code, 130)
            self.assertEqual(report["state"], "interrupted")
            self.assertEqual(len(server.received), 2)

    def test_response_size_bound_and_invalid_json(self):
        for mode in ["oversize", "invalidjson"]:
            with self.subTest(mode=mode), fixture(mode) as server:
                self.assertNotEqual(cache_probe.main(self.args(
                    f"http://127.0.0.1:{server.server_port}/chat/completions")[:-3]
                    + ["--out", str(self.root / mode), "--live"]), 0)
                report = json.loads((self.root / mode / "report.json").read_text())
                self.assertEqual(report["state"], "failed")
                self.assertEqual(report["observations"][0]["status"], "unknown")
                self.assertEqual(len(server.received), 1)

    def test_malformed_auth_never_prints_token(self):
        self.auth.write_text('{"opencode-go":{"key":"' + TOKEN)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cache_probe.main(self.args()), 2)
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertFalse((self.root / "отчёт").exists())

    def test_idle_budget_rejected_before_network(self):
        for value in ["nan", "inf", "-1", "901"]:
            with self.subTest(value=value), patch("http.client.HTTPConnection.connect", side_effect=AssertionError("network forbidden")):
                self.assertNotEqual(cache_probe.main(self.args(idle=value)), 0)

    def test_output_budget_rejected(self):
        request = json.loads(self.body)
        for value in [129, True, 0]:
            request["max_tokens"] = value
            self.request.write_text(json.dumps(request))
            self.assertNotEqual(cache_probe.main(self.args(live=False)), 0)

    def test_endpoint_credentials_and_query_rejected(self):
        for endpoint in ["http://user:password@localhost/", "http://localhost/?token=secret", "ftp://localhost/"]:
            self.assertNotEqual(cache_probe.main(self.args(endpoint, live=False)), 0)


if __name__ == "__main__":
    unittest.main()
