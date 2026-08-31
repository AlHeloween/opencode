"""Parse @references in the unified kernel, check resolution and circularity.

Usage: python -m prompts_kernel.tools.refcheck
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

KERNEL = Path(__file__).resolve().parents[2] / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.txt"

# Patterns
REF_PAT = re.compile(r"@([A-Z][A-Z_0-9]*)")          # @REF_NAME
HEADER_PAT = re.compile(r"^#{1,3}\s+(.+)$", re.M)      # ## Section Name
YAML_KEY_PAT = re.compile(r"^\s{2}([A-Z][A-Z_0-9]*):") #   RULE_NAME: (in YAML blocks)


def extract_refs(text: str) -> set[str]:
    """Extract all @REF targets."""
    return {m.group(1) for m in REF_PAT.finditer(text)}


def _clean_anchor(name: str) -> str:
    """Normalize section name to anchor ID, extracting @TAG if present."""
    # "Auth Resolver (@AUTH_RESOLVER)" → "AUTH_RESOLVER"
    m = re.search(r"\(@([A-Z][A-Z_0-9]*)\)", name)
    if m:
        return m.group(1)
    return name.upper().replace(" ", "_").replace("-", "_")


def extract_anchors(text: str) -> set[str]:
    """Extract all definable anchors: ## headers + YAML keys + G1-G9."""
    anchors: set[str] = set()
    for m in HEADER_PAT.finditer(text):
        anchors.add(_clean_anchor(m.group(1)))
    for m in re.finditer(r"^\s+([A-Z][A-Z_0-9]{0,20}):", text, re.M):
        anchors.add(m.group(1))
    anchors |= {f"G{i}" for i in range(1, 10)}
    return anchors


def check_circular(refs: set[str], anchors: set[str]) -> list[tuple[str, str]]:
    """Find @refs that point to sections which contain @refs back (simple cycle check)."""
    # For now: just check if any @ref matches an anchor name
    # A proper cycle check would need to map sections → refs they contain
    # Simple: refs that are also anchors = self-referencing sections
    circular = []
    for ref in refs:
        if ref in anchors:
            circular.append((ref, ref))
    return circular


def resolve_refs(refs: set[str], anchors: set[str]) -> dict[str, bool]:
    """Resolve each @ref against known anchors."""
    return {ref: ref in anchors for ref in refs}


def report(refs: set[str], anchors: set[str]):
    """Print resolution report."""
    resolved = resolve_refs(refs, anchors)
    unresolved = {r for r, ok in resolved.items() if not ok}
    circular = check_circular(refs, anchors)
    
    print(f"Kernel: {KERNEL}")
    print(f"  @references found: {len(refs)}")
    print(f"  Anchors found:     {len(anchors)}")
    print(f"  Resolved:          {len(refs) - len(unresolved)}/{len(refs)}")
    print(f"  Unresolved:        {len(unresolved)}")
    print(f"  Self-ref (anchor=ref): {len(circular)}")
    
    if unresolved:
        print(f"\n  ❌ UNRESOLVED @refs:")
        for r in sorted(unresolved):
            print(f"     @{r}")
    
    if circular:
        print(f"\n  ⚠️  SELF-REFERENCING (ref matches anchor name):")
        for a, b in circular:
            print(f"     @{a} ↔ anchor '{b}'")
    
    # Coverage: anchors NOT referenced
    unreferenced = anchors - refs
    if unreferenced:
        print(f"\n  📎 Anchors with NO @references ({len(unreferenced)}):")
        for a in sorted(unreferenced)[:20]:
            print(f"     {a}")
        if len(unreferenced) > 20:
            print(f"     ... and {len(unreferenced) - 20} more")
    
    return len(unresolved) == 0


def main() -> int:
    if not KERNEL.exists():
        print(f"ERROR: {KERNEL} not found — run build first", file=sys.stderr)
        return 1
    
    text = KERNEL.read_text(encoding="utf-8")
    refs = extract_refs(text)
    anchors = extract_anchors(text)
    ok = report(refs, anchors)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
