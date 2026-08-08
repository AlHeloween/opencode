"""Generate compact analysis summary from semantic map JSON."""
import json

d = json.load(open("D:/zPython/opencode/kernel_semantic_map.json", "r", encoding="utf-8"))
chains = d["candidate_chains"]
best = chains[2]["chain"]  # rank 3, delta 37.14

lines = []
lines.append("=== BEST CHAIN (delta=37.14) ===")
gates_pos = [(i, eid) for i, eid in enumerate(best) if eid.startswith("G") and eid[1:].isdigit()]
lines.append(f"Gates at positions: {[i for i,_ in gates_pos]}")
for i, eid in enumerate(best):
    tag = " <-- GATED" if any(g == eid for _, g in gates_pos) else ""
    lines.append(f"{i:3d}. {eid}{tag}")

lines.append("")
lines.append("=== KEY NEIGHBORS (top-3) ===")
key_entries = [
    "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9",
    "DECOMPOSE", "CONSTITUTION_BLOCKS", "VERIFY_OUTCOME",
    "FRACTAL_GEOMETRY", "SMOKE_BEFORE", "SEARCH_ORDER",
]
for eid in key_entries:
    e = d["entries"].get(eid, {})
    ns = [(n["id"], round(n["similarity"], 3)) for n in e.get("top_neighbors", [])]
    lines.append(f"  {eid}: " + " -> ".join(f"{n}({s})" for n, s in ns))

lines.append("")
lines.append("=== CLUSTERS ===")
clusters = [
    ("G1->G2 planning", 1, 13),
    ("G3->G4 plan/auth", 15, 29),
    ("G5->G6 grounding", 29, 41),
    ("G7 implementation", 41, 57),
    ("G8 oracle/verify", 57, 93),
    ("G9 terminal", 93, 94),
]
for name, start, end in clusters:
    items = best[start:end]
    suffix = "..." if len(items) > 10 else ""
    lines.append(f"  {name}: {', '.join(items[:10])}{suffix}  ({len(items)} entries)")

lines.append("")
lines.append("=== SEMANTIC DUPLICATES (cosine > 0.90) ===")
entries = d["entries"]
high_sim_pairs = []
seen_pairs = set()
for eid, e in entries.items():
    for n in e.get("top_neighbors", []):
        pair = tuple(sorted([eid, n["id"]]))
        if n["similarity"] > 0.90 and pair not in seen_pairs:
            seen_pairs.add(pair)
            high_sim_pairs.append((pair[0], pair[1], n["similarity"]))
high_sim_pairs.sort(key=lambda x: -x[2])
for a, b, s in high_sim_pairs[:15]:
    lines.append(f"  {a} <-> {b}: {s:.4f}")

out = "\n".join(lines)
open("D:/zPython/opencode/kernel_analysis_summary.txt", "w", encoding="utf-8").write(out)
print(f"Written {len(lines)} lines, {len(out)} chars")
