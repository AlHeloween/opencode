#!/usr/bin/env python3
"""
Data-driven dedup: embed dictionary entries + spec invariants, find high-sim matches.
Replace invariant prose with @REF when cos > 0.85.
"""
import sys, os, json, re, numpy as np

PROJECT = r'D:\zPython\opencode'
sys.path.insert(0, os.path.join(PROJECT, 'prompts_kernel'))

from _kernel_precompiled import _ALL_SPECS, RUNTIME_RULES, RUNTIME_TERMS, _TIER_A_AGENTS, _TIER_A_POLICIES

# ═══════════════════════════════════════════
# 1. Collect dictionary entries
# ═══════════════════════════════════════════
dict_entries = {}
for name, body in RUNTIME_RULES.items():
    dict_entries[name] = body
for name, body in RUNTIME_TERMS.items():
    dict_entries[name] = body

print(f"Dictionary entries: {len(dict_entries)}")

# ═══════════════════════════════════════════
# 2. Embed dictionary entries
# ═══════════════════════════════════════════
import torch
torch.distributed.is_initialized = lambda: False
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('BAAI/bge-base-en-v1.5', device='cuda')
dict_names = list(dict_entries.keys())
dict_bodies = list(dict_entries.values())
dict_embs = model.encode(dict_bodies, normalize_embeddings=True, show_progress_bar=True)

print(f"Embedded {len(dict_embs)} dictionary entries")

# ═══════════════════════════════════════════
# 3. Extract spec invariants/forbidden
# ═══════════════════════════════════════════
spec_items = []  # [(spec_name, field, text, index)]
for spec_name, spec in _ALL_SPECS.items():
    for field in ['invariants', 'forbidden_actions']:
        items = spec.get(field, [])
        for i, text in enumerate(items):
            if isinstance(text, str) and len(text) > 20:
                spec_items.append((spec_name, field, text, i))

# Also constraints
for spec_name, spec in _ALL_SPECS.items():
    constraints = spec.get('constraints', {})
    for key, val in constraints.items():
        text = f"{key}: {val}"
        spec_items.append((spec_name, 'constraints', text, key))

print(f"Spec items to check: {len(spec_items)}")

# ═══════════════════════════════════════════
# 4. Embed spec items and find matches
# ═══════════════════════════════════════════
spec_texts = [t[2] for t in spec_items]
spec_embs = model.encode(spec_texts, normalize_embeddings=True, show_progress_bar=True)

THRESHOLD = 0.85
matches = []
for idx, (spec_name, field, text, pos) in enumerate(spec_items):
    sims = np.dot(spec_embs[idx], dict_embs.T)
    best_idx = int(np.argmax(sims))
    best_sim = float(sims[best_idx])
    if best_sim >= THRESHOLD:
        matches.append({
            'spec': spec_name,
            'field': field,
            'text': text[:100],
            'pos': pos,
            'match': dict_names[best_idx],
            'sim': round(best_sim, 4),
        })

# Sort by similarity descending
matches.sort(key=lambda x: -x['sim'])

print(f"\nMatches above {THRESHOLD}: {len(matches)}")
for m in matches:
    print(f"  [{m['sim']:.3f}] {m['spec']}.{m['field']}[{m['pos']}] → @{m['match']}")
    print(f"         \"{m['text'][:90]}...\"")
