"""Start the dist candidate with the owner's provider credentials REMOVED from the child env.

Only the NAMES of the stripped variables are printed, never their values
(AGENTS.md § TUI Testing, owner 2026-10-08).

Run through cmd_runner:
    cmd_runner start -- python experiments/2026-10-08_messages-401/start_candidate.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKTREE = Path(__file__).resolve().parent / "dist-worktree"
EXE = ROOT / "dist" / "bin" / "opencode.exe"

SUFFIXES = ("_API_KEY", "_TOKEN", "_SECRET")
stripped = sorted(name for name in os.environ if name.endswith(SUFFIXES))
for name in stripped:
    os.environ.pop(name, None)
print(f"stripped env names (values never read): {', '.join(stripped) if stripped else 'none'}", flush=True)

args = [str(EXE), "serve", "--port", "0", "--hostname", "127.0.0.1"]
print(f"candidate: {EXE} (exists={EXE.exists()})", flush=True)
print(f"args: serve --port 0 --hostname 127.0.0.1  cwd={WORKTREE}", flush=True)
sys.exit(subprocess.call(args, cwd=str(WORKTREE)))
