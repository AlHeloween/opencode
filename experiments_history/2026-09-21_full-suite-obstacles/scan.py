"""Read a cmd_runner run directory and say what a test run ACTUALLY did.

Why this exists: `cmd_runner tail` shows the last N lines, and a suite that
crashes prints its crash banner last — so the tail shows the crash and hides the
failure inventory. The whole log is small (measured: 40 652 B for a 945 s run,
bytes_dropped=0), so read ALL of it and classify.

Usage:
    python scan.py <run-id> [logs_dir]

Prints: run state, failure inventory classified TIMEOUT vs SEMANTIC, crash
detection, and whether an aggregate summary line is present at all.
"""

import io
import json
import os
import re
import sys

FAIL_MARK = "\u2717"  # ✗
CRASH = "oh no: Bun has crashed"
SUMMARY = re.compile(r"Ran \d+ tests?|^\s*\d+ (pass|fail)\b", re.M)


def read(path: str) -> str:
    return io.open(path, encoding="utf-8", errors="replace").read()


def main() -> int:
    run = sys.argv[1]
    logs_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join("logs", "cmd_runner")
    p = os.path.join(logs_dir, run) + os.sep

    state = json.load(io.open(p + "state.json", encoding="utf-8-sig"))
    text = read(p + "stdout_text.log")
    lines = text.splitlines()

    print("RUN      ", run)
    print("status   ", state.get("status"), "exit_code", state.get("exit_code"))
    print("window   ", state.get("started_utc"), "->", state.get("finished_utc"))
    log = state.get("log", {})
    print("log      ", "bytes", log.get("bytes_written"), "dropped", log.get("bytes_dropped"), "truncated", log.get("truncated"))
    print("argv     ", " ".join(state.get("argv", [])) if state.get("argv") else json.load(io.open(p + "meta.json", encoding="utf-8-sig")).get("argv"))

    # A failure marker is followed on the next line by its reason when it is a timeout.
    failures = []
    for i, line in enumerate(lines):
        if FAIL_MARK not in line:
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        kind = "TIMEOUT" if "timed out" in nxt else "SEMANTIC"
        failures.append((kind, line.strip()))

    timeouts = [f for f in failures if f[0] == "TIMEOUT"]
    semantic = [f for f in failures if f[0] == "SEMANTIC"]

    print()
    print("FAILURES ", len(failures), "= timeouts", len(timeouts), "+ semantic", len(semantic))
    for kind, line in failures:
        print(f"  [{kind:8}] {line}")

    # A run that crashes never prints the aggregate line — say so instead of guessing a count.
    m = SUMMARY.search(text)
    print()
    print("SUMMARY  ", m.group(0) if m else "ABSENT — no aggregate pass/fail line in the log")
    print("CRASH    ", "YES: " + CRASH if CRASH in text else "no")
    for line in lines:
        if line.startswith(("Elapsed:", "RSS:")):
            print("         ", line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
