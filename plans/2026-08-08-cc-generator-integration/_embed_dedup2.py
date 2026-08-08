#!/usr/bin/env python3
"""Data-driven dedup v2: save results to JSON."""
import sys, os, json, re, numpy as np

PROJECT = r'D:\zPython\opencode'
sys.path.insert(0, os.path.join(PROJECT, 'prompts_kernel'))

from _kernel_precompiled import _ALL_SPECS, RUNTIME_RULES, RUNTIME_TERMS

import torch
torch.distributed.is_initialized = lambda: False
from sentence_transformers import SentenceTransformer

# 1. Dict entries
dict_entries = {}
for name, body in RUNTIME_RULES.items():
    dict_entries[name] = body
for name, body in RUNTIME_TERMS.items():
    dict_entries[name] = body

model = SentenceTransformer('BAAI/bge-base-en-v1.5', device='cuda')
dict_names = list(dict_entries.keys())
dict_bodies = list(dict_entries.values())
dict_embs = model.encode(dict_bodies, normalize_embeddings=True, show_progress_bar=False)

# 2. Spec items
spec_items = []
for spec_name, spec in _ALL_SPECS.items():
    for field in ['invariants', 'forbidden_actions']:
        for i, text in enumerate(spec.get(field, [])):
            if isinstance(text, str) and len(text) > 20:
                spec_items.append({'spec': spec_name, 'field': field, 'text': text, 'pos': i})
    for key, val in spec.get('constraints', {}).items():
        text = f"{key}: {val}"
        spec_items.append({'spec': spec_name, 'field': 'constraints', 'text': text, 'pos': key})

spec_texts = [s['text'] for s in spec_items]
spec_embs = model.encode(spec_texts, normalize_embeddings=True, show_progress_bar=False)

# 3. Find matches
THRESHOLD = 0.85
results = []
for idx, s in enumerate(spec_items):
    sims = np.dot(spec_embs[idx], dict_embs.T)
    best_idx = int(np.argmax(sims))
    best_sim = float(sims[best_idx])
    results.append({
        **s,
        'best_match': dict_names[best_idx],
        'sim': round(best_sim, 4),
        'action': 'REPLACE' if best_sim >= THRESHOLD else 'KEEP'
    })

# 4. Group by action
to_replace = [r for r in results if r['action'] == 'REPLACE']
to_keep = [r for r in results if r['action'] == 'KEEP']

# Save
out = {'threshold': THRESHOLD, 'total': len(results), 'replace': len(to_replace), 'keep': len(to_keep),
       'matches': sorted(to_replace, key=lambda x: -x['sim']),
       'kept': sorted(to_keep, key=lambda x: -x['sim'])[:30]}

out_path = os.path.join(PROJECT, 'plans', '2026-08-08-cc-generator-integration', 'dedup_results.json')
json.dump(out, open(out_path, 'w'), indent=2, ensure_ascii=False)

print(f"Total: {len(results)}, Replace: {len(to_replace)}, Keep: {len(to_keep)}")
print(f"Saved to: {out_path}")
for r in out['matches'][:15]:
    print(f"  [{r['sim']:.3f}] {r['spec']}.{r['field']} → @{r['best_match']}")
    print(f"         \"{r['text'][:100]}\"")
