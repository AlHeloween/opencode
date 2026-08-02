"""Kernel fragment: 04_delta — unified Manhattan (L1) metric throughout the spine.

Single geometry: Manhattan distance on keyword-weight vectors.
d₁(a, b) = Σ|w_a(k) − w_b(k)| over all keys k.

Thresholds:
  DELTA_STABLE = 0.3  — STUCK / CONFIRMATION / stable cluster
  DELTA_SHIFT  = 0.5  — REFINING boundary / candidate filter τ

Cosine and blended metrics removed: L1 is the only geometry for fractal
lattice spaces — it respects topology (holes are real, you cannot walk
through a hole in a Sierpinski gasket).
"""

import math     # noqa: F401 — kept for potential future embedding math


DELTA_STABLE: float = 0.3
DELTA_SHIFT: float = 0.5


def delta_l1(sv_curr: dict[str, float], sv_last: dict[str, float]) -> float:
    """Δ_L1 = sum_{k in K} |w_k_curr - w_k_last| — Manhattan (L1) distance."""
    keys = set(sv_curr.keys()) | set(sv_last.keys())
    return sum(abs(sv_curr.get(k, 0.0) - sv_last.get(k, 0.0)) for k in keys)


def classify_delta(d: float) -> "DeltaClass":
    """< 0.3 Stable, 0.3-0.5 Shift, > 0.5 Divergence."""
    if d < DELTA_STABLE:
        return DeltaClass.STABLE
    elif d < DELTA_SHIFT:
        return DeltaClass.SHIFT
    else:
        return DeltaClass.DIVERGENCE


def adaptive_delta_threshold(
    deltas: list[float],
    margin: float = 0.1,
    fallback: float = 0.3,
    min_n: int = 5,
) -> float:
    """Signal classification threshold from observed noise-signal distribution.

    Fixed δ < 0.3 works for typical sessions, but when signal clusters are
    systematically tighter or looser (different SV granularity, high-noise
    contexts), a fixed threshold can misclassify: CONFIRMATION signals get
    labelled DIVERGENCE and vice versa.

    Strategy: median of observed (non-spike) deltas + `margin`. The median
    captures the "typical" semantic distance in the current context; adding
    a small margin separates CONFIRMATION from DIVERGENCE around that norm.

    Spikes (> 2× median) are excluded before computing — they represent
    true divergences, not normal variation.

    Example:
      deltas = [0.08, 0.10, 0.12, 0.09, 0.85, 0.11]
      median ≈ 0.105 (spike 0.85 excluded)
      → δ_threshold ≈ 0.105 + 0.1 = 0.205
      → 0.08, 0.09, 0.10, 0.11, 0.12 all < 0.205 → CONFIRMATION
      → 0.85 > 0.205 → DIVERGENCE
    """
    if not deltas or len(deltas) < min_n:
        return fallback
    median = sorted(deltas)[len(deltas) // 2]
    if median < 0.001:
        return fallback
    # Exclude spikes > 2× median (true divergences, not normal variation)
    typical = [d for d in deltas if d <= 2.0 * median]
    if len(typical) < min_n:
        return fallback
    median_typical = sorted(typical)[len(typical) // 2]
    return min(0.9, max(0.1, median_typical + margin))
