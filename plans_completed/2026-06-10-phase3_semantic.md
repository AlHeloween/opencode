# Phase 3: Semantic Equivalence Detection

Date: 2026-06-10  
Master Plan: `plans/20260610_cache_guardrail_master.md`  
Status: Plan

## Goal

Detect when two pieces of content are semantically equivalent despite byte-level differences. This enables the guardrail to recognize that content is "close enough" to hit the cache, even when the exact token sequence differs.

## The Problem

Example: two compaction summary sections for "Progress → Done":

```
Old: "- Fixed the null-byte JSON parse error in acp/agent.ts"
New: "- Resolved JSON Parse error (null bytes) in agent.ts:acp"
```

Byte-level: COMPLETELY different → token divergence → cache miss.  
Semantic: SAME fact, reworded → SHOULD be a cache hit.

The prefix cache requires EXACT token match at the byte level. Semantic equivalence CANNOT directly fix the cache divergence. BUT it can inform:
1. **Warning**: "This fact changed wording but not meaning — consider reusing original text for cache"
2. **Restructuring**: Move semantically-equivalent content to a position where divergence doesn't matter
3. **Fact-based caching**: Cache individual facts, not sequential text

## Insight: Facts Lists vs Sequential Text

Compaction summaries are **facts lists** (bulleted items), not sequential prose. Each bullet is a standalone fact:

```
## Progress
### Done
- [fact 1]
- [fact 2]
- [fact 3]
### In Progress
- [fact 4]
```

When fact 3 is removed and facts 1,2,4 stay the same, the prefix cache breaks at fact 3's position (where removal occurred). All subsequent facts (even unchanged ones) are cache misses.

**Solution**: Structure content so INDEPENDENT facts are at positions where their individual cache behavior doesn't cascade to others. This is a content-layout problem.

## Method

### Semantic similarity measurement

```python
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device="cuda")

def semantic_similarity(text_a: str, text_b: str) -> float:
    emb_a = model.encode(text_a, normalize_embeddings=True)
    emb_b = model.encode(text_b, normalize_embeddings=True)
    return float(np.dot(emb_a, emb_b))
```

### Fact extraction and matching

```python
def extract_facts(text: str) -> list[str]:
    """Extract bullet-point facts from a section."""
    # Parse markdown bullets: lines starting with "- " or "* "
    # Group multi-line bullets (continuation lines)
    pass

def match_facts(old_facts: list[str], new_facts: list[str]) -> list[tuple]:
    """Match old facts to new facts by semantic similarity."""
    # Build similarity matrix: len(old) x len(new)
    # Use Hungarian algorithm for optimal matching
    # Return: [(old_idx, new_idx, similarity), ...]
    pass

def classify_fact_change(old_facts, new_facts) -> FactChangeReport:
    return {
        "identical": [...],       # exact match (cache hits)
        "semantically_same": [...],  # reworded but same meaning (cache miss but could be hit)
        "added": [...],           # new facts
        "removed": [...],         # deleted facts
        "modified": [...],        # changed meaning
        "cache_stability": 0.0-1.0,  # % of facts that are cacheable
    }
```

### Threshold calibration

Run on a dataset of 100+ fact pairs with human labels:
- **Same**: Both humans agree facts convey the same information
- **Different**: Facts convey different information

Find the optimal cosine similarity threshold that maximizes F1:

```python
thresholds = np.arange(0.5, 0.99, 0.01)
for t in thresholds:
    predictions = (similarity_matrix > t)
    precision = tp / (tp + fp)
    recall = tp / (tp + fn)
    f1 = 2 * precision * recall / (precision + recall)
```

## Deliverable

**Script**: `phase3_semantic.py`

Functions:
```python
def semantic_similarity(a: str, b: str) -> float
def extract_facts(markdown: str) -> list[str]
def match_facts(old: list[str], new: list[str]) -> list[Match]
def classify_fact_change(old: str, new: str) -> FactChangeReport
def calibrate_threshold(labeled_pairs: list) -> float
```

**Data file**: `fixtures/fact_pairs.json` — 100+ labeled fact pairs for calibration

```json
[
  {"old": "Fixed null-byte JSON parse in agent.ts", "new": "Resolved JSON Parse with null bytes in agent", "label": "same"},
  {"old": "Added sanitizeText() to strip null bytes", "new": "Implemented output sanitization with regex", "label": "same"},
  {"old": "EWMA metrics removed from health-window.ts", "new": "Added p50 median to health scoring", "label": "different"}
]
```

## Integration with Phase 2

When Phase 2 detects `"message_modified"` or `"part_modified"`, Phase 3 checks:
1. Extract facts from old and new content
2. Match semantically equivalent facts
3. Report which facts are cache-stable (untouched or reworded)
4. If >80% of facts are stable → suggest restructuring to move stable facts before divergent ones

## Limitation

Semantic equivalence does NOT directly enable cache hits — the cache requires byte-level match. It enables:
1. **Detection**: "These facts are semantically the same but token-different → cache miss expected"
2. **Restructuring guidance**: "Move these facts to the stable prefix region"
3. **Warning**: "Consider keeping original wording for cache stability"

## Reference

Table and unit tests in this Phase are the **foundation** for the guardrail prototype (Phase 4).
