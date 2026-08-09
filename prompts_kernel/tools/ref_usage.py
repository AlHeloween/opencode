"""Analyze @ref usage in the assembled KERNEL ONLY (reasoning_prompt.txt).

NOTE: This analyzes the kernel in isolation (~37KB). The full system prompt
(~243KB) includes tool schemas, agent prompts, and other components that also
reference these @refs. "Dead" and "broken" counts here are KERNEL-SCOPE ONLY
and do NOT indicate actual problems — refcheck is authoritative for that.

Categories (kernel-scope):
1. Dead: anchors with zero @ref usages IN THE KERNEL (used elsewhere in full prompt)
2. Broken: @refs without anchors (REFCHECK is authoritative — if it says 0, trust it)
3. Single-use: @ref used exactly once in the kernel — inline candidate OR used in tools
"""

import re
import sys
from pathlib import Path
from collections import Counter

KERNEL_PATH = Path(__file__).resolve().parents[2] / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.txt"


def extract_all_refs(text: str) -> tuple[Counter, set[str]]:
    """Return (ref_usage_counts, anchor_names) from kernel text."""
    # Anchors: (@NAME) — capture single tag name
    anchors: set[str] = set()
    for m in re.finditer(r'\(@(\w+)\)', text):
        anchors.add(m.group(1))

    # Refs: @NAME — standalone word, not inside (@...)
    refs = re.findall(r'(?<!\()@(\w+)(?![\w\s]*\))', text)
    # Filter out false positives: non-ref @-patterns from prose
    EXCLUDE = {"def", "forbidden", "invariants", "claim", "status", "classify",
               "invariant", "oracle", "evidence_order", "g1", "no_hardcode",
               "reuse_before", "search_order", "where_which"}
    refs = [r for r in refs if r not in EXCLUDE]
    counts = Counter(refs)

    return counts, anchors


def main():
    text = KERNEL_PATH.read_text(encoding="utf-8")
    usage, anchors = extract_all_refs(text)

    # Category 1: Dead definitions (anchors never referenced)
    dead = sorted(a for a in anchors if a not in usage)
    # Category 2: Broken links (refs without anchors) — should be empty
    broken = sorted(r for r in usage if r not in anchors)
    # Category 3: Single-use refs
    single = sorted(r for r, c in usage.items() if c == 1 and r in anchors)
    multi = sorted(r for r, c in usage.items() if c > 1 and r in anchors)

    print(f"Total @refs (usages):  {sum(usage.values())}")
    print(f"Unique refs:           {len(usage)}")
    print(f"Anchors (definitions): {len(anchors)}")
    print()
    print(f"=== CATEGORY 1: Dead definitions (anchors, zero usages) ===")
    print(f"  Count: {len(dead)}")
    if dead:
        for d in dead:
            print(f"    - {d}")
    print()
    print(f"=== CATEGORY 2: Broken links (refs without anchors) ===")
    print(f"  Count: {len(broken)}")
    if broken:
        for b in broken:
            print(f"    - {b}")
    else:
        print("  ✅ None")
    print()
    print(f"=== CATEGORY 3: Single-use refs ===")
    print(f"  Count: {len(single)}")
    for s in single:
        count = usage[s]
        print(f"    - {s} ({count} usage)")
    print()
    print(f"=== Multi-use refs: {len(multi)} ===")

    # Exit code: fail if broken links exist
    if broken:
        print("\n❌ FAIL: broken links detected")
        sys.exit(1)
    print("✅ PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
