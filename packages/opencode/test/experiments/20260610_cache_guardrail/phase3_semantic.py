#!/usr/bin/env python3
"""
Phase 3: Semantic Equivalence Detection

Uses MiniLM-v6 embeddings to detect when two pieces of content are
semantically equivalent despite byte-level differences. This enables
the guardrail to recognize cache-stable content.

Install: pip install sentence-transformers torch numpy scipy
Run:     python test/experiments/20260610_cache_guardrail/phase3_semantic.py
"""

import json
import sys
import os
from pathlib import Path
from typing import Optional

# ── Setup ───────────────────────────────────────────────────────────────────

TRY_SENTENCE_TRANSFORMERS = True
try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    TRY_SENTENCE_TRANSFORMERS = False
    print("[WARN] sentence-transformers not installed. Use: pip install sentence-transformers")
    print("[INFO] Running in character-ngram fallback mode (limited accuracy)")

import numpy as np

# Paths
HERE = Path(__file__).parent
FIXTURES_DIR = HERE / "fixtures"
RESULTS_DIR = HERE / "results"
FACT_PAIRS_FILE = FIXTURES_DIR / "fact_pairs.json"

os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(FIXTURES_DIR, exist_ok=True)

# ── Model ───────────────────────────────────────────────────────────────────

_model: Optional[SentenceTransformer] = None

def get_model():
    """Lazy-load MiniLM-v6 on GPU if available."""
    global _model
    if _model is None and TRY_SENTENCE_TRANSFORMERS:
        device = "cuda" if _has_cuda() else "cpu"
        print(f"[INFO] Loading all-MiniLM-L6-v2 on {device}...")
        _model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device=device)
    return _model

def _has_cuda() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False

# ── Character ngram fallback (when sentence-transformers not installed) ─────

def char_ngram_similarity(a: str, b: str, n: int = 4) -> float:
    """Simple character n-gram Jaccard similarity as fallback."""
    a_ngrams = set(a[i:i+n] for i in range(max(0, len(a) - n + 1)))
    b_ngrams = set(b[i:i+n] for i in range(max(0, len(b) - n + 1)))
    if not a_ngrams or not b_ngrams:
        return 0.0
    intersection = a_ngrams & b_ngrams
    union = a_ngrams | b_ngrams
    return len(intersection) / len(union)

# ── Core Functions ──────────────────────────────────────────────────────────

def semantic_similarity(text_a: str, text_b: str) -> float:
    """Compute cosine similarity between two text embeddings."""
    if not text_a.strip() or not text_b.strip():
        return 0.0
    
    model = get_model()
    if model is not None:
        emb = model.encode([text_a, text_b], normalize_embeddings=True)
        return float(np.dot(emb[0], emb[1]))
    
    # Fallback: character ngram similarity
    return char_ngram_similarity(text_a.lower(), text_b.lower())


def extract_facts(markdown: str) -> list[str]:
    """Extract bullet-point facts from a markdown section.
    
    Recognizes:
    - Lines starting with "- " or "* " (bullet lists)
    - Continuation lines (indented) are joined to their parent bullet
    - Section headers (##, ###) reset the current fact context
    """
    # Split into sections first, then extract facts per section
    lines = markdown.split("\n")
    facts = []
    current = ""
    
    for line in lines:
        stripped = line.strip()
        
        # Section headers break current fact and start new context
        if stripped.startswith("#"):
            if current:
                facts.append(current.strip())
                current = ""
            continue
        
        if stripped.startswith("- ") or stripped.startswith("* "):
            if current:
                facts.append(current.strip())
            current = stripped[2:]  # Remove "- " or "* "
        elif current and (line.startswith("  ") or line.startswith("\t")):
            current += " " + stripped
        elif current and stripped and not stripped.startswith("#"):
            # Continuation line in multi-paragraph bullet
            current += "\n" + stripped
    
    if current:
        facts.append(current.strip())
    
    return facts


