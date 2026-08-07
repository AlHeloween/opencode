"""Reference graph navigator — builds optimal traversal from @references.

Usage:
  python -m prompts_kernel.tools.refgraph G1 G8 SV_OUTPUT
  python -m prompts_kernel.tools.refgraph --all
"""
from __future__ import annotations

import re, sys
from collections import defaultdict, deque
from pathlib import Path

KERNEL = Path(__file__).resolve().parents[2] / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.mdc"
REF = re.compile(r"@([A-Z][A-Z_0-9]*)")


def parse(text: str) -> dict[str, str]:
    """Split kernel into section_name → body."""
    sec: dict[str, str] = {}
    cur, lines = "(head)", []
    for line in text.split("\n"):
        if line.startswith("## ") or (line.startswith("# ") and not line.startswith("## ")):
            if lines:
                sec[cur] = "\n".join(lines)
            cur = line.lstrip("#").strip()
            lines = []
        else:
            lines.append(line)
    if lines:
        sec[cur] = "\n".join(lines)
    return sec


def main():
    if not KERNEL.exists():
        print(f"ERROR: {KERNEL} not found — run build first", file=sys.stderr)
        return 1

    text = KERNEL.read_text(encoding="utf-8")
    sec = parse(text)

    # Build tag → sections index
    tag_to = defaultdict(list)
    for name in sec:
        for tag in REF.findall(name):
            tag_to[tag].append(name)

    # Build graph: section → sections it references via @tags in body
    graph = defaultdict(set)
    for name, body in sec.items():
        for ref in REF.findall(body):
            if ref in tag_to:
                for tgt in tag_to[ref]:
                    if tgt != name:
                        graph[name].add(tgt)

    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    if "--all" in sys.argv:
        print(f"Sections: {len(sec)}  Tags: {len(tag_to)}  Edges: {sum(len(v) for v in graph.values())}")
        for src, targets in sorted(graph.items()):
            print(f"  {src} → {', '.join(sorted(targets))}")
        return 0

    # Find starts
    starts = []
    for kw in args:
        kw = kw.replace("@", "")
        for name in sec:
            if kw in REF.findall(name):
                if name not in starts:
                    starts.append(name)

    if not starts:
        print(f"No sections tagged with: {args}")
        return 1

    # BFS traversal
    seen = set()
    q = deque(starts)
    order = []
    for _ in range(5):
        if not q:
            break
        level = []
        for _ in range(len(q)):
            n = q.popleft()
            if n not in seen:
                seen.add(n)
                level.append(n)
        order.extend(level)
        for n in level:
            for child in graph.get(n, set()):
                if child not in seen:
                    q.append(child)

    print(f"Tags: {args}  →  {len(order)} sections")
    for i, node in enumerate(order):
        kids = graph.get(node, set())
        s = f" → {', '.join(sorted(kids)[:3])}" if kids else " (leaf)"
        print(f"  {i+1}. {node}{s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
