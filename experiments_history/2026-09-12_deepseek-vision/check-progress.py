"""Report whether the read-back output file is still growing.

A single API call with no client timeout can hang indefinitely. This distinguishes
"the model is still thinking" (file grows) from "the request is stuck" (file static),
so the decision to wait or to kill is made on evidence.

Run: python experiments/2026-09-12_deepseek-vision/check-progress.py
"""

from __future__ import annotations

import pathlib
import time

DIR = pathlib.Path(__file__).resolve().parent / "glm-test"
FILES = ["READBACK.md", "RUNNING.lock"]

lines = [f"now = {time.strftime('%H:%M:%S')}", ""]
for name in FILES:
    path = DIR / name
    if not path.exists():
        lines.append(f"{name}: missing")
        continue
    stat = path.stat()
    age = time.time() - stat.st_mtime
    lines.append(
        f"{name}: {stat.st_size} bytes, mtime {time.strftime('%H:%M:%S', time.localtime(stat.st_mtime))}, "
        f"age {age:.0f}s, last line: {path.read_text(encoding='utf-8', errors='replace').strip().splitlines()[-1][:120] if path.stat().st_size else '(empty)'}"
    )

(DIR / "PROGRESS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
