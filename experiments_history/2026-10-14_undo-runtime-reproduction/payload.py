"""Run a bounded test/build payload with credential environment removed."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path("D:/zPython/opencode")
BUN = Path("C:/Users/Alexander/AppData/Roaming/npm/node_modules/bun/bin/bun.exe")
MODE = sys.argv[1]
environment = os.environ.copy()
removed = sorted(name for name in environment if name.upper().endswith(("_API_KEY", "_TOKEN", "_SECRET"))
                 or name.upper() in ("OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME"))
for name in removed:
    del environment[name]
print(json.dumps({"removed_environment_names": removed}), flush=True)
if MODE == "baseline":
    command = [str(BUN), "test", "test/session/session-undo-fossil.test.ts", "-t", "SU-1 single undo"]
elif MODE in ("probe", "ui"):
    command = [str(BUN), "test", str(Path(__file__).with_name("replay.test.ts"))]
    if MODE == "ui":
        environment["UNDO_UI_PROBE"] = "1"
elif MODE == "qualify-ui":
    command = [str(BUN), "test", str(Path(__file__).with_name("module-qualification.test.ts")), "--timeout", "20000"]
elif MODE == "render":
    command = [str(BUN), "run", str(Path(__file__).with_name("render-plan.ts"))]
elif MODE == "build":
    command = ["pwsh", "-NoProfile", "-File", str(ROOT / "_build.ps1")]
else:
    raise SystemExit(f"Unknown mode: {MODE}")
print(json.dumps({"mode": MODE, "command": command}), flush=True)
result = subprocess.run(command, cwd=str(ROOT if MODE == "build" else ROOT / "packages/opencode"), env=environment)
raise SystemExit(result.returncode)
