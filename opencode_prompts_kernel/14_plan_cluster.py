"""Kernel fragment: 14_plan_cluster — fractal planning geometry.

Fractal decomposition (ADID): over-generate lattice → L1 filter → k-medoids.
Supported models: Sierpinski, Quad/Oct-tree, L-System (F→F+F-F).

Pre-flight investigation: cluster planned modifications via k-medoids,
dispatch explorer agent to each centroid BEFORE executing changes.
This prevents "old midware bugs package" surprises — systemic issues
that are invisible from a single file diff.
"""

import math
import random


@dataclass
class PlanModification:
    """One planned edit in a modification plan."""
    target_file: str
    target_module: str       # e.g. "tui.component", "config.permission"
    change_type: str         # "logic", "visual", "data_flow", "api_surface"
    risk: str                # "low", "medium", "high"
    description: str


@dataclass
class PlanCluster:
    """A cluster of related modifications identified by k-medoids.
    The centroid is the most representative modification — the one the
    explorer agent should investigate first."""
    centroid: PlanModification
    members: list[PlanModification]
    cluster_size: int
    findings: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _hash_embed(tokens: list[str], dim: int = 512) -> list[float]:
    """Synthetic embedding: hash each token into `dim` dimensions.
    Tokens earlier in the list get higher weight (1/(i+1) decay).
    Result is L2-normalized."""
    v = [0.0] * dim
    for i, token in enumerate(tokens):
        h = abs(hash(token)) % dim
        v[h] += 1.0 / (i + 1)
    norm = math.sqrt(sum(x * x for x in v))
    if norm > 0:
        v = [x / norm for x in v]
    return v


def embed_modification(mod: PlanModification, dim: int = 512) -> list[float]:
    """Embed a PlanModification into a synthetic vector space.
    Combines: module decomposition, change_type keywords, risk scalar, file path.
    Module "tui.component.dialog" → tokens: ["tui","component","dialog"].
    """
    tokens: list[str] = []
    # Module tokens (most informative — structural locality)
    tokens.extend(mod.target_module.replace(".", " ").replace("_", " ").split())
    # Change type tokens
    tokens.extend(mod.change_type.split("_"))
    # Risk
    tokens.append(f"risk:{mod.risk}")
    # File name (without extension) for co-location clustering
    file_stem = mod.target_file.rsplit(".", 1)[0].rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    tokens.extend(file_stem.replace("-", " ").replace("_", " ").split())
    return _hash_embed(tokens, dim)


def _manhattan_distance(a: list[float], b: list[float]) -> float:
    """L1 distance — sum of absolute coordinate differences.

    Manhattan (L1) is ideal for sparse, high-dimensional embeddings from
    hollow fractal topologies (Sierpinski, etc.). Unlike cosine, it does not
    collapse all points onto a unit sphere surface. Unlike Euclidean, it
    preserves interpretability: each dimension's contribution is directly
    visible as |a_i − b_i|.

    Cosine and Euclidean both place cluster centers in empty fractal voids
    (points that do not actually exist). Manhattan, combined with k-medoids
    (which forces centers to be real observed points), provides double
    protection against empty-space centroids.
    """
    return sum(abs(ai - bi) for ai, bi in zip(a, b))


