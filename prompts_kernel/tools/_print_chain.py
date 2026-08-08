import json
d = json.load(open("D:/zPython/opencode/test_kernel/kernel_semantic_map_phase1.json", "r", encoding="utf-8"))
best = d["candidate_chains"][2]["chain"]
gates = {"G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"}

lines = []
lines.append("=== FULL PHASE 1 CHAIN (72 entries, delta=27.76) ===")
for i, eid in enumerate(best):
    e = d["entries"].get(eid, {})
    t = e.get("type", "?")
    tag = " <-- GATED" if eid in gates else ""
    nbs = e.get("top_neighbors", [])
    n1 = f"  -> {nbs[0]['id']}({nbs[0]['similarity']:.2f})" if nbs else ""
    lines.append(f"{i:3d}. {eid:<30} [{t:<10}]{tag}{n1}")

out = "\n".join(lines)
open("D:/zPython/opencode/test_kernel/phase1_full_chain.txt", "w", encoding="utf-8").write(out)
print(f"Written {len(lines)} lines")
