"""Independently compare archive bytes with the staged or committed Git blobs."""

from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
revision = sys.argv[1] if len(sys.argv) > 1 else ""
paths = sorted(p for p in HERE.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
specs = [f"{revision}:{p.relative_to(ROOT).as_posix()}" for p in paths]
run = subprocess.run(["git", "cat-file", "--batch"], cwd=ROOT,
                     input=("\n".join(specs) + "\n").encode(),
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
offset = 0
for path in paths:
    end = run.stdout.index(b"\n", offset)
    header = run.stdout[offset:end].decode().split()
    if len(header) != 3 or header[1] != "blob":
        raise RuntimeError(f"Missing blob: {path}: {header}")
    size = int(header[2])
    blob = run.stdout[end + 1:end + 1 + size]
    if blob != path.read_bytes():
        raise RuntimeError(f"Byte mismatch: {path}")
    offset = end + size + 2
assert offset == len(run.stdout)
print(f"PASS: {len(paths)} archive files byte-identical to {revision or 'index'}")
