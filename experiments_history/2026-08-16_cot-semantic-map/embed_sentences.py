"""Embed CoT sentences with a local BGE model (the parallel model).

Reads sentences.jsonl, encodes with BAAI/bge-base-en-v1.5 (same embedder the
RAG system uses), writes embeddings.npy aligned 1:1 with sentences.jsonl.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch

# This host runs a GPU-specific torch build without torch.distributed.
# sentence_transformers' get_device_name() probes torch.distributed when
# cuda is available — shim it so the probe falls through to cuda:0.
if not hasattr(torch.distributed, "is_initialized"):
    torch.distributed.is_initialized = lambda: False

from sentence_transformers import SentenceTransformer  # noqa: E402

DIR = Path(__file__).parent
MODEL_NAME = "BAAI/bge-base-en-v1.5"


def main() -> None:
    lines = [json.loads(l) for l in (DIR / "sentences.jsonl").read_text(encoding="utf-8").splitlines()]
    texts = [l["text"] for l in lines]
    print(f"{len(texts)} sentences, loading {MODEL_NAME} ...")
    model = SentenceTransformer(MODEL_NAME)
    embs = model.encode(
        texts,
        batch_size=64,
        normalize_embeddings=True,
        show_progress_bar=True,
    )
    np.save(DIR / "embeddings.npy", embs)
    print(f"saved {embs.shape} -> {DIR / 'embeddings.npy'}")


if __name__ == "__main__":
    main()
