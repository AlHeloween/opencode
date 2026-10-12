"""Compare saved evidence with the exact bytes staged or committed in Git."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
revision = sys.argv[1] if len(sys.argv) > 1 else ""
paths = sorted(path for path in HERE.iterdir() if path.is_file())
specs = [f"{revision}:{path.relative_to(ROOT).as_posix()}" for path in paths]
run = subprocess.run(["git", "cat-file", "--batch"], cwd=ROOT,
                     input=("\n".join(specs) + "\n").encode(),
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
offset = 0
checks = []
for path in paths:
    end = run.stdout.index(b"\n", offset)
    header = run.stdout[offset:end].decode().split()
    if len(header) != 3 or header[1] != "blob":
        raise RuntimeError(f"Missing Git blob: {path.name}: {header}")
    size = int(header[2])
    blob = run.stdout[end + 1:end + 1 + size]
    offset = end + 1 + size + 1
    raw = path.read_bytes()
    if raw != blob:
        raise RuntimeError(f"Git bytes differ: {path.name}")
    checks.append({"file": path.name, "bytes": size,
                   "sha256": hashlib.sha256(blob).hexdigest()})
assert offset == len(run.stdout)
print(json.dumps({"revision": revision or "index", "verified_files": len(checks),
                  "all_bytes_equal": True}, indent=2))