def match_facts(
    old_facts: list[str],
    new_facts: list[str],
    threshold: float = 0.75,
) -> list[dict]:
    """Match old facts to new facts by semantic similarity.
    
    Returns list of matches: [{old_idx, new_idx, old_text, new_text, similarity, matched}]
    Uses greedy matching: each old fact is paired with best-matching new fact.
    """
    if not old_facts or not new_facts:
        return []
    
    # Compute similarity matrix
    matrix = np.zeros((len(old_facts), len(new_facts)))
    for i, old in enumerate(old_facts):
        for j, new in enumerate(new_facts):
            matrix[i, j] = semantic_similarity(old, new)
    
    # Greedy matching: for each old fact, find best new match
    matches = []
    used_new = set()
    
    for i in range(len(old_facts)):
        if np.max(matrix[i]) < threshold:
            matches.append({
                "old_idx": i,
                "new_idx": None,
                "old_text": old_facts[i],
                "new_text": None,
                "similarity": float(np.max(matrix[i])),
                "matched": False,
            })
            continue
        
        # Find best unmatched new fact
        best_j = -1
        best_sim = -1
        for j in range(len(new_facts)):
            if j in used_new:
                continue
            if matrix[i, j] > best_sim:
                best_sim = matrix[i, j]
                best_j = j
        
        matches.append({
            "old_idx": i,
            "new_idx": best_j,
            "old_text": old_facts[i],
            "new_text": new_facts[best_j],
            "similarity": float(best_sim),
            "matched": best_sim >= threshold,
        })
        if best_j >= 0:
            used_new.add(best_j)
    
    return matches


def classify_fact_change(old_md: str, new_md: str, threshold: float = 0.75) -> dict:
    """Analyze how facts changed between two versions of content.
    
    Returns:
        identical: exact text matches
        semantically_same: reworded but same meaning (high similarity)
        added: new facts not in old
        removed: old facts not in new
        modified: changed meaning (low similarity for paired facts)
        cache_stability: fraction of content that could be cached
    """
    old_facts = extract_facts(old_md)
    new_facts = extract_facts(new_md)
    
    matches = match_facts(old_facts, new_facts, threshold)
    
    identical = []
    semantically_same = []
    modified = []
    removed = []
    
    for m in matches:
        if m["matched"] and m["similarity"] > 0.98:
            identical.append(m)
        elif m["matched"]:
            semantically_same.append(m)
        elif m["new_idx"] is None:
            removed.append(m)
        else:
            modified.append(m)
    
    # New facts not matched to any old fact
    matched_new_idxs = {m["new_idx"] for m in matches if m["new_idx"] is not None}
    added = []
    for j in range(len(new_facts)):
        if j not in matched_new_idxs:
            added.append({
                "new_idx": j,
                "new_text": new_facts[j],
            })
    
    # Cache stability: % of tokens in content that are cache-stable
    # (identical facts + semantically_same facts' tokens can be considered cache-stable)
    total_fact_count = max(len(old_facts), len(new_facts))
    stable_count = len(identical) + len(semantically_same)
    cache_stability = stable_count / total_fact_count if total_fact_count > 0 else 1.0
    
    return {
        "summary": {
            "identical": len(identical),
            "semantically_same": len(semantically_same),
            "added": len(added),
            "removed": len(removed),
            "modified": len(modified),
            "cache_stability": round(cache_stability, 3),
        },
        "identical": identical,
        "semantically_same": semantically_same,
        "added": added,
        "removed": removed,
        "modified": modified,
    }


def calibrate_threshold(labeled_pairs: list[dict]) -> float:
    """Find optimal similarity threshold that maximizes F1 on labeled data."""
    if not labeled_pairs:
        return 0.75  # default
    
    similarities = []
    labels = []
    
    for pair in labeled_pairs:
        sim = semantic_similarity(pair["old"], pair["new"])
        similarities.append(sim)
        labels.append(1 if pair["label"] == "same" else 0)
    
    similarities = np.array(similarities)
    labels = np.array(labels)
    
    best_threshold = 0.75
    best_f1 = 0.0
    
    for t in np.arange(0.4, 0.98, 0.01):
        predictions = (similarities > t).astype(int)
        
        tp = np.sum((predictions == 1) & (labels == 1))
        fp = np.sum((predictions == 1) & (labels == 0))
        fn = np.sum((predictions == 0) & (labels == 1))
        
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        
        if f1 > best_f1:
            best_f1 = f1
            best_threshold = float(t)
    
    print(f"[INFO] Best threshold: {best_threshold:.2f} (F1={best_f1:.3f})")
    return best_threshold


# ── Self-test ───────────────────────────────────────────────────────────────

