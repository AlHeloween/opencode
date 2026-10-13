"""READ-ONLY inventory of AGENTS.md (git HEAD version): sections + paragraph map.

Writes nothing except its own report file next to this script.
Usage: python experiments/2026-10-13_agents-md-split/inventory.py
"""
import re
import subprocess
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / "inventory.txt"

raw = subprocess.run(
    ["git", "show", "HEAD:AGENTS.md"], cwd=ROOT, capture_output=True
).stdout.decode("utf-8")
lines = raw.split("\n")

report = []
for i, l in enumerate(lines, 1):
    if re.match(r"^#{1,4} ", l):
        report.append(f"H {i:5d}: {l}")

report.append("-" * 72)

blocks = []
start = None
buf = []
for i, l in enumerate(lines, 1):
    if l.strip() == "":
        if buf:
            blocks.append((start, i - 1, "\n".join(buf)))
        buf = []
        start = None
        continue
    if start is None:
        start = i
    buf.append(l)
if buf:
    blocks.append((start, len(lines), "\n".join(buf)))

report.append(
    f"{len(blocks)} paragraphs, {len(lines)} lines, "
    f"{len(raw.encode('utf-8'))} bytes"
)
for idx, (a, b, t) in enumerate(blocks):
    n = re.sub(r"\s+", " ", t).strip()
    report.append(f"P{idx:03d} L{a}-{b} {len(n):5d} {n[:78]}")

OUT.write_text("\n".join(report) + "\n", encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(blocks)} paragraphs)")
