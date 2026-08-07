"""Tag reasoning fragment sections with @ANCHOR references.

Reads each fragment, adds @TAG to section headers that lack one,
deriving the tag from the header text.

Usage:
  python -m prompts_kernel.tools.tag_sections
  python -m prompts_kernel.tools.tag_sections --dry-run
"""
from __future__ import annotations

import re, sys
from pathlib import Path

FRAGMENTS_DIR = Path(__file__).resolve().parents[1] / "reasoning"
HEADER_RE = re.compile(r"^### (.+)$", re.MULTILINE)


def tag_name(header: str) -> str:
    """Derive @TAG from header text."""
    tag = header.strip().upper()
    tag = re.sub(r"[^A-Z0-9]+", "_", tag)
    tag = tag.strip("_")[:40]
    return tag


def tag_fragment(path: Path, dry: bool = False) -> int:
    """Add @TAG to untagged section headers. Returns count of tags added."""
    text = path.read_text(encoding="utf-8")
    added = 0

    def replacer(m: re.Match) -> str:
        nonlocal added
        header = m.group(1)
        if "@" in header:
            return m.group(0)
        tag = tag_name(header)
        added += 1
        return f"### {header.strip()} (@{tag})"

    new_text = HEADER_RE.sub(replacer, text)
    if added and not dry:
        path.write_text(new_text, encoding="utf-8", newline="\n")
    return added


def main() -> int:
    dry = "--dry-run" in sys.argv
    total = 0
    for fname in sorted(FRAGMENTS_DIR.glob("*.txt")):
        n = tag_fragment(fname, dry=dry)
        if n:
            label = "(dry)" if dry else "tagged"
            print(f"  {fname.name}: {n} sections {label}")
            total += n
    print(f"Total: {total} tags {'would be' if dry else 'added'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
