"""Phase analysis with rolling average similarity trend."""
import json, sqlite3, re, numpy as np
from pathlib import Path
import torch
if not hasattr(torch.distributed, 'is_initialized'):
    torch.distributed.is_initialized = lambda: False
from sentence_transformers import SentenceTransformer

db = Path('D:/zPython/opencode/.opencode/data/opencode.db')
conn = sqlite3.connect(str(db))
rows = conn.execute(
    "SELECT m.data, p.data FROM message m JOIN part p ON p.message_id=m.id "
    "WHERE m.session_id='ses_021c0082fffeE0BbVj4fl37XBr' AND p.type='text' "
    "ORDER BY m.id, p.id"
).fetchall()

texts = []
for md, pd in rows:
    try:
        msg = json.loads(md)
        part = json.loads(pd)
        t = part.get('text', '')
        if msg.get('role') in ('user', 'assistant') and len(t.strip()) > 10:
            texts.append(t.strip())
    except:
        pass

all_sents = []
for t in texts:
    for s in re.split(r'(?<=[.!?])\s+', t):
        s = s.strip()
        if len(s) > 15 and not s.startswith('```') and 'Keywords:' not in s[:50]:
            all_sents.append(s)

print(f'Embedding {len(all_sents)} sentences...')
model = SentenceTransformer('BAAI/bge-base-en-v1.5', device='cuda')
emb = model.encode(all_sents, normalize_embeddings=True, show_progress_bar=True, batch_size=64)

deltas = [1.0 - float(np.dot(emb[i], emb[i+1])) for i in range(len(emb)-1)]
n = len(deltas)
p1 = n // 3
p2 = 2 * n // 3

print(f"\n{' PHASE ANALYSIS ':=^60}")
for name, s, e in [("I: Cold start", 0, p1), ("II: Core work", p1, p2), ("III: Polish", p2, n)]:
    chunk = deltas[s:e]
    avg_d = sum(chunk) / len(chunk)
    jumps = sum(1 for d in chunk if d > 0.5)
    smooth = sum(1 for d in chunk if d < 0.15)
    print(f"  {name:<20} sents {s:>4}-{e:<4}  avg delta={avg_d:.4f}  jumps={jumps}  smooth={smooth}")

# Rolling average
window = 10
rolling = [
    sum(deltas[max(0, i-window):i]) / min(i, window) if i > 0 else deltas[0]
    for i in range(n)
]

print(f"\n{' TREND (rolling avg, window=10) ':=^60}")
step = max(1, n // 50)
for i in range(0, n, step):
    sim = 1.0 - rolling[i]
    bar_len = int(sim * 60)
    bar = '\u2588' * bar_len + '\u2591' * (60 - bar_len)
    phase = 'I' if i < p1 else ('II' if i < p2 else 'III')
    marker = ''
    if i == 0: marker = '  <- kernel cold'
    if i >= p1 and i < p1 + step: marker = '  <- core work'
    if i >= p2 and i < p2 + step: marker = '  <- polish'
    print(f"  {i:>4}: {bar} {sim:.3f} {phase}{marker}")

print(f"\n  Total delta: {sum(deltas):.2f}  |  Avg: {sum(deltas)/n:.4f}  |  Coherence: {(1-sum(deltas)/n)*100:.1f}%")
