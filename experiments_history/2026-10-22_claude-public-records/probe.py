"""Bounded, tools-disabled benign Claude comparison and Codex isolation inspection."""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLAUDE = Path(r"C:\Users\Alexander\.local\bin\claude.exe")
CODEX = Path(r"D:\zPython\_coding_agents\codex.exe")


def execute(name, argv, cwd, prompt, timeout):
    started = time.time()
    try:
        result = subprocess.run(argv, input=prompt, cwd=cwd, capture_output=True, timeout=timeout)
        stdout, stderr, code = result.stdout, result.stderr, result.returncode
        outcome = "completed"
    except subprocess.TimeoutExpired as error:
        stdout, stderr, code = error.stdout or b"", error.stderr or b"", None
        outcome = "timeout"
    (HERE / (name + ".stdout.jsonl")).write_bytes(stdout)
    (HERE / (name + ".stderr.log")).write_bytes(stderr)
    receipt = {"name": name, "status": outcome, "exitCode": code, "elapsedSeconds": time.time() - started,
               "argv": argv, "cwd": str(cwd), "stdoutBytes": len(stdout), "stderrBytes": len(stderr)}
    (HERE / (name + ".receipt.json")).write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(receipt, ensure_ascii=False))


def main():
    mode = sys.argv[1]
    baseline_receipt = HERE / "claude-baseline.receipt.json"
    if mode == "candidate" and baseline_receipt.exists():
        workdir = Path(json.loads(baseline_receipt.read_text(encoding="utf-8"))["cwd"])
    else:
        workdir = Path(tempfile.mkdtemp(prefix="claude-public-records-"))
    if mode == "isolation":
        execute("codex-isolation", [str(CODEX), "debug", "prompt-input", "PUBLIC_RECORDS_ISOLATION_FIXTURE"], workdir,
                b"", 40)
        return
    fixture = json.loads((HERE / "fixture.json").read_text(encoding="utf-8"))
    options = [str(CLAUDE), "--safe-mode", "--print", "--tools", "", "--disable-slash-commands",
               "--strict-mcp-config", "--no-session-persistence", "--model", "claude-opus-5-5",
               "--max-turns", "1", "--output-format", "stream-json", "--include-partial-messages", "--verbose"]
    if mode == "candidate":
        options.extend(["--append-system-prompt-file", str(HERE / "claude-public-records-insert.txt")])
    elif mode != "baseline":
        raise ValueError(mode)
    execute("claude-" + mode, options, workdir, fixture["prompt"].encode("utf-8"), 150)


if __name__ == "__main__":
    main()