def _create_sample_data():
    """Create sample calibration data if not exists."""
    if FACT_PAIRS_FILE.exists():
        return
    
    sample_pairs = [
        {"old": "Fixed null-byte JSON parse error in acp/agent.ts", "new": "Resolved JSON Parse error (null bytes) in agent.ts", "label": "same"},
        {"old": "Added sanitizeText() function to strip control characters", "new": "Implemented text sanitization helper for null bytes", "label": "same"},
        {"old": "EWMA metrics removed from health-window.ts", "new": "Replaced EWMA with p50 medians in health scoring", "label": "same"},
        {"old": "Removed hardcoded hideDetails for webfetch/task/skill", "new": "Tools now display output by default (webfetch, task, skill)", "label": "same"},
        {"old": "Log payload naming changed to timestamp with milliseconds", "new": "Payload files now use ISO timestamps instead of counters", "label": "same"},
        {"old": "Fixed TS errors at lines 457 and 952", "new": "Resolved TypeScript compilation errors in agent module", "label": "same"},
        {"old": "Compaction system prompt changed to match main agent", "new": "Added GPU acceleration for embedding computation", "label": "different"},
        {"old": "Updated compaction tests to handle new cache behavior", "new": "Wrote new integration tests for the gateway module", "label": "different"},
        {"old": "Replaced InlineTool renderBefore with static margin", "new": "Improved TUI rendering performance by removing signal writes", "label": "same"},
        {"old": "DeepSeek model ID changed from v3 to v4-pro", "new": "Updated model configuration to use latest DeepSeek version", "label": "same"},
        {"old": "Added type-safe error handling to llm.ts", "new": "Removed database indexes for query optimization", "label": "different"},
        {"old": "Parallelized compaction estimate calls", "new": "Changed concurrency from sequential to unbounded", "label": "same"},
        {"old": "Moved date out of system prompt to preserve cache", "new": "Added new system prompt section for environment variables", "label": "different"},
        {"old": "Added p50 median computation to health-window.ts", "new": "Implemented circular buffer median helper function", "label": "same"},
        {"old": "Fixed filterCompacted boundary detection bug", "new": "Corrected message ordering in compaction filter", "label": "same"},
    ]
    
    FACT_PAIRS_FILE.write_text(json.dumps(sample_pairs, indent=2))
    print(f"[INFO] Created sample calibration data at {FACT_PAIRS_FILE}")


if __name__ == "__main__":
    print("=" * 60)
    print("Phase 3: Semantic Equivalence Detection")
    print("=" * 60)
    
    _create_sample_data()
    
    # ── Test 1: Basic similarity ────────────────────────────────────────────
    print("\n── Test 1: Basic semantic similarity ──")
    
    test_pairs = [
        ("Fixed null-byte JSON parse error in acp/agent.ts",
         "Resolved JSON Parse error (null bytes) in agent.ts"),
        ("Added sanitizeText() function",
         "Implemented text sanitization helper"),
        ("EWMA metrics removed from health-window.ts",
         "Added GPU acceleration for embedding computation"),
    ]
    
    for old, new in test_pairs:
        sim = semantic_similarity(old, new)
        eq = "SAME" if sim > 0.7 else "DIFFERENT"
        print(f"  {eq} (sim={sim:.3f}): \"{old}\"  ←→  \"{new}\"")
    
    # ── Test 2: Fact extraction ─────────────────────────────────────────────
    print("\n── Test 2: Fact extraction ──")
    
    sample_md = """## Progress
### Done
- Fixed null-byte JSON parse in agent.ts
- Removed EWMA metrics from health scoring
- Added p50 median computation
### In Progress
- Working on cache guardrail integration

## Key Decisions
- Use p50 median instead of EWMA for better outlier resistance
- Cache per-message conversion in toModelMessagesEffect"""
    
    facts = extract_facts(sample_md)
    for i, f in enumerate(facts):
        print(f"  [{i}] {f}")
    
    # ── Test 3: Fact matching ───────────────────────────────────────────────
    print("\n── Test 3: Fact matching ──")
    
    old_md = """### Done
- Fixed null-byte JSON parse error in agent.ts
- Removed EWMA metrics from health scoring
- Added p50 median computation
- Log payload naming changed to timestamps"""
    
    new_md = """### Done
- Resolved JSON Parse error (null bytes) in agent
- Replaced EWMA with p50 medians
- Added circular buffer median function
- Implemented GPU acceleration for embeddings"""
    
    result = classify_fact_change(old_md, new_md)
    
    print(f"  Summary: {json.dumps(result['summary'], indent=4)}")
    for cat in ["identical", "semantically_same", "modified"]:
        if result[cat]:
            print(f"\n  {cat}:")
            for item in result[cat]:
                old_t = item.get("old_text", "")[:60]
                new_t = item.get("new_text", "")[:60]
                sim = item.get("similarity", 0)
                print(f"    sim={sim:.3f}: \"{old_t}\" → \"{new_t}\"")
    
    # ── Test 4: Threshold calibration ───────────────────────────────────────
    print("\n── Test 4: Threshold calibration ──")
    
    if FACT_PAIRS_FILE.exists():
        labeled = json.loads(FACT_PAIRS_FILE.read_text())
        threshold = calibrate_threshold(labeled)
        print(f"  Calibrated threshold: {threshold:.2f}")
    else:
        print("  No calibration data found. Using default threshold: 0.75")
    
    print("\n[DONE] Phase 3 complete.")
