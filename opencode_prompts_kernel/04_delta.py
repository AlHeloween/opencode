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
