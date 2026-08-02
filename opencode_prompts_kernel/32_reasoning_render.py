"""Kernel fragment: 29_reasoning_render — assemble reasoning.txt from fragments.

Source fragments live in:
  packages/opencode/src/session/prompt/reasoning/*.txt

Fragments are concatenated in sorted filename order (00_, 01_, …).
Single blank line between fragment bodies; final newline.
"""
from __future__ import annotations

from pathlib import Path


def _default_fragment_dir() -> Path:
    """Resolve the fragment directory relative to the repo root."""
    # This file: opencode_prompts_kernel/29_reasoning_render.py
    # Fragments:  packages/opencode/src/session/prompt/reasoning/
    kernel_dir = Path(__file__).resolve().parent  # opencode_prompts_kernel/
    repo_root = kernel_dir.parent  # .../opencode/
    return repo_root / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning"


def _default_output() -> Path:
    """Default output path for reasoning.txt."""
    return _default_fragment_dir().parent / "reasoning.txt"


def assemble_reasoning(fragment_dir: Path | None = None) -> str:
    """Assemble reasoning.txt from topic fragments.

    Fragments are sorted by filename and joined with double-newline separators.
    Returns the assembled text (UTF-8, LF endings).
    """
    if fragment_dir is None:
        fragment_dir = _default_fragment_dir()

    files = sorted(fragment_dir.glob("*.txt"))
    if not files:
        raise FileNotFoundError(f"no fragments in {fragment_dir}")

    parts: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        if not text.endswith("\n"):
            text += "\n"
        parts.append(text.rstrip("\n"))

    return "\n\n".join(parts) + "\n"


def write_reasoning(output: Path | None = None, fragment_dir: Path | None = None) -> int:
    """Write reasoning.txt from fragments. Returns byte count written."""
    body = assemble_reasoning(fragment_dir)
    if output is None:
        output = _default_output()
    output.write_text(body, encoding="utf-8", newline="\n")
    return len(body)
