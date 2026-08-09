"""Detect forward references — @refs that appear BEFORE their definition (anchor).

LLMs process text sequentially. A @ref encountered before its (@NAME) anchor
is a "look-ahead" — the model must guess what it means. This is bad for both
LLMs and programmers.
"""

import re
import sys
from pathlib import Path

KERNEL_PATH = Path(__file__).resolve().parents[2] / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.txt"


def analyze_lookahead(text: str) -> dict:
    """Return {ref_name: (first_use_line, definition_line)} for all forward refs."""
    lines = text.split("\n")
    
    # Track when each anchor is first defined
    defined_at: dict[str, int] = {}
    # Track forward references
    forward_refs: dict[str, tuple[int, int]] = {}  # name -> (first_use, definition)
    
    for i, line in enumerate(lines, 1):
        # Detect anchor definitions: (@NAME)
        for m in re.finditer(r'\(@(\w+)\)', line):
            name = m.group(1)
            if name not in defined_at:
                defined_at[name] = i
        
        # Detect references: @NAME (not inside (@...))
        for m in re.finditer(r'(?<!\()@(\w+)(?![\w\s]*\))', line):
            name = m.group(1)
            # Skip false positives
            if name in ('def', 'forbidden', 'invariants', 'invariant', 'claim', 
                       'status', 'classify', 'oracle', 'refs'):
                continue
            if name not in defined_at and name not in forward_refs:
                forward_refs[name] = (i, -1)  # definition line unknown yet
    
    # Now check which forward refs eventually got defined
    result = {}
    for name, (first_use, _) in forward_refs.items():
        if name in defined_at:
            def_line = defined_at[name]
            if def_line > first_use:
                result[name] = (first_use, def_line)
    
    return dict(sorted(result.items(), key=lambda x: x[1][0]))


def main():
    text = KERNEL_PATH.read_text(encoding="utf-8")
    forward = analyze_lookahead(text)
    
    if not forward:
        print("✅ ZERO forward references — all @refs defined before first use.")
        return 0
    
    print(f"❌ {len(forward)} forward reference(s) found:\n")
    for name, (use, defn) in forward.items():
        gap = defn - use
        print(f"  @{name}: first used at line {use}, defined at line {defn} (gap: {gap} lines)")
    
    print(f"\nThese @refs appear BEFORE their (@NAME) anchor.")
    print("LLMs and programmers both struggle with forward references.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
