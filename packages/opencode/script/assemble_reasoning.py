#!/usr/bin/env python3
"""Assemble packages/opencode/src/session/prompt/reasoning.txt from topic fragments.

Source fragments live in:
  packages/opencode/src/session/prompt/reasoning/*.txt

Edit fragments, then run:
  python packages/opencode/script/assemble_reasoning.py

Or from packages/opencode:
  bun run (via build) / python ../../packages/opencode/script/assemble_reasoning.py

Fragments are concatenated in sorted filename order (00_, 01_, …).
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # packages/opencode
FRAG_DIR = ROOT / "src" / "session" / "prompt" / "reasoning"
OUT = ROOT / "src" / "session" / "prompt" / "reasoning.txt"


def assemble() -> str:
    files = sorted(FRAG_DIR.glob("*.txt"))
    if not files:
        raise SystemExit(f"no fragments in {FRAG_DIR}")
    parts: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        if not text.endswith("\n"):
            text += "\n"
        parts.append(text.rstrip("\n"))
    # Single blank line between fragment bodies; final newline.
    return "\n\n".join(parts) + "\n"


def main() -> None:
    body = assemble()
    OUT.write_text(body, encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({len(body)} bytes) from {len(list(FRAG_DIR.glob('*.txt')))} fragments")


if __name__ == "__main__":
    main()
