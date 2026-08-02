#!/usr/bin/env python3
"""Assemble reasoning.txt — delegates to opencode_prompts_kernel.

Canonical implementation: opencode_prompts_kernel.assemble_reasoning / write_reasoning.
This script is a thin CLI wrapper kept for build-system compatibility.
"""
from __future__ import annotations

from pathlib import Path

# Ensure the kernel package is importable from repo root
import sys
_repo_root = Path(__file__).resolve().parents[1]  # packages/opencode
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))


def main() -> None:
    from opencode_prompts_kernel import write_reasoning

    fragment_dir = (
        Path(__file__).resolve().parents[0]
        / ".." / "src" / "session" / "prompt" / "reasoning"
    ).resolve()
    output = fragment_dir.parent / "reasoning.txt"
    nbytes = write_reasoning(output=output, fragment_dir=fragment_dir)
    files = sorted(fragment_dir.glob("*.txt"))
    print(f"wrote {output} ({nbytes} bytes) from {len(files)} fragments")


if __name__ == "__main__":
    main()
