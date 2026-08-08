"""Embedding pipeline — compute BGE embeddings for dictionary entries.

Uses BAAI/bge-base-en-v1.5 via sentence-transformers.
Embeddings are cached to disk keyed by (model_name, sha256(body)).

Usage:
  python -m prompts_kernel.tools.embed              # compute + cache all
  python -m prompts_kernel.tools.embed --json       # dump vectors as JSON
  python -m prompts_kernel.tools.embed --stats      # cache stats only
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

CACHE_DIR = Path(__file__).resolve().parent / ".embeddings_cache"
MODEL_NAME = "BAAI/bge-base-en-v1.5"
VECTOR_DIM = 768


def _body_hash(body: str) -> str:
    """SHA-256 of body text (deterministic cache key)."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _cache_path(model: str, body_hash: str) -> Path:
    """Cache file path: .embeddings_cache/{model}/{hash}.npy"""
    safe_model = model.replace("/", "_")
    return CACHE_DIR / safe_model / f"{body_hash}.npy"


def _load_cache(model: str, body_hash: str) -> np.ndarray | None:
    """Load cached embedding or None."""
    p = _cache_path(model, body_hash)
    if p.exists():
        return np.load(p)
    return None


def _save_cache(model: str, body_hash: str, vector: np.ndarray) -> None:
    """Save embedding to cache."""
    p = _cache_path(model, body_hash)
    p.parent.mkdir(parents=True, exist_ok=True)
    np.save(p, vector)


def compute_embeddings(
    bodies: dict[str, str],
    model_name: str = MODEL_NAME,
    use_cache: bool = True,
    batch_size: int = 32,
) -> dict[str, np.ndarray]:
    """Compute embeddings for all entry bodies.

    Args:
        bodies: dict[entry_id → resolved_body_text]
        model_name: BGE model to use
        use_cache: skip computation for cached entries
        batch_size: batch size for encoding

    Returns:
        dict[entry_id → np.ndarray of shape (768,)]
    """
    # Work around torch 2.11 alpha compatibility issue
    import torch
    if not hasattr(torch.distributed, 'is_initialized'):
        torch.distributed.is_initialized = lambda: False
    
    from sentence_transformers import SentenceTransformer

    # Split into cached and to-compute
    cached: dict[str, np.ndarray] = {}
    to_compute: dict[str, str] = {}

    for eid, body in bodies.items():
        bh = _body_hash(body)
        if use_cache:
            vec = _load_cache(model_name, bh)
            if vec is not None:
                cached[eid] = vec
                continue
        to_compute[eid] = body

    if not to_compute:
        print(f"All {len(cached)} embeddings cached — nothing to compute.", file=sys.stderr)
        return cached

    print(f"Loading {model_name}...", file=sys.stderr)
    t0 = time.time()
    model = SentenceTransformer(model_name)
    print(f"Model loaded in {time.time() - t0:.1f}s", file=sys.stderr)

    # Sort by body hash for deterministic batching
    items = sorted(to_compute.items(), key=lambda x: _body_hash(x[1]))
    ids = [eid for eid, _ in items]
    texts = [body for _, body in items]

    print(f"Encoding {len(texts)} bodies (batch_size={batch_size})...", file=sys.stderr)
    t0 = time.time()

    # BGE models: prepend "Represent this sentence for searching relevant passages: "
    # for asymmetric retrieval. For symmetric similarity, no prefix needed.
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,  # L2-normalize for cosine similarity
    )

    elapsed = time.time() - t0
    print(f"Encoded in {elapsed:.1f}s ({len(texts)/elapsed:.0f} bodies/s)", file=sys.stderr)

    # Save to cache
    for eid, vec in zip(ids, embeddings):
        bh = _body_hash(to_compute[eid])
        _save_cache(model_name, bh, vec)

    # Merge cached + computed
    result = dict(cached)
    for eid, vec in zip(ids, embeddings):
        result[eid] = vec

    return result


def cache_stats() -> dict:
    """Return cache statistics."""
    if not CACHE_DIR.exists():
        return {"entries": 0, "models": {}, "total_bytes": 0}

    models: dict[str, int] = {}
    total_entries = 0
    total_bytes = 0

    for model_dir in CACHE_DIR.iterdir():
        if model_dir.is_dir():
            count = 0
            for f in model_dir.glob("*.npy"):
                count += 1
                total_bytes += f.stat().st_size
            models[model_dir.name] = count
            total_entries += count

    return {
        "entries": total_entries,
        "models": models,
        "total_bytes": total_bytes,
    }


def main() -> int:
    from prompts_kernel.tools.dictionary import parse_dictionary, resolve_all

    if "--stats" in sys.argv:
        stats = cache_stats()
        print(json.dumps(stats, indent=2))
        return 0

    print("Parsing dictionary...")
    entries = parse_dictionary()
    print(f"Resolving {len(entries)} entries (full DeepResolution)...")
    bodies = resolve_all(entries)

    vectors = compute_embeddings(bodies)

    if "--json" in sys.argv:
        # Output as JSON arrays (compact)
        out = {
            eid: vec.tolist()
            for eid, vec in sorted(vectors.items())
        }
        print(json.dumps(out))
        return 0

    print(f"\nComputed/cached {len(vectors)} embeddings ({VECTOR_DIM}d)")
    stats = cache_stats()
    print(f"Cache: {stats['entries']} entries, {stats['total_bytes']/1024:.0f} KB")

    # Quick check
    norms = [float(np.linalg.norm(v)) for v in vectors.values()]
    print(f"Vector norms: min={min(norms):.4f}, max={max(norms):.4f}, mean={sum(norms)/len(norms):.4f}")
    print("✅ All embeddings ready.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
