"""Retain complete run evidence and byte-exact source pins; never rewrite source."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path("D:/zPython/opencode").resolve()
HERE = Path(__file__).resolve().parent
RUNS = [
    "20261015T101555Z_f6b18592", "20261015T101556Z_dca11302", "20261015T101715Z_e11ec2df",
    "20261015T102213Z_1cbce811", "20261015T102303Z_2fdb7fb9", "20261015T102949Z_5055f8b3",
    "20261015T103026Z_bace854e", "20261015T103138Z_16166578", "20261015T103301Z_138a1643",
    "20261015T103325Z_5a08d731", "20261015T103326Z_5012cd3c", "20261015T103405Z_5e0cf1ac",
    "20261015T103419Z_0b24c085", "20261015T103420Z_2de151fa", "20261015T103523Z_9157d034",
    "20261015T103553Z_1e6a5f96", "20261015T103731Z_5ae1ccc8", "20261015T103732Z_6d0c5b33",
    "20261015T103742Z_31c20532", "20261015T103846Z_72ca57b9", "20261015T103922Z_deb034e7",
    "20261015T103923Z_1383470c", "20261015T103945Z_05401cd5", "20261015T103946Z_e9c799b9",
    "20261015T104030Z_5e7324d9", "20261015T104038Z_a7d6630b", "20261015T104233Z_6d606fc3",
    "20261015T104234Z_309bcef9",
    "20261015T104416Z_1202d8cc", "20261015T104649Z_3ebb3aa3",
]
SOURCES = [
    "packages/opencode/src/session/prompt.ts", "packages/opencode/src/session/status.ts",
    "packages/opencode/src/session/graph-prebuild.ts", "packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx",
    "packages/opencode/src/cli/cmd/tui/plugin/slots.tsx", "packages/opencode/test/cli/tui/session-live-text-fixture.tsx",
    "packages/opencode/src/cli/cmd/tui/context/sync.tsx",
    "packages/opencode/test/server/httpapi-prompt-start.test.ts", "packages/opencode/test/session/graph-prebuild-progress.test.ts",
    "packages/opencode/test/mcp/fixture/held-graph-server.ts", "packages/opencode/test/mcp/fixture/held-graph-sync.ts",
    "packages/sdk/js/src/gen/types.gen.ts", "packages/sdk/js/src/v2/gen/types.gen.ts",
]
if len(sys.argv) > 1:
    RUNS.extend(sys.argv[1:])
summary = []
for run_id in RUNS:
    run = ROOT / "logs/cmd_runner" / run_id
    state = json.loads((run / "state.json").read_text(encoding="utf-8"))
    if state["status"] not in ("finished", "stopped", "timeout"):
        raise SystemExit(f"Run is not terminal: {run_id}")
    if state["log"]["bytes_dropped"] or state["log"]["truncated"]:
        raise SystemExit(f"Incomplete log: {run_id}")
    target = HERE / "runs" / run_id
    target.mkdir(parents=True, exist_ok=True)
    for name in ("state.json", "stdout_text.log"):
        shutil.copyfile(run / name, target / name)
    log = (run / "stdout_text.log").read_text(encoding="utf-8", errors="strict")
    summary.append({"run": run_id, "exit_code": state["exit_code"], "status": state["status"],
                    "bytes": (run / "stdout_text.log").stat().st_size,
                    "result_lines": [line for line in log.splitlines() if any(word in line for word in
                                      (" pass", " fail", "error TS", "[OK]", "Smoke", "Version", "version:", "10.0."))]})
(HERE / "run-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
for name in SOURCES:
    target = HERE / "source-pins" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / name, target)
(HERE / ".gitattributes").write_text("* -text -whitespace\n", encoding="utf-8")
manifest = []
for file in sorted(HERE.rglob("*")):
    if not file.is_file() or file.name == "manifest.json":
        continue
    blob = file.read_bytes()
    manifest.append({"path": file.relative_to(HERE).as_posix(), "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()})
(HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"runs": len(summary), "files": len(manifest), "source_pins": len(SOURCES)}))
