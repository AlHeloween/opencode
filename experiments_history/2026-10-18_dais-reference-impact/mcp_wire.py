"""Bounded raw newline JSON-RPC pipe client; no MCP SDK or product imports."""
import base64
import json
import pathlib
import queue
import subprocess
import threading
import time


class WireError(RuntimeError):
    pass


class Client:
    def __init__(self, argv, transcript, timeout=30, frame_bytes=2 << 20, total_bytes=64 << 20):
        self.argv = list(map(str, argv))
        self.timeout = timeout
        self.frame_bytes = frame_bytes
        self.total_bytes = total_bytes
        self.bytes = 0
        self.counter = 0
        self.events = queue.Queue()
        self.lock = threading.Lock()
        self.transcript = pathlib.Path(transcript).open("xb")
        self.proc = subprocess.Popen(self.argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.record("process", json.dumps({"argv": self.argv, "pid": self.proc.pid}).encode())
        self.readers = [threading.Thread(target=self.read_stdout, daemon=True), threading.Thread(target=self.read_stderr, daemon=True)]
        for thread in self.readers:
            thread.start()
        self.closed = False

    def record(self, direction, data):
        with self.lock:
            self.bytes += len(data)
            if self.bytes > self.total_bytes:
                self.proc.kill()
                raise WireError("wire transcript total bound exceeded; run incomplete")
            entry = {"direction": direction, "time_monotonic_ns": time.monotonic_ns(), "bytes": len(data), "base64": base64.b64encode(data).decode("ascii")}
            self.transcript.write(json.dumps(entry, separators=(",", ":")).encode() + b"\n")
            self.transcript.flush()

    def read_stdout(self):
        try:
            while True:
                raw = self.proc.stdout.readline(self.frame_bytes + 1)
                if not raw:
                    self.events.put(("eof", None))
                    return
                self.record("stdout", raw)
                if len(raw) > self.frame_bytes or not raw.endswith(b"\n"):
                    raise WireError("stdout frame is oversized or lacks newline")
                value = json.loads(raw.decode("utf-8"))
                if not isinstance(value, dict) or value.get("jsonrpc") != "2.0":
                    raise WireError("stdout is not a JSON-RPC 2.0 object")
                self.events.put(("message", value))
        except Exception as error:
            self.events.put(("error", str(error)))

    def read_stderr(self):
        try:
            while True:
                raw = self.proc.stderr.read(4096)
                if not raw:
                    return
                self.record("stderr", raw)
        except Exception as error:
            self.events.put(("error", str(error)))

    def send_raw(self, raw):
        if len(raw) > self.frame_bytes:
            raise WireError("outbound frame exceeds client bound")
        self.record("stdin", raw)
        self.proc.stdin.write(raw)
        self.proc.stdin.flush()

    def send(self, value):
        self.send_raw(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")

    def request(self, method, params=None):
        self.counter += 1
        request_id = self.counter
        value = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            value["params"] = params
        self.send(value)
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                kind, response = self.events.get(timeout=max(0.001, deadline - time.monotonic()))
            except queue.Empty as error:
                raise WireError("response timeout: " + method) from error
            if kind != "message":
                raise WireError(f"{method}: {kind}: {response}")
            if "method" in response:
                if response["method"] == "ping" and "id" in response:
                    self.send({"jsonrpc": "2.0", "id": response["id"], "result": {}})
                elif "id" in response:
                    raise WireError("unexpected server request " + response["method"])
                continue
            if response.get("id") != request_id:
                raise WireError("response id mismatch")
            if ("result" in response) == ("error" in response):
                raise WireError("response must contain result or error")
            return response

    def initialize(self):
        response = self.request("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "independent-python-wire", "version": "1"}})
        if "error" in response or response["result"].get("protocolVersion") != "2025-11-25":
            raise WireError("initialize negotiation failed: " + str(response))
        self.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return response["result"]

    def call(self, name, arguments):
        return self.request("tools/call", {"name": name, "arguments": arguments})

    def wait_eof(self, timeout=15):
        deadline = time.monotonic() + timeout
        while True:
            try:
                kind, value = self.events.get(timeout=max(0.001, deadline - time.monotonic()))
            except queue.Empty as error:
                raise WireError("expected bounded EOF was not observed") from error
            if kind == "eof":
                return
            if kind == "error":
                raise WireError(str(value))
            if "error" not in value:
                raise WireError("oversize input unexpectedly produced successful response")

    def close(self, timeout=15):
        if self.closed:
            return self.proc.returncode
        forced = False
        try:
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
            try:
                code = self.proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                forced = True
                self.proc.kill()
                code = self.proc.wait(timeout=5)
            for thread in self.readers:
                thread.join(timeout=3)
            if any(thread.is_alive() for thread in self.readers):
                raise WireError("pipe reader did not finish")
            self.record("exit", json.dumps({"exit_code": code, "forced": forced}).encode())
            if forced:
                raise WireError("EOF failed to stop child within bound")
            return code
        finally:
            self.closed = True
            self.transcript.close()


def result(response):
    if "error" in response:
        raise WireError("protocol error: " + json.dumps(response["error"], ensure_ascii=False))
    value = response["result"]
    if value.get("isError"):
        raise WireError("tool error: " + json.dumps(value, ensure_ascii=False))
    return value


def structured(response):
    value = result(response)
    structured_value = value.get("structuredContent")
    texts = [item["text"] for item in value.get("content", []) if item.get("type") == "text"]
    if structured_value is None:
        if len(texts) != 1:
            raise WireError("expected exactly one JSON text content")
        return json.loads(texts[0])
    if len(texts) != 1 or json.loads(texts[0]) != structured_value:
        raise WireError("structured and text content disagree")
    return structured_value


def failure_kind(response):
    if "error" in response:
        return "protocol"
    if response.get("result", {}).get("isError"):
        return "tool"
    return None
