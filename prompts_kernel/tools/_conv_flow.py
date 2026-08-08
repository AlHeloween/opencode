"""Conversation Semantic Flow — sentence-level adjacency chain analysis."""
import re, sys, json, sqlite3, numpy as np
from pathlib import Path

# Work around torch 2.11 alpha compatibility issue
import torch
if not hasattr(torch.distributed, 'is_initialized'):
    torch.distributed.is_initialized = lambda: False
from sentence_transformers import SentenceTransformer

# Read conversation from session (use raw session data)
session_id = "ses_021c0082fffeE0BbVj4fl37XBr"
db_path = Path("D:/zPython/opencode/.opencode/data/opencode.db")

# We'll use the messagesearch + sessionread approach to get messages
# For now, extract from the session messages we can access
texts = []

# Read the session via raw mode
import sqlite3
try:
    conn = sqlite3.connect(str(db_path))
    rows = conn.execute("""
        SELECT m.data as mdata, p.data as pdata FROM message m 
        JOIN part p ON p.message_id = m.id
        WHERE m.session_id = ? AND p.type = 'text'
        ORDER BY m.id, p.id
    """, (session_id,)).fetchall()
    for mdata_json, pdata_json in rows:
        try:
            msg = json.loads(mdata_json)
            role = msg.get('role', '')
            part = json.loads(pdata_json)
            content = part.get('text', '')  # field is 'text' not 'content'
            if role in ('user', 'assistant') and content and len(content.strip()) > 10:
                texts.append(content.strip())
        except:
            pass
    conn.close()
    print(f"Loaded {len(texts)} messages from DB")
except Exception as e:
    print(f"DB error: {e}")
    sys.exit(1)

# Split into sentences
all_sentences = []
for text in texts:
    # Split on sentence boundaries
    sents = re.split(r'(?<=[.!?])\s+', text)
    for s in sents:
        s = s.strip()
        # Skip very short fragments, code blocks, SV footers
        if len(s) > 15 and not s.startswith('```') and 'Keywords:' not in s[:50]:
            all_sentences.append(s)

print(f"Sentences: {len(all_sentences)}")

# Compute embeddings
print("Loading BGE model on CUDA...")
model = SentenceTransformer('BAAI/bge-base-en-v1.5', device='cuda')
embeddings = model.encode(all_sentences, normalize_embeddings=True, show_progress_bar=True, batch_size=64)

# Adjacent sentence similarities
results = []
for i in range(len(all_sentences) - 1):
    sim = float(np.dot(embeddings[i], embeddings[i + 1]))
    results.append((i, sim, all_sentences[i][:100], all_sentences[i+1][:100]))

# Output
print(f"\n{'='*90}")
print(f"  Conversation Semantic Flow — Adjacent Sentence Cosine Similarity")
print(f"  {len(results)} transitions, {len(all_sentences)} sentences")
print(f"{'='*90}")
print(f"{'#':>5} {'sim':>7} {'delta':>7} {'sentence A':<45} {'sentence B':<45}")
print(f"{'-'*5} {'-'*7} {'-'*7} {'-'*45} {'-'*45}")

total_delta = 0.0
bins = {"smooth(>0.85)": 0, "ok(0.5-0.85)": 0, "jump(<0.5)": 0}
for i, sim, sa, sb in results:
    d = 1.0 - sim
    total_delta += d
    if sim > 0.85:
        bins["smooth(>0.85)"] += 1
        marker = "█"
    elif sim >= 0.5:
        bins["ok(0.5-0.85)"] += 1
        marker = "▆"
    else:
        bins["jump(<0.5)"] += 1
        marker = "▁"
    # Truncate for display
    sa_short = sa[:42] + "..." if len(sa) > 42 else sa
    sb_short = sb[:42] + "..." if len(sb) > 42 else sb
    print(f"{i:>5} {sim:>7.4f} {d:>7.4f} {sa_short:<45} {sb_short:<45} {marker}")

avg = total_delta / len(results) if results else 0
print(f"{'-'*5} {'-'*7} {'-'*7} {'-'*45} {'-'*45}")
print(f"\n  Total delta: {total_delta:.2f}  Avg delta: {avg:.4f}  Sentences: {len(all_sentences)}")
print(f"  Smooth (>0.85): {bins['smooth(>0.85)']}  OK (0.5-0.85): {bins['ok(0.5-0.85)']}  Jumps (<0.5): {bins['jump(<0.5)']}")

# Flow distribution diagram
print(f"\n{'='*70}")
print(f"  Flow Distribution (adjacent sentence cosine similarity)")
print(f"{'='*70}")
buckets = [0]*10  # 0.0-0.1, 0.1-0.2, ..., 0.9-1.0
for _, sim, _, _ in results:
    b = min(int(sim * 10), 9)
    buckets[b] += 1
max_b = max(buckets) if buckets else 1
for i in range(10):
    lo, hi = i/10, (i+1)/10
    bar = '█' * (buckets[i] * 50 // max_b)
    print(f"  {lo:.1f}-{hi:.1f}: {bar} {buckets[i]}")
print(f"{'='*70}")
print(f"  Mean similarity: {1.0-avg:.4f}  |  Coherence score: {(1.0-avg)*100:.1f}%")

# ASCII line chart of similarity over time
print(f"\n{'='*70}")
print(f"  Similarity Trend (first 80 transitions)")
print(f"{'='*70}")
n_show = min(80, len(results))
for i in range(0, n_show, 2):
    if i < len(results):
        sim = results[i][1]
        bar_len = int(sim * 50)
        bar = '█' * bar_len + '░' * (50 - bar_len)
        print(f"  {i:>4}: {bar} {sim:.3f}")
