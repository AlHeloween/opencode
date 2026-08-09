"""Semantic duplicate detector + nearest-neighbor report — BGE v1.5 embeddings.

Usage:
  python -m prompts_kernel.tools.refdupes              # duplicates ≥ 0.85
  python -m prompts_kernel.tools.refdupes --top 3      # top-3 neighbors per section
  python -m prompts_kernel.tools.refdupes --threshold 0.80 --top 5
  python -m prompts_kernel.tools.refdupes --json       # machine-readable
"""
from __future__ import annotations

import json, re, sys
from pathlib import Path

KERNEL = Path(__file__).resolve().parents[2] / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.mdc"
REF = re.compile(r"@([A-Z][A-Z_0-9]*)")


def parse_sections(text: str) -> dict[str, str]:
    """Split kernel into sections, resolving @tags to their target definitions."""
    sec: dict[str, str] = {}
    cur, lines = "(head)", []
    for line in text.split("\n"):
        if line.startswith("## ") or (line.startswith("# ") and not line.startswith("## ")):
            if lines:
                sec[cur] = "\n".join(lines).strip()
            cur = line.lstrip("#").strip()
            lines = []
        else:
            lines.append(line)
    if lines:
        sec[cur] = "\n".join(lines).strip()

    # Build tag → target body (resolve @references to actual definitions)
    tagged = {k: v for k, v in sec.items() if REF.findall(k) and len(v) > 20}
    
    # For gate tags (@GATE_1_GROUND..@GATE_9_CLEAN_STATE), extract the gate definition from the gates schema
    # The gates section has keys like "G1:", "G2:" with name/description/rules
    gates_text = sec.get("Gates", "")
    gate_defs: dict[str, str] = {}
    if gates_text:
        import re as re2
        for m in re2.finditer(r"(G\d):\s*\n(.*?)(?=\n\S|\Z)", gates_text, re2.DOTALL):
            gate_defs[m.group(1)] = m.group(2).strip()

    resolved: dict[str, str] = {}
    for name, body in tagged.items():
        tags = REF.findall(name)
        primary = tags[0] if tags else name
        # If this is a gate reference, use the actual gate definition
        if primary in gate_defs and len(gate_defs[primary]) > 20:
            resolved[name] = gate_defs[primary]
        else:
            resolved[name] = body

    return resolved


def extract_tag(name: str) -> str:
    tags = REF.findall(name)
    return tags[0] if tags else name


def main():
    if not KERNEL.exists():
        print(f"ERROR: {KERNEL} not found", file=sys.stderr)
        return 1

    threshold = 0.85
    top_k = 0
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--threshold="):
            threshold = float(a.split("=")[1])
        elif a == "--threshold":
            i += 1; threshold = float(args[i])
        elif a.startswith("--top="):
            top_k = int(a.split("=")[1])
        elif a == "--top":
            i += 1; top_k = int(args[i])
        i += 1

    text = KERNEL.read_text(encoding="utf-8")
    sections = parse_sections(text)
    names = list(sections.keys())
    bodies = [sections[n] for n in names]
    tags = [extract_tag(n) for n in names]

    print(f"Embedding {len(sections)} tagged sections with BGE v1.5...", file=sys.stderr)

    import torch
    if not hasattr(torch.distributed, "is_initialized"):
        torch.distributed.is_initialized = lambda: False
    from sentence_transformers import SentenceTransformer
    from numpy import dot, argsort

    model = SentenceTransformer("BAAI/bge-small-en-v1.5")
    embeddings = model.encode(bodies, normalize_embeddings=True, show_progress_bar=True)

    if top_k > 0:
        # Top-N nearest neighbors per section (excluding self)
        print(f"\nTop-{top_k} nearest neighbors per section:\n")
        for i, (name, tag) in enumerate(zip(names, tags)):
            sims = [(float(dot(embeddings[i], embeddings[j])), tags[j], names[j])
                    for j in range(len(names)) if j != i]
            sims.sort(reverse=True)
            print(f"  {tag}  ({name})")
            for rank, (sim, tgt_tag, tgt_name) in enumerate(sims[:top_k]):
                pct = sim * 100
                print(f"    {rank+1}. {pct:6.3f}%  {tgt_tag:<20}  {tgt_name}")
            print()
        return 0

    # Duplicate detection
    pairs = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            sim = float(dot(embeddings[i], embeddings[j]))
            if sim >= threshold:
                pairs.append((sim, tags[i], tags[j], names[i], names[j]))
    pairs.sort(reverse=True)

    if "--json" in sys.argv:
        out = [{"sim": round(s, 3), "tag_a": a, "tag_b": b, "section_a": sa, "section_b": sb}
               for s, a, b, sa, sb in pairs]
        print(json.dumps(out, indent=2))
    else:
        print(f"\nSimilarity ≥ {threshold}: {len(pairs)} pairs\n")
        if pairs:
            print(f"{'Sim':>6}  {'Tag A':<20} {'Tag B':<20} {'Section A'}")
            print(f"{'---':>6}  {'-----':<20} {'-----':<20} {'---------'}")
            for sim, ta, tb, sa, sb in pairs[:30]:
                print(f"{sim:>6.3f}  {ta:<20} {tb:<20} {sa}")
        else:
            print("  ✓ No semantic duplicates found.")

    return len(pairs)


if __name__ == "__main__":
    sys.exit(main())
