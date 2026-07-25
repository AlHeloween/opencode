# Compaction Cache Experiment Plan

Date: 2026-06-09  
Status: Plan  
Directory: `experiments/20260609_cache_semantics/`

## Goal

Prove that both local (per-message) and provider-level (DeepSeek prefix) caching are effective for compaction head messages, using:
- **SQLite** to load real session messages from opencode DB
- **DeepSeek API** (`prompt_cache_hit_tokens` field) to measure REAL provider cache behavior across compaction cycles
- **MiniLM-v6** (via PyTorch CUDA + sentence-transformers) for semantic similarity verification of locally cached conversions
- **Fingerprint hashing** for cache key stability measurement

## Key Insight from DeepSeek KV Cache Docs

**Source**: [DeepSeek Context Caching docs](https://api-docs.deepseek.com/guides/kv_cache)

DeepSeek's provider cache does NOT require exact message match. It detects **common prefixes** across multiple requests and persists them as independent cache units:

- Request 1: `[system prompt] [long document] [question A]` → persists cached prefix at user-input boundary
- Request 2: `[system prompt] [long document] [question B]` → suffix differs, NO hit, BUT system detects `[system prompt] + [long document]` as common → persists it
- Request 3: `[system prompt] [long document] [question C]` → HITS the cached common prefix

**Implication for compaction**: After our system prompt fix (same `anthropic.txt` for both chat and compaction), the head messages form a stable prefix that DeepSeek caches automatically. The first N messages of every turn (whether chat or compaction) share the same prefix → free cache hits from the provider.

**Implication for local caching**: A per-message cache benefits from exact-match when messages haven't changed. But we should ALSO measure whether semantically-similar-yet-not-identical messages could be cached (e.g., tool output truncated at slightly different boundaries). MiniLM-v6 embeddings let us quantify the semantic overlap.

## Experiment Design

### Phase 1: Fingerprint stability test (TypeScript)

**Script**: `experiments/20260609_cache_semantics/fingerprint_test.ts`

**Inputs**:
- Session ID from `.opencode/data/` SQLite DB
- Load all messages + parts via `MessageV2.stream(sessionID)`

**Output** (JSON): For each message, produce:
```json
{
  "message_id": "msg_abc",
  "role": "user",
  "fingerprint_v1": "abc123",
  "part_count": 5,
  "part_types": ["text", "file", "text", "tool", "text"],
  "model_message_snippet": "first 100 chars..."
}
```

**Verification**:
- Run twice on same session → fingerprints must be identical (100% stability)
- Modify one part (simulate tool output update) → only that message's fingerprint changes
- Modify text part content → fingerprint changes (content-length part of fingerprint)

### Phase 2: Semantic alignment test (TypeScript + Python)

**Scripts**:
- `convert_dump.ts` — TypeScript: loads session, runs `toModelMessagesEffect()`, outputs:
  ```json
  {
    "messages": [
      {
        "id": "msg_abc",
        "fingerprint": "abc123",
        "model_content": "full text content of converted message",
        "parts": ["text", "file"]
      }
    ]
  }
  ```
- `semantic_verify.py` — Python: loads two dumps (before/after simulated changes), computes embeddings, reports alignment

**Python flow**:
```python
from sentence_transformers import SentenceTransformer
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cuda")

for msg in dump1.messages:
    match = dump2.messages.get(msg.id)
    if not match: continue
    
    emb1 = model.encode(msg.model_content)
    emb2 = model.encode(match.model_content)
    similarity = cosine_similarity(emb1, emb2)
    
    same_fingerprint = msg.fingerprint == match.fingerprint
    
    results.append({
        "id": msg.id,
        "fingerprint_match": same_fingerprint,
        "semantic_similarity": similarity,
        "verdict": "PASS" if (same_fingerprint and similarity > 0.95) or (not same_fingerprint and similarity < 0.90) else "INCONCLUSIVE"
    })
```

**Purpose**: Prove zero false positives (fingerprint match → semantic content identical) and minimal false negatives (fingerprint change → content actually changed).

### Phase 3: Compaction cycle simulation (TypeScript)

**Script**: `cache_simulate.ts`

Simulates multiple compaction cycles on a real session:
1. Load all messages
2. Cycle 1: `select()` head/tail, convert head via `toModelMessagesEffect()`, cache fingerprints → UIMessages
3. Simulate new messages being added (use real subsequent messages from the session)
4. Cycle 2: new head (old head + compaction pair + some old tail now in head), convert, measure cache hits
5. Repeat for N cycles

**Metrics reported**:
| Metric | Description |
|--------|-------------|
| Cache hit rate | % of messages with matching fingerprint |
| Conversion time saved | Time difference (cached vs fresh) |
| Total messages processed | Per cycle |
| Messages converted vs cached | Absolute counts |

### Phase 4: Real session validation (Python)

**Script**: `real_validate.py`

Uses a real session from the opencode DB to validate end-to-end:
1. Connect to SQLite DB directly using Python `sqlite3`
2. Read messages + parts
3. Compute MiniLM-v6 embeddings for all model message texts
4. Simulate compaction cycles, compare cached vs fresh embeddings
5. Generate a summary report with:
   - Semantic similarity distribution (histogram)
   - Cache hit vs miss breakdown
   - Any outliers (messages where fingerprint matches but similarity < 0.95)

## Files

```
packages/opencode/test/experiments/20260609_cache_semantics/
├── README.md              # Experiment description, setup, run instructions
├── fingerprint_test.ts    # Phase 1: fingerprint stability
├── convert_dump.ts        # Phase 2: TypeScript side — dump model conversions
├── semantic_verify.py     # Phase 2: Python side — MiniLM-v6 semantic comparison
├── cache_simulate.ts      # Phase 3: compaction cycle cache simulation
├── real_validate.py       # Phase 4: real session validation with embeddings
├── run.sh                 # Orchestration: run all in order
└── results/               # Output directory (gitignored)
    ├── fingerprints.json  # Phase 1 output
    ├── dump_before.json   # Phase 2 output
    ├── dump_after.json    # Phase 2 output
    ├── semantic_report.md # Phase 2/4 report
    └── cache_metrics.json # Phase 3 output
```

**Why `packages/opencode/test/experiments/`**: The `@/` path alias (e.g., `import { MessageV2 } from "@/session/message-v2"`) only resolves within `packages/opencode/tsconfig.json`. Scripts at repo root can't use these imports. Placing experiments inside the package tree keeps them near the code they're testing and reuses the existing module resolution.

**Boilerplate for TS scripts**: Every TypeScript experiment script needs this preamble to access the DB and Effect runtime:

```ts
import * as Global from "@opencode-ai/core/global"
import { Database } from "@/storage/db"
import { Effect } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect-logger"

// Initialize worktree context for Database.use()
const worktree = process.cwd()  // repo root = worktree
Global.initFromWorktree(worktree)

// For toModelMessagesEffect:
import { toModelMessagesEffect } from "@/session/message-v2"
const result = await Effect.runPromise(
  toModelMessagesEffect(messages, model).pipe(
    Effect.provide(EffectLogger.layer)
  )
)
```

## Dependencies

**TypeScript**:
- Uses existing opencode internals: `MessageV2.stream()`, `MessageV2.toModelMessagesEffect()`, SQLite via Drizzle
- Run via `bun run experiments/20260609_cache_semantics/cache_simulate.ts`

**Python** (new dependencies, install once):
```bash
pip install sentence-transformers torch numpy scipy
```
- `sentence-transformers` with `all-MiniLM-L6-v2` (80MB model, 384-dim embeddings)
- `torch` with CUDA (already available per adm.json config)

## Success Criteria

| Criterion | Threshold | Phase |
|-----------|-----------|-------|
| Fingerprint stability | 100% same-session repeatability | 1 |
| Fingerprint sensitivity | Changes when part content changes | 1 |
| Semantic similarity (cache hit) | > 0.95 cosine similarity | 2, 4 |
| Semantic similarity (cache miss) | < 0.90 cosine similarity | 2, 4 |
| Cache hit rate (cycle 2+) | > 40% of head messages | 3 |
| Conversion time reduction | > 30% vs fresh conversion | 3 |
| Zero false positives | No fingerprint match with similarity < 0.95 | 2, 4 |

## Non-goals

- NOT a production implementation — results inform production design
- NOT testing with very long contexts (>2000 messages) — focused on correctness, not scale
- NOT modifying opencode source — purely experimental code in `experiments/`

## File Structure

All scripts are standalone — they import from the opencode codebase (TypeScript) or use vanilla Python (no opencode dependency). Results are written to `results/` which is gitignored.
