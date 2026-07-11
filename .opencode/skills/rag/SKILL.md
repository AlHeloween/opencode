---
name: rag
description: Index/query local repositories using adm RAG (adm.json + sqlite) with BGE embedder, dual-quaternion ranking, fd file discovery, and MCP HTTP daemon.
---

"""
RAG skill — defined in opencode_prompts_kernel.py as typed dict.
"""

from opencode_prompts_kernel import RAG, ADID_FRAMEWORK_RULES

# === CONSTRAINTS ===
for k, v in RAG["constraints"].items():
    # {k}: {v}

# === STEPS ===
for s in RAG["steps"]:
    # {s}

# === INVARIANTS ===
for inv in RAG["invariants"]:
    # invariant: {inv}
