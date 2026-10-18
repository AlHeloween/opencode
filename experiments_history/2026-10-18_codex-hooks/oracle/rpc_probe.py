"""Read-only installed Codex hooks/list probe, with bounded child lifetime."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import queue
import subprocess
import threading
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--executable", default="D:/zPython/_coding_agents/codex.exe")
    args = parser.parse_args()
    result = {"argv":[args.executable,"app-server","--stdio"],"cwd":args.cwd,"sent":[],"received":[],"stderr":""}
    child = subprocess.Popen(result["argv"],cwd=args.cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    incoming = queue.Queue()
    stderr = []
    def reader():
        for line in iter(child.stdout.readline,b""):
            incoming.put(line)
        incoming.put(None)
    def errors():
        stderr.append(child.stderr.read())
    stdout_thread = threading.Thread(target=reader,daemon=True)
    stderr_thread = threading.Thread(target=errors,daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    def send(value):
        result["sent"].append(value)
        child.stdin.write(json.dumps(value).encode()+b"\n")
        child.stdin.flush()
    def receive(request_id):
        deadline = time.monotonic()+20
        while time.monotonic()<deadline:
            line = incoming.get(timeout=max(.01,deadline-time.monotonic()))
            if line is None:
                raise RuntimeError("app-server closed before response")
            row = json.loads(line)
            result["received"].append(row)
            if row.get("id")==request_id:
                if "error" in row:
                    raise RuntimeError(row["error"])
                return row["result"]
        raise TimeoutError("app-server response deadline")
    try:
        send({"id":1,"method":"initialize","params":{"clientInfo":{"name":"codex-hook-independent-oracle","version":"1.0"},"capabilities":{"experimentalApi":True}}})
        result["initialize"] = receive(1)
        send({"method":"initialized"})
        send({"id":2,"method":"hooks/list","params":{"cwds":[args.cwd]}})
        result["hooks"] = receive(2)
        result["observation"] = "READ_ONLY_RESPONSE"
    except Exception as error:
        result["error"] = {"class":type(error).__name__,"message":str(error)}
    finally:
        child.stdin.close()
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.terminate()
            child.wait(timeout=3)
        stdout_thread.join(timeout=1)
        stderr_thread.join(timeout=1)
        result["stderr"] = b"".join(stderr).decode("utf-8",errors="replace")
        result["exit_code"] = child.returncode
        output = Path(args.output)
        output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps({"report":str(output),"sha256":hashlib.sha256(output.read_bytes()).hexdigest(),"response_received":"hooks" in result,"error":result.get("error"),"result_keys":list(result.get("hooks",{}))}))
    if "error" in result:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
