"""Does ΔSV discriminate when it is computed on EMBEDDINGS instead of on the written weights?

The owner's point (2026-09-22): «для математики это никак. Но для трансформера и ембеддинг модели
более чем норм». That is testable against the artefact already in the tree — the 2026-08-16
cot-semantic-map experiment embedded the CoT segments and the SV blocks into one space
(embeddings.npy, sv.jsonl, overlay_map.html).

What this measures:
  1. the shape of the stored embeddings, and whether their count matches sv.jsonl;
  2. consecutive cosine distances — the real ΔSV — and where its distribution sits (the term-L1
     version saturated at the ceiling: median 2.0 of a 0..2 range, because written terms share
     nothing between neighbours);
  3. whether the largest embedding jumps coincide with the DECLARED chain breaks (prev-md5 not
     matching the previous md5). Two independent signals landing on the same places would validate
     both; if they do not coincide, that is a finding too, and it says the chain break is about the
     WRITER's bookkeeping rather than about semantic movement.

Run: python experiments/2026-09-22_sv-embeddings/measure.py
"""

import json
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "2026-08-16_cot-semantic-map"


def cosine(u, v) -> float:
    dot = sum(a * b for a, b in zip(u, v))
    nu = sum(a * a for a in u) ** 0.5
    nv = sum(b * b for b in v) ** 0.5
    return dot / (nu * nv) if nu and nv else 0.0


