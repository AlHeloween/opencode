"""Bounded local-only prompt launch oracle."""
import os
from pathlib import Path
import subprocess
import sys
ROOT = Path("D:/zPython/opencode")
env = os.environ.copy()
for key in list(env):
    if key.upper().endswith(("_API_KEY", "_TOKEN", "_SECRET")) or key.upper() in ("OPENCODE_SERVER_PASSWORD", "OPENCODE_SERVER_USERNAME"):
        del env[key]
env["PROMPT_NOOP_EVIDENCE"] = str(Path(__file__).resolve().parent / sys.argv[1])
bun = "C:/Users/Alexander/AppData/Roaming/npm/node_modules/bun/bin/bun.exe"
cmd = [bun, "test", "test/server/httpapi-prompt-start.test.ts", "test/session/graph-prebuild-progress.test.ts"]
if sys.argv[1] == "format":
    cmd = [bun, str(ROOT / "node_modules/prettier/bin/prettier.cjs"), "--write",
           "src/session/graph-prebuild.ts", "test/server/httpapi-prompt-start.test.ts",
           "test/session/graph-prebuild-progress.test.ts", "test/mcp/fixture/held-graph-server.ts",
           "test/mcp/fixture/held-graph-sync.ts", "test/cli/tui/session-live-text-fixture.tsx"]
elif sys.argv[1] == "regression":
    cmd = [bun, "test", "test/cli/tui/session-live-text.test.ts", "test/effect/runner.test.ts", "test/session/graph-first.test.ts"]
elif sys.argv[1] == "graph-regression":
    cmd = [bun, "test", "test/session/prompt.test.ts", "-t", "graph pre-build"]
elif sys.argv[1] == "type-regression":
    cmd = [bun, "test", "test/tool/universalsearch.test.ts"]
print(cmd, flush=True)
raise SystemExit(subprocess.run(cmd, cwd=ROOT / "packages/opencode", env=env).returncode)
