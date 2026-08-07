"""Kernel source dependency graph — shows how prompts_kernel modules interconnect.

Parses all .py files in prompts_kernel/, extracts cross-fragment references,
and outputs the module dependency graph.

Usage:
  python -m prompts_kernel.tools.kernel_graph
  python -m prompts_kernel.tools.kernel_graph --mermaid  # mermaid output
"""
from __future__ import annotations

import ast, sys
from pathlib import Path
from collections import defaultdict

KERNEL = Path(__file__).resolve().parents[1]
FRAGMENTS = sorted(KERNEL.glob("*.py"))
FRAGMENTS = [f for f in FRAGMENTS if f.name not in ("__init__.py", "_kernel_precompiled.py")]

# Symbols exported by each fragment (mapping name → fragment stem)
EXPORTS: dict[str, str] = {}
# Fragment imports (fragment stem → set of imported fragment stems)
IMPORTS: dict[str, set[str]] = defaultdict(set)


def visit_file(path: Path) -> None:
    """Extract assignments and imports from a fragment."""
    stem = path.stem
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        # Track top-level assignments: exports this symbol
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    EXPORTS[target.id] = stem
        # Track references to names defined in other fragments
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            if node.id in EXPORTS:
                src = EXPORTS[node.id]
                if src != stem:
                    IMPORTS[stem].add(src)


def main() -> int:
    for path in FRAGMENTS:
        visit_file(path)

    # Build reverse: who depends on whom
    if "--mermaid" in sys.argv:
        print("```mermaid")
        print("flowchart LR")
        for frag, deps in sorted(IMPORTS.items()):
            for dep in sorted(deps):
                short_f = frag.replace("_", "").replace("promptskernel", "pk")
                short_d = dep.replace("_", "").replace("promptskernel", "pk")
                print(f"  {short_d} --> {short_f}")
        print("```")
    else:
        print(f"Modules: {len(FRAGMENTS)}")
        print(f"Exports: {len(EXPORTS)} symbols")
        print(f"Edges:   {sum(len(v) for v in IMPORTS.values())} imports\n")
        for frag, deps in sorted(IMPORTS.items()):
            print(f"  {frag}")
            for dep in sorted(deps):
                symbols = [k for k, v in EXPORTS.items() if v == dep]
                sample = ", ".join(symbols[:5])
                if len(symbols) > 5:
                    sample += f" +{len(symbols)-5}"
                print(f"    ← {dep}  ({sample})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
