"""Cross-reference tool: parse all name: definitions, find references, tag as @links.

1. Parse kernel for all "name: value" definitions
2. Scan kernel for occurrences of those names (not already @tagged)
3. Replace with @name links
4. Recursive: new @links become new names to search for

Usage:
  python -m prompts_kernel.tools.link_names
  python -m prompts_kernel.tools.link_names --dry-run
"""
from __future__ import annotations

import re, sys
from pathlib import Path
from collections import defaultdict

KERNEL_SRC = Path(__file__).resolve().parents[2] / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.mdc"
REASONING_DIR = Path(__file__).resolve().parents[1] / "reasoning"
CORE_SCHEMAS = Path(__file__).resolve().parents[1] / "core_schemas.yaml"

# Patterns
NAME_RE = re.compile(r"^\s+name:\s*\"?([A-Z][A-Z_ 0-9-]+)\"?", re.M)
WORD_RE = re.compile(r"\b([A-Z][A-Z_]{2,30})\b")  # ALL_CAPS words (potential refs)


def extract_names(text: str) -> set[str]:
    """Extract all name: definitions."""
    return {m.group(1).strip() for m in NAME_RE.finditer(text)}


def find_unlinked_refs(text: str, names: set[str]) -> dict[str, list[str]]:
    """Find occurrences of names that are NOT already @tagged.
    Returns {name: [surrounding_context, ...]}"""
    found = defaultdict(list)
    for name in sorted(names, key=len, reverse=True):  # long first to avoid partial
        # Already @name?
        if f"@{name}" in text:
            continue
        # Find as whole word, not inside @...
        pattern = re.compile(rf"(?<![@\w]){re.escape(name)}(?![\w])")
        for m in pattern.finditer(text):
            ctx = text[max(0, m.start()-20):m.end()+20]
            found[name].append(f"...{ctx}...")
    return dict(found)


def main() -> int:
    dry = "--dry-run" in sys.argv

    # Read all source fragments (pre-assembly)
    fragments = {}
    for f in sorted(REASONING_DIR.glob("*.txt")):
        fragments[f.name] = f.read_text(encoding="utf-8")

    schemas_text = CORE_SCHEMAS.read_text(encoding="utf-8")
    all_text = schemas_text + "\n".join(fragments.values())

    names = extract_names(all_text)
    print(f"Names defined: {len(names)}")
    for n in sorted(names):
        print(f"  {n}")

    # Check assembled kernel for unlinked references
    if KERNEL_SRC.exists():
        kernel = KERNEL_SRC.read_text(encoding="utf-8")
        unlinked = find_unlinked_refs(kernel, names)
        if unlinked:
            print(f"\nUnlinked references ({len(unlinked)} names):")
            for name, contexts in sorted(unlinked.items()):
                print(f"  {name}: {len(contexts)} occurrences")
                for ctx in contexts[:3]:
                    print(f"    {ctx.strip()}")
        else:
            print("\nAll names are @linked ✓")
    else:
        print("\nKernel not built — run build first")

    return 0


if __name__ == "__main__":
    sys.exit(main())