def k_medoids_modifications(
    modifications: list[PlanModification],
    k: int | None = None,
    use_clara: bool = True,
) -> list[PlanCluster]:
    """Cluster planned modifications via k-medoids (Lloyd-style).

    For N ≥ 100, delegates to CLARA (sampling k-medoids) to avoid O(N²)
    cost. Pass use_clara=False to force exact k-medoids regardless of N.

    Algorithm:
    1. Embed each modification → 512-d vector
    2. k = ceil(N/2) per ADID Mode 2 fractal task generation spec
    3. Initialize k medoids evenly spaced
    4. Iterate: assign→recompute medoid until convergence (max 20 iters)
    5. Return PlanCluster per medoid

    Distance metric: Manhattan (L1) — preserves interpretability in sparse
    fractal embedding spaces and avoids hollow-centroid artifacts.
    """
    if use_clara and len(modifications) >= CLARA_THRESHOLD:
        return clara_k_medoids_modifications(modifications, k)
    N = len(modifications)
    if N == 0:
        return []
    if N == 1:
        return [PlanCluster(
            centroid=modifications[0],
            members=[modifications[0]],
            cluster_size=1,
        )]
    if k is None:
        k = max(1, (N + 1) // 2)  # ceil(N/2)

    k = min(k, N)
    vectors = [embed_modification(m) for m in modifications]

    # Initialize medoids: k evenly spaced indices
    medoid_indices: list[int] = [int(i * (N - 1) / max(k - 1, 1)) for i in range(k)]
    # Deduplicate (when N small relative to k)
    medoid_indices = sorted(set(medoid_indices))[:k]

    for _ in range(20):
        # Assign each point to nearest medoid
        clusters: dict[int, list[int]] = {m: [] for m in medoid_indices}
        for i, vec in enumerate(vectors):
            best_m = min(medoid_indices, key=lambda m: _manhattan_distance(vec, vectors[m]))
            clusters[best_m].append(i)

        # Recompute medoid: point minimizing sum-of-distances within cluster
        new_medoids: list[int] = []
        for m_idx, member_indices in clusters.items():
            if not member_indices:
                new_medoids.append(m_idx)
                continue
            best = min(member_indices, key=lambda candidate:
                sum(_manhattan_distance(vectors[candidate], vectors[member])
                    for member in member_indices))
            new_medoids.append(best)

        if set(new_medoids) == set(medoid_indices):
            break
        medoid_indices = sorted(set(new_medoids))

    # Build PlanCluster results from final assignment
    result: list[PlanCluster] = []
    final_clusters: dict[int, list[int]] = {m: [] for m in medoid_indices}
    for i, vec in enumerate(vectors):
        best_m = min(medoid_indices, key=lambda m: _manhattan_distance(vec, vectors[m]))
        final_clusters[best_m].append(i)

    for m_idx, member_indices in final_clusters.items():
        if not member_indices:
            continue  # skip empty clusters (can happen when k > effective groups)
        members = [modifications[i] for i in member_indices]
        result.append(PlanCluster(
            centroid=modifications[m_idx],
            members=members,
            cluster_size=len(members),
        ))

    return result


def dispatch_explorer_prompt(cluster: PlanCluster) -> str:
    """Generate an explorer agent prompt for pre-flight cluster investigation.

    The explorer should search the target modules for:
    - Known bugs or recurring issue patterns
    - Deprecated APIs or anti-patterns
    - Middleware/package version conflicts
    - Platform-specific risks (Windows paths, symlinks, encoding)
    - Previous bug reports or workarounds in the same files
    """
    modules = sorted(set(m.target_module for m in cluster.members))
    files = sorted(set(m.target_file for m in cluster.members))
    risks = sorted(set(m.risk for m in cluster.members), key=lambda r: {"high": 0, "medium": 1, "low": 2}.get(r, 3))

    file_list = "\n".join(f"  - {f}" for f in files[:10])  # cap at 10
    desc_list = "\n".join(
        f"  - [{m.change_type}|{m.risk}] {m.description}"
        for m in cluster.members[:15]  # cap at 15
    )

    return f"""Pre-flight cluster investigation.

## Target modules
{', '.join(modules)}

## Risk levels present
{', '.join(risks)}

## Files to modify
{file_list}

## Planned changes
{desc_list}

## Investigation task
Before executing these modifications, investigate the target modules and files for:
1. **Known bugs** — search bug reports, issue trackers, code comments with "bug:", "FIXME", "HACK"
2. **Deprecated APIs** — are any APIs/patterns in these modules deprecated or superseded?
3. **Middleware conflicts** — do these modules interact with middleware/packages that have known issues?
4. **Platform risks** — Windows vs Unix paths, symlink handling, encoding, case sensitivity
5. **Recurring patterns** — have similar modifications failed before in these files?

Report findings and flag any modification that carries hidden risk.
"""


def cluster_and_explore(modifications: list[PlanModification]) -> list[tuple[PlanCluster, str]]:
    """Convenience: cluster modifications, return (cluster, explorer_prompt) pairs.
    Each pair is ready to dispatch to an explorer sub-agent.
    """
    clusters = k_medoids_modifications(modifications)
    return [(c, dispatch_explorer_prompt(c)) for c in clusters]


def select_fractal_model(peaks: int, delta_v: float = 0.0) -> str:
    """Choose fractal model by goal complexity.

    Heuristic (kernel spec ALGORITHM_CARD):
      peaks >= 3              → "Sierpinski"  (triangle/gasket — multi-peak complex)
      peaks in {2, 4, 8}      → "Quad-Oct"    (tree — hierarchical decomposition)
      else                    → "L-System"     (F→F+F-F grammar — generic fallback)

    peaks — count of distinct goal-surface peaks (keyword clusters).
    delta_v — semantic drift since last anchor (reserved, currently unused).
    """
    if peaks in (2, 4, 8):
        return "Quad-Oct"
    if peaks >= 3:
        return "Sierpinski"
    return "L-System"


def select_medoids_tasks(
    modifications: list[PlanModification],
    seeds: list[PlanModification] | None = None,
) -> list[str]:
    """Clause-level cut: cluster → return medoid descriptions only.

    k = ceil(N/2), Manhattan (L1) distance, seeds as initial centers.
    Foam dies — only medoid descriptions survive as CENTRAL_TASKS.
    """
    if not modifications:
        return []
    clusters = k_medoids_modifications(modifications)
    tasks: list[str] = []
    for c in clusters:
        tasks.append(c.centroid.description)
    return tasks


def adaptive_tau(
    distances: list[float],
    percentile: float = 0.70,
    fallback: float = 0.5,
    min_n: int = 20,
) -> float:
    """Percentile-based candidate filter threshold for GATE 2.

    When candidate count is low (< min_n), the fixed fallback τ = 0.5 is
    reliable. At 500+ candidates, the distance distribution can compress
    or stretch depending on embedding density. A fixed threshold would
    either over-filter (losing valid lattice nodes) or under-filter
    (letting distant noise through).

    Strategy: set τ to the `percentile`-th value of observed distances.
    This keeps the closest P% of candidates regardless of distribution
    shape.

    Example:
      N=50,  distances spread 0.05–1.2, percentile=0.70
      → τ ≈ 0.84  (70% of candidates are closer than 0.84)
      N=500, distances spread 0.01–0.3 (dense embeddings)
      → τ ≈ 0.21  (automatically tightens for dense space)
    """
    if not distances:
        return fallback
    n = len(distances)
    if n < min_n:
        return fallback
    sorted_d = sorted(distances)
    idx = int(n * percentile)
    # Clamp: never below 0.1 (avoid degenerate empty filter)
    #        never above 0.9 (ensure at least some filtering)
    return max(0.1, min(0.9, sorted_d[min(idx, n - 1)]))


def adaptive_k(
    distances_to_goal: list[float],
    min_k: int = 2,
    max_k: int | None = None,
    min_n: int = 4,
) -> int:
    """Choose k for k-medoids based on distance dispersion (CV).

    Fixed k = ceil(N/2) is safe but can over-fragment naturally tight
    clusters or under-segment widely spread candidates.

    Heuristic: coefficient of variation (CV = σ / μ) of candidate-to-goal
    distances. Tight cluster → low CV → fewer medoids. Wide spread →
    high CV → more medoids (up to ceil(N/2)).

    k = min_k + ⌊(max_k − min_k) · min(CV, 1.0)⌋

    Clamped to [min_k, max_k] and never exceeds N.
    """
    n = len(distances_to_goal)
    if n < min_n:
        return max(1, min(min_k, n))
    if max_k is None:
        max_k = max(min_k, (n + 1) // 2)  # ceil(N/2)
    max_k = min(max_k, n)
    if max_k <= min_k:
        return min_k

    mean = sum(distances_to_goal) / n
    if mean < 1e-6:
        return min_k  # all candidates at goal — single cluster
    variance = sum((d - mean) ** 2 for d in distances_to_goal) / n
    cv = math.sqrt(variance) / mean  # coefficient of variation ∈ [0, ∞)

    # Map CV → k linearly, saturating at CV ≥ 1.0
    k = min_k + int((max_k - min_k) * min(cv, 1.0))
    return max(min_k, min(k, max_k))


def adaptive_depth(
    peaks: int,
    evidence_count: int = 0,
) -> int:
    """Choose fractal generation depth by goal complexity.

    Fixed depth=2 produces ~30 Koch nodes — adequate for 3–5 step tasks
    but under-generates for complex decompositions and over-generates
    for trivial single-peak goals.

    Heuristic:
      peaks ≥ 4  or  evidence_count > 10  →  depth = 3  (complex)
      peaks ≥ 2                           →  depth = 2  (default)
      else                                →  depth = 1  (simple/single-peak)

    Depth 1 is a single rewrite step; depth 3 produces ~50–80 nodes for
    rich decomposition.
    """
    if peaks >= 4 or evidence_count > 10:
        return 3
    if peaks >= 2:
        return 2
    return 1


# =========================================================================
# CLARA: Clustering LARge Applications — sampling k-medoids for N ≥ 100
# =========================================================================

CLARA_THRESHOLD: int = 100
CLARA_REPETITIONS: int = 5


def clara_k_medoids_modifications(
    modifications: list[PlanModification],
    k: int | None = None,
    sample_size: int | None = None,
    repetitions: int = CLARA_REPETITIONS,
) -> list[PlanCluster]:
    """CLARA k-medoids for large candidate sets (N ≥ 100).

    Exact k-medoids is O(N²) per iteration — prohibitive above ~500
    candidates. CLARA (Kaufman & Rousseeuw, 1990) samples the dataset
    repeatedly, runs exact k-medoids on each sample, and keeps the best
    clustering (lowest total L1 cost over all N points).

    Sampling: 40 + 2k (typical CLARA heuristic), clamped to ≤ N.
    Repetitions: 5 (default); higher values improve quality at linear cost.

    When N < CLARA_THRESHOLD (100), falls back to exact k-medoids.

    Returns list of PlanCluster — same interface as k_medoids_modifications.
    """
    N = len(modifications)
    if N < CLARA_THRESHOLD:
        return k_medoids_modifications(modifications, k)

    if k is None:
        k = max(1, (N + 1) // 2)  # ceil(N/2)
    k = min(k, N)
    if sample_size is None:
        # CLARA heuristic: 40 + 2k, but never sample > 80% of data
        # (otherwise CLARA degenerates to exact k-medoids)
        sample_size = min(40 + 2 * k, max(k, int(N * 0.80)))
    sample_size = max(k, min(sample_size, N))  # must fit at least k points

    all_vectors = [embed_modification(m) for m in modifications]
    best_cost: float = float("inf")
    best_clusters: list[PlanCluster] = []

    for _ in range(repetitions):
        # 1. Draw random sample
        sample_indices = random.sample(range(N), sample_size)
        sample_mods = [modifications[i] for i in sample_indices]

        # 2. Exact k-medoids on sample (force exact — sample is small by design)
        sample_clusters = k_medoids_modifications(sample_mods, k, use_clara=False)
        sample_medoid_vecs = [embed_modification(c.centroid) for c in sample_clusters]
        k_eff = len(sample_medoid_vecs)
        if k_eff == 0:
            continue

        # 3. Assign ALL N points to nearest sample medoid
        clusters: list[list[int]] = [[] for _ in range(k_eff)]
        for i, vec in enumerate(all_vectors):
            best_j = min(range(k_eff), key=lambda j: _manhattan_distance(vec, sample_medoid_vecs[j]))
            clusters[best_j].append(i)

        # 4. Compute total L1 cost (sum of point-to-medoid distances)
        total_cost = 0.0
        for j, member_indices in enumerate(clusters):
            medoid_vec = sample_medoid_vecs[j]
            for idx in member_indices:
                total_cost += _manhattan_distance(all_vectors[idx], medoid_vec)

        # 5. Keep best
        if total_cost < best_cost:
            best_cost = total_cost
            best_clusters = []
            for j, member_indices in enumerate(clusters):
                if not member_indices:
                    continue
                # Recompute true medoid within final cluster (real point)
                true_medoid_idx = min(member_indices, key=lambda candidate:
                    sum(_manhattan_distance(all_vectors[candidate], all_vectors[m])
                        for m in member_indices))
                members = [modifications[i] for i in member_indices]
                best_clusters.append(PlanCluster(
                    centroid=modifications[true_medoid_idx],
                    members=members,
                    cluster_size=len(members),
                ))

    return best_clusters if best_clusters else k_medoids_modifications(modifications, k, use_clara=False)


# =========================================================================
# L-System fractal grammar engine (F→F+F-F default)
# =========================================================================

DEFAULT_LSYSTEM_AXIOM: str = "F"
DEFAULT_LSYSTEM_RULES: dict[str, str] = {"F": "F+F-F"}


def lsystem_rewrite(
    axiom: str = DEFAULT_LSYSTEM_AXIOM,
    rules: dict[str, str] | None = None,
    depth: int = 2,
) -> list[str]:
    """Rewrite axiom via production rules for `depth` levels.

    L-System semantics:
      F   — move forward (draw / generate a task unit)
      +   — rotate +60° (branch into a new sub-task direction)
      -   — rotate −60° (branch into a complementary sub-task direction)

    Default rule F → F+F-F produces a Koch-like fractal. At depth 2
    the string encodes ~30 task units — enough to seed k-medoids
    without over-generating beyond meaningful work.

    Returns one string per level (0..depth), where level 0 = axiom.

    Example:
      lsystem_rewrite("F", {"F": "F+F-F"}, depth=2)
      → ["F", "F+F-F", "F+F-F+F+F-F-F+F-F"]
    """
    if rules is None:
        rules = DEFAULT_LSYSTEM_RULES
    result: list[str] = [axiom]
    current = axiom
    for _ in range(depth):
        next_chars: list[str] = []
        for ch in current:
            next_chars.append(rules.get(ch, ch))
        current = "".join(next_chars)
        result.append(current)
    return result


