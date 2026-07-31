"""Kernel fragment: 04_delta (former monofile L301-335)."""


DELTA_STABLE: float = 0.3
DELTA_SHIFT: float = 0.5


def delta_l1(sv_curr: dict[str, float], sv_last: dict[str, float]) -> float:
    """Δ_L1 = sum_{k in K} |w_k_curr - w_k_last|"""
    keys = set(sv_curr.keys()) | set(sv_last.keys())
    return sum(abs(sv_curr.get(k, 0.0) - sv_last.get(k, 0.0)) for k in keys)


def delta_cos(e_curr: list[float], e_anchor: list[float]) -> float:
    """Δ_cos = 1 - cosine_similarity(e_curr, e_anchor)."""
    if len(e_curr) != len(e_anchor):
        raise ValueError(f"Dim mismatch: {len(e_curr)} vs {len(e_anchor)}")
    dot = sum(a * b for a, b in zip(e_curr, e_anchor))
    n1 = math.sqrt(sum(a * a for a in e_curr))
    n2 = math.sqrt(sum(b * b for b in e_anchor))
    if n1 == 0 or n2 == 0: return 1.0
    return 1.0 - (dot / (n1 * n2))


def delta_star(d_l1: float, d_cos: float, d_emd: float = 0.0,
               alpha: float = 0.4, beta: float = 0.4, gamma: float = 0.2) -> float:
    """Δ* = alpha·Δ_L1 + beta·Δ_cos + gamma·Δ_EMD."""
    return alpha * d_l1 + beta * d_cos + gamma * d_emd


def classify_delta(d: float) -> DeltaClass:
    """< 0.3 Stable, 0.3-0.6 Shift, > 0.6 Divergence."""
    if d < DELTA_STABLE: return DeltaClass.STABLE
    elif d < DELTA_SHIFT: return DeltaClass.SHIFT
    else: return DeltaClass.DIVERGENCE