def main() -> int:
    try:
        import numpy as np  # type: ignore
    except Exception as exc:
        print(f"numpy unavailable ({exc}) — cannot read the stored embeddings")
        return 1

    vectors = np.load(SOURCE / "embeddings.npy")
    print(f"embeddings.npy: shape {vectors.shape}, dtype {vectors.dtype}")

    sv_path = SOURCE / "sv.jsonl"
    entries = [json.loads(line) for line in sv_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    print(f"sv.jsonl: {len(entries)} vectors with keywords")

    if len(entries) != len(vectors):
        print(
            f"\nCOUNT MISMATCH: {len(vectors)} embeddings against {len(entries)} vectors — the 768-d "
            "matrix belongs to the CoT segments, so it cannot answer a question about the SV side. "
            "Falling through to the artefact that CAN: sv_map_data.json, which carries the distances "
            "the 2026-08 experiment computed per vector (dg, dp) and the class it assigned."
        )
        return measure_stored(SOURCE)


def measure_embeddings(source: Path) -> int:
    """The decisive measurement: embed the SV texts and ask whether consecutive cosine distance
    discriminates. The stored `dg`/`dp` cannot answer it — they are the chain indicator (2.0 broken /
    0.0 linked) and a saturating term distance, the same quantities measured today."""
    import os

    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
    except Exception as exc:
        print(f"sentence-transformers unavailable ({exc})")
        return 1

    cache = Path(os.environ.get("HF_HOME") or (Path.home() / ".cache" / "huggingface")) / "hub"
    available = sorted(p.name.removeprefix("models--").replace("--", "/") for p in cache.glob("models--*")) if cache.exists() else []
    print(f"\ncached models: {len(available)}")
    for name in available[:20]:
        print(f"  {name}")
    if not available:
        print("\nUNKNOWN: no cached embedder, so ΔSV on embeddings stays unmeasured — an Unknown is a "
              "result, and naming what it would take beats pretending the term numbers settle it.")
        return 0

    preferred = [
        "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",
        "sentence-transformers/LaBSE",
        "BAAI/bge-m3",
        "intfloat/multilingual-e5-base",
    ]
    chosen = next((name for name in preferred if name in available), available[0])
    print(f"\nembedding with: {chosen}")
    # GPU, ALWAYS (AGENTS.md: «never run neural networks on the CPU»). The device is pinned by hand
    # because this torch build raises inside get_device_name() (`torch.distributed.is_initialized`
    # is missing) — pinning is the workaround for that, and CPU was never the answer to it: that is
    # what made this probe look like a slow one.
    model = SentenceTransformer(chosen, device="cuda")

    payload = json.loads((source / "sv_map_data.json").read_text(encoding="utf-8"))
    points = payload.get("points", [])
    texts = [
        (point.get("dominant") or "") + " | " + ", ".join(entry["k"] for entry in point.get("keywords", []))
        for point in points
    ]
    vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)

    distances = []
    for index in range(1, len(vectors)):
        dot = float(sum(a * b for a, b in zip(vectors[index - 1], vectors[index])))
        distances.append((1.0 - dot, index))
    values = sorted(value for value, _ in distances)
    print(f"\nconsecutive cosine distance over {len(values)} pairs: "
          f"min {values[0]:.3f} / median {values[len(values) // 2]:.3f} / "
          f"p90 {values[int(len(values) * 0.9)]:.3f} / max {values[-1]:.3f}")
    for threshold in (0.05, 0.1, 0.2, 0.3, 0.4):
        hits = sum(1 for value in values if value >= threshold)
        print(f"  Δ >= {threshold:<5} → {hits:>3} of {len(values)} ({100.0 * hits / len(values):.1f}%)")

    print("\nlargest jumps:")
    for value, index in sorted(distances, reverse=True)[:6]:
        print(f"  Δ={value:.3f} seq {index} · {(points[index].get('dominant') or '')[:80]}")

    # THE CONTROL THAT MAKES THE NUMBER MEAN SOMETHING: the same vector set compared against
    # STRANGERS. Without it, «median 0.437» is a number with no yardstick - it would look equally
    # convincing whether the anchors walk or ricochet.
    import random

    random.seed(20260922)
    stranger_values = []
    for _ in range(3000):
        i = random.randrange(len(vectors))
        j = random.randrange(len(vectors))
        if i == j:
            continue
        dot = float(sum(a * b for a, b in zip(vectors[i], vectors[j])))
        stranger_values.append(1.0 - dot)
    stranger_values.sort()
    stranger_median = stranger_values[len(stranger_values) // 2]
    consecutive_median = values[len(values) // 2]
    print(f"\nstrangers (random pairs): median {stranger_median:.3f} / "
          f"p10 {stranger_values[int(len(stranger_values) * 0.1)]:.3f} / "
          f"p90 {stranger_values[int(len(stranger_values) * 0.9)]:.3f}")
    print(f"RATIO consecutive/strangers: {consecutive_median / stranger_median:.3f}  "
          f"(≈1 means the anchors are no closer to each other than to strangers)")

    # Does the DECLARED break agree with semantic movement? `dg >= 1` is the August run's own
    # chain-break indicator (stored 2.0 broken / 0.0 linked).
    declared = [index for index, point in enumerate(points) if isinstance(point.get("dg"), (int, float)) and point["dg"] >= 1.0]
    if declared:
        top = sorted(distances, reverse=True)[: len(declared)]
        overlap = len({index for _, index in top} & set(declared))
        print(f"\ndeclared chain breaks in this set: {len(declared)} of {len(points) - 1} pairs; "
              f"the {len(declared)} largest embedding jumps share {overlap} of them")
    return 0


def measure_stored(source: Path) -> int:
    """The distances the August run already computed, read literally."""
    payload = json.loads((source / "sv_map_data.json").read_text(encoding="utf-8"))
    points = payload.get("points", [])
    if not points:
        print("sv_map_data.json has no points")
        return 1

    classes: dict[str, int] = {}
    for point in points:
        classes[point.get("class", "?")] = classes.get(point.get("class", "?"), 0) + 1
    print(f"\nvectors: {len(points)}")
    print(f"classes assigned by that run: {classes}")

    dg = [point.get("dg") for point in points if isinstance(point.get("dg"), (int, float))]
    dp = [point.get("dp") for point in points if isinstance(point.get("dp"), (int, float))]
    for name, values in (("dg", dg), ("dp", dp)):
        if not values:
            continue
        ordered = sorted(values)
        print(
            f"{name}: n {len(values)} · min {ordered[0]:.3f} / median {ordered[len(ordered) // 2]:.3f} / "
            f"p90 {ordered[int(len(ordered) * 0.9)]:.3f} / max {ordered[-1]:.3f}"
        )
        for threshold in (0.3, 0.4, 0.6, 1.0):
            hits = sum(1 for value in values if value >= threshold)
            print(f"  {name} >= {threshold:<4} → {hits:>3} of {len(values)} ({100.0 * hits / len(values):.1f}%)")

    # Which of the two signals is the CLASS built on? If the class is a threshold on a value that
    # fires on almost everything, it is not a discriminator and the August run had the same problem
    # the term-L1 measurement had today.
    for key in ("dg", "dp"):
        for label in ("stable", "divergence"):
            subset = [point.get(key) for point in points if point.get("class") == label]
            numeric = [value for value in subset if isinstance(value, (int, float))]
            if numeric:
                print(f"  class {label:<11} {key}: median {sorted(numeric)[len(numeric) // 2]:.3f} (n {len(numeric)})")
    return measure_embeddings(source)

    distances = []
    for index in range(1, len(entries)):
        distances.append((1.0 - cosine(vectors[index - 1], vectors[index]), index))
    values = sorted(d for d, _ in distances)
    median = values[len(values) // 2]
    print(
        f"\nconsecutive cosine distance: min {values[0]:.3f} / median {median:.3f} / "
        f"p90 {values[int(len(values) * 0.9)]:.3f} / max {values[-1]:.3f}   (range 0..2)"
    )
    for threshold in (0.1, 0.2, 0.3, 0.4, 0.6):
        hits = sum(1 for value in values if value >= threshold)
        print(f"  Δ >= {threshold:<4} → {hits:>3} of {len(values)} ({100.0 * hits / len(values):.1f}%)")

    breaks = []
    for previous, current in zip(entries, entries[1:]):
        if current.get("prev_md5") and previous.get("md5") and current["prev_md5"] != previous["md5"]:
            breaks.append(current["seq"])
    print(f"\ndeclared chain breaks in this set: {len(breaks)} of {len(entries) - 1}")

    if breaks:
        top = sorted(distances, reverse=True)[: len(breaks)]
        top_indexes = {index for _, index in top}
        overlap = len(top_indexes & set(breaks))
        print(f"the {len(breaks)} largest embedding jumps share {overlap} indexes with the breaks")
        print("  (a low overlap says the two signals measure different things — which is worth knowing)")

    print("\nlargest embedding jumps:")
    for value, index in sorted(distances, reverse=True)[:8]:
        entry = entries[index]
        print(f"  Δ={value:.3f} seq {index} {entry.get('dominant', '')[:90]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
