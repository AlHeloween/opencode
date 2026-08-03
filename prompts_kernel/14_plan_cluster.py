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


def _median(values: list[float]) -> float:
    """Compute median of a numeric list. Returns 0.0 for empty input."""
    if not values:
        return 0.0
    sorted_v = sorted(values)
    n = len(sorted_v)
    if n % 2 == 1:
        return sorted_v[n // 2]
    return (sorted_v[n // 2 - 1] + sorted_v[n // 2]) / 2.0


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
    evidence_coverage: float = 0.5,
) -> int:
    """Choose fractal generation depth by goal complexity and evidence coverage.

    v6 GROUNDED PATH semantics (resolves contradiction with Reasoning Protocol):
      - peaks (goal complexity): more peaks → deeper decomposition.
      - evidence_coverage ∈ [0.0, 1.0]: fraction of territory already mapped
        via codegraph indexing + historical conversation context.
        High coverage → shallower lattice (ground already solid).
        Low coverage → deeper lattice (more exploration needed).

    Algorithm:
      1. base_depth from peaks:
           peaks ≥ 4  →  3  (complex — many separable aspects)
           peaks ≥ 2  →  2  (default)
           else       →  1  (single-peak / simple)
      2. Adjust by evidence_coverage:
           coverage ≥ 0.8  →  depth = max(1, base_depth - 1)  (well-mapped)
           coverage ≤ 0.3  →  depth = min(3, base_depth + 1)  (unexplored)
           else             →  depth = base_depth               (neutral)

    Depth 1 is a single rewrite step; depth 3 produces ~50–80 nodes for
    rich decomposition. The evidence_coverage adjustment means:
      - A 4-peak refactor in a fully-indexed codebase → depth 2, not 3.
      - A 1-peak typo in unknown code → depth 2, not 1.
    Both follow the full spine; only lattice depth adapts to evidence density.
    """
    # Base depth from goal complexity
    if peaks >= 4:
        base = 3
    elif peaks >= 2:
        base = 2
    else:
        base = 1

    # Adjust by evidence coverage (v6 GROUNDED PATH)
    if evidence_coverage >= 0.8:
        depth = max(1, base - 1)   # well-mapped → shallower
    elif evidence_coverage <= 0.3:
        depth = min(3, base + 1)   # unexplored → deeper
    else:
        depth = base                # neutral

    return depth


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


# =========================================================================
# Fractal candidate generators: Sierpinski, Quad/Oct-tree, L-System
# =========================================================================


def _select_central_seeds(
    seed_vectors: list[list[float]],
    k: int,
) -> list[list[float]]:
    """Select k seeds closest to the centroid of all seed vectors.

    Used by Sierpinski (k=3) and Quad/Oct (k=2/4/8) to pick representative
    seeds when the input count exceeds the model's expected count.
    """
    n = len(seed_vectors)
    if n <= k:
        # Pad with distinct micro-offset vectors if not enough seeds.
        # Identical zero vectors collapse in the Sierpinski point set.
        dim = len(seed_vectors[0]) if seed_vectors else 512
        result = list(seed_vectors)
        while len(result) < k:
            offset_idx = len(result)
            pad = [0.0] * dim
            # Each pad gets a tiny unique signature so they are distinct
            pad[offset_idx % dim] = 1e-6 * (offset_idx + 1)
            result.append(pad)
        return result

    dim = len(seed_vectors[0])
    # Centroid
    centroid = [0.0] * dim
    for v in seed_vectors:
        for i in range(dim):
            centroid[i] += v[i]
    for i in range(dim):
        centroid[i] /= n

    # Distance from each seed to centroid
    indexed = [(i, _manhattan_distance(v, centroid)) for i, v in enumerate(seed_vectors)]
    indexed.sort(key=lambda x: x[1])
    return [seed_vectors[i] for i, _ in indexed[:k]]


def generate_sierpinski(
    seed_vectors: list[list[float]],
    depth: int,
    dim: int = 512,
) -> list[list[float]]:
    """Generate candidate vectors via Sierpinski gasket subdivision.

    Selects 3 central seeds as triangle vertices. Recursively subdivides
    edges by computing midpoints up to `depth` levels. Each midpoint
    becomes a new candidate.

    At depth 0: 3 vertices.
    At depth d: 3 * (3^d + 1) / 2 unique points (approximately).

    The resulting point cloud is densest near the triangle centre —
    matching the Sierpinski property of self-similar void regions.
    """
    seeds = _select_central_seeds(seed_vectors, 3)
    a, b, c = seeds[0], seeds[1], seeds[2]

    # Use set of tuples for deduplication
    points: set[tuple[float, ...]] = {tuple(a), tuple(b), tuple(c)}
    frontier: list[tuple[list[float], list[float]]] = [(a, b), (b, c), (c, a)]

    for _ in range(depth):
        new_frontier: list[tuple[list[float], list[float]]] = []
        for p1, p2 in frontier:
            mid = [(x + y) / 2.0 for x, y in zip(p1, p2)]
            mid_t = tuple(mid)
            if mid_t not in points:
                points.add(mid_t)
                new_frontier.append((p1, mid))
                new_frontier.append((mid, p2))
        frontier = new_frontier
        if not frontier:
            break

    return [list(p) for p in points]


def generate_quad_oct(
    seed_vectors: list[list[float]],
    depth: int,
    dim: int = 512,
) -> list[list[float]]:
    """Generate candidate vectors via Quad/Oct-tree recursive grid subdivision.

    For 2 seeds: binary subdivision along the line (1D).
    For 4 seeds: quad subdivision (2D grid, 2x2 per level).
    For 8 seeds: oct subdivision (3D grid, 2x2x2 per level).

    Seeds define the bounding vertices; candidates are grid points at
    subdivision level `depth`. Total candidates: (2^depth + 1)^b where
    b = branching factor (1/2/3 for 2/4/8 seeds).

    Seeds beyond the model's expected count are selected by centrality.
    """
    n_seeds = len(seed_vectors)

    # Determine branching dimension
    if n_seeds >= 8:
        b = 3  # oct — 3D grid
        seeds = _select_central_seeds(seed_vectors, 8)
    elif n_seeds >= 4:
        b = 2  # quad — 2D grid
        seeds = _select_central_seeds(seed_vectors, 4)
    else:
        b = 1  # binary — 1D
        seeds = _select_central_seeds(seed_vectors, 2)

    # Build axis vectors from seed pairs
    # For b=1: axis_0 = seeds[1] - seeds[0] (the line)
    # For b=2: axis_0 = seeds[1]-seeds[0], axis_1 = seeds[3]-seeds[2]
    # For b=3: add axis_2 = seeds[7]-seeds[6] etc.
    origin = seeds[0]
    axes: list[list[float]] = []
    for i in range(b):
        axis = [seeds[2 * i + 1][j] - seeds[2 * i][j] for j in range(dim)]
        axes.append(axis)

    # Generate grid points: for each dimension, sample 2^depth + 1 points
    n_per_dim = (1 << depth) + 1  # 2^depth + 1
    candidates: list[list[float]] = []

    # Recursive/iterative grid generation
    # Use integer coordinates to walk the grid
    if b == 1:
        for i0 in range(n_per_dim):
            t0 = i0 / (n_per_dim - 1) if n_per_dim > 1 else 0.0
            pt = [origin[j] + t0 * axes[0][j] for j in range(dim)]
            candidates.append(pt)
    elif b == 2:
        for i0 in range(n_per_dim):
            t0 = i0 / (n_per_dim - 1) if n_per_dim > 1 else 0.0
            for i1 in range(n_per_dim):
                t1 = i1 / (n_per_dim - 1) if n_per_dim > 1 else 0.0
                pt = [origin[j] + t0 * axes[0][j] + t1 * axes[1][j] for j in range(dim)]
                candidates.append(pt)
    else:  # b == 3
        for i0 in range(n_per_dim):
            t0 = i0 / (n_per_dim - 1) if n_per_dim > 1 else 0.0
            for i1 in range(n_per_dim):
                t1 = i1 / (n_per_dim - 1) if n_per_dim > 1 else 0.0
                for i2 in range(n_per_dim):
                    t2 = i2 / (n_per_dim - 1) if n_per_dim > 1 else 0.0
                    pt = [origin[j] + t0 * axes[0][j] + t1 * axes[1][j] + t2 * axes[2][j]
                          for j in range(dim)]
                    candidates.append(pt)

    return candidates


def generate_lsystem_candidates(
    seed_vectors: list[list[float]],
    depth: int,
    dim: int = 512,
) -> list[list[float]]:
    """Generate candidate vectors from L-System grammar walk.

    Uses the F→F+F-F grammar to walk through the embedding space.
    Each 'F' in the final string emits a candidate vector.

    The walk starts at the seed centroid. '+' rotates the step direction
    by +60° in a 2D subspace; '-' rotates by −60°.

    Candidates are unique by position; depth 2 produces ~30 candidates.
    """
    if not seed_vectors:
        return []

    # Compute seed centroid as starting point
    centroid = [0.0] * dim
    for v in seed_vectors:
        for i in range(dim):
            centroid[i] += v[i]
    n = len(seed_vectors)
    for i in range(dim):
        centroid[i] /= n

    # Define two perpendicular direction vectors in the embedding space
    # Use the first two PCA-like directions from seed spread
    if n >= 2:
        dir_fwd = [seed_vectors[1][i] - seed_vectors[0][i] for i in range(dim)]
    else:
        # Single seed — use a hash-based direction
        dir_fwd = [0.0] * dim
        for i in range(dim):
            dir_fwd[i] = (hash(f"fwd_{i}") % 1000) / 5000.0  # small random-ish

    # Normalize dir_fwd to unit length
    norm_fwd = math.sqrt(sum(x * x for x in dir_fwd))
    if norm_fwd < 1e-8:
        norm_fwd = 1.0
    dir_fwd = [x / norm_fwd for x in dir_fwd]

    # Create a perpendicular direction using a random-ish vector
    # Take a hash-based vector and subtract its projection onto dir_fwd
    perp = [0.0] * dim
    for i in range(dim):
        perp[i] = (hash(f"perp_{i}") % 1000) / 5000.0
    # Gram-Schmidt: perp = perp - (perp·fwd) * fwd
    dot = sum(perp[i] * dir_fwd[i] for i in range(dim))
    for i in range(dim):
        perp[i] -= dot * dir_fwd[i]
    norm_perp = math.sqrt(sum(x * x for x in perp))
    if norm_perp < 1e-8:
        norm_perp = 1.0
    perp = [x / norm_perp for x in perp]

    # Step size: fraction of seed spread
    step_size = 0.15 / (depth + 1)

    # Generate L-System string
    levels = lsystem_rewrite("F", DEFAULT_LSYSTEM_RULES, depth)
    final_string = levels[-1]

    # Walk the string
    candidates: list[list[float]] = []
    pos = list(centroid)
    angle = 0.0  # radians, 0 = forward direction
    seen: set[tuple[float, ...]] = set()

    for ch in final_string:
        if ch == "F":
            pt = tuple(round(x, 10) for x in pos)  # round to avoid float drift
            if pt not in seen:
                seen.add(pt)
                candidates.append(list(pos))
            # Step forward
            cos_a = math.cos(angle)
            sin_a = math.sin(angle)
            for i in range(dim):
                pos[i] += step_size * (cos_a * dir_fwd[i] + sin_a * perp[i])
        elif ch == "+":
            angle += math.pi / 3  # +60°
        elif ch == "-":
            angle -= math.pi / 3  # -60°
        # Other characters: no-op

    return candidates


def generate_fractal_candidates(
    model: str,
    seed_vectors: list[list[float]],
    depth: int = 2,
    dim: int = 512,
) -> list[list[float]]:
    """Dispatch fractal candidate generation by model name.

    Models:
      "Sierpinski"   → recursive triangle subdivision (3 seeds)
      "Quad-Oct"     → grid subdivision (2/4/8 seeds)
      "L-System"     → grammar walk (F→F+F-F, any seed count)
      (unknown)      → falls back to L-System

    Returns list of candidate vectors in the embedding space.
    """
    if not seed_vectors:
        return []

    if model == "Sierpinski":
        return generate_sierpinski(seed_vectors, depth, dim)
    elif model == "Quad-Oct":
        return generate_quad_oct(seed_vectors, depth, dim)
    else:
        return generate_lsystem_candidates(seed_vectors, depth, dim)


# =========================================================================
# Goal seeds: extract meaning-true goal slices from goal text + evidence
# =========================================================================


def _tokenize_text(text: str) -> list[str]:
    """Extract meaningful tokens from a text string.

    Splits on non-alphanumeric boundary, filters stopwords and short tokens.
    Returns lowercase tokens in original order.
    """
    stopwords = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "has", "have", "had", "do", "does", "did", "will", "would",
        "can", "could", "may", "might", "shall", "should", "must",
        "of", "in", "on", "at", "to", "for", "with", "from", "by",
        "about", "as", "into", "through", "during", "before", "after",
        "and", "or", "not", "but", "if", "then", "else", "when",
        "this", "that", "these", "those", "it", "its", "we", "you",
        "i", "me", "my", "our", "your", "he", "she", "they", "them",
    }
    tokens: list[str] = []
    # Split on non-alpha chars, keep alpha sequences >= 2 chars
    current: list[str] = []
    for ch in text.lower():
        if ch.isalpha():
            current.append(ch)
        else:
            if current:
                word = "".join(current)
                if len(word) >= 2 and word not in stopwords:
                    tokens.append(word)
                current = []
    if current:
        word = "".join(current)
        if len(word) >= 2 and word not in stopwords:
            tokens.append(word)
    return tokens


def goal_seeds(
    goal_text: str,
    evidence_texts: list[str] | None = None,
    dim: int = 512,
) -> list[list[float]]:
    """Extract meaning-true goal slices as seed vectors.

    Each seed represents a distinct aspect/cluster of the goal.

    Algorithm:
    1. Tokenize goal and evidence into keyword lists.
    2. Cluster keywords by co-occurrence proximity in the source text.
    3. Embed each cluster via _hash_embed → seed vector.
    4. Return up to 8 seeds (fewer if goal is simple).

    If goal is trivially short (< 4 tokens), returns a single seed.
    """
    if evidence_texts is None:
        evidence_texts = []

    # 1. Tokenize
    goal_tokens = _tokenize_text(goal_text)
    all_tokens = list(goal_tokens)
    for ev_text in evidence_texts:
        all_tokens.extend(_tokenize_text(ev_text))

    if not goal_tokens:
        # Empty goal — single zero-ish seed
        seed = [0.0] * dim
        seed[0] = 1.0  # arbitrary
        return [seed]

    # 2. Cluster tokens into groups
    # Simple approach: sliding window of co-occurrence
    # Tokens within window_size of each other in the goal text are grouped
    window_size = max(3, len(goal_tokens) // 3)
    clusters: list[list[str]] = []
    seen: set[int] = set()

    for i, token in enumerate(goal_tokens):
        if i in seen:
            continue
        # Gather tokens in window around i
        cluster: list[str] = []
        for j in range(max(0, i - window_size), min(len(goal_tokens), i + window_size + 1)):
            if j not in seen:
                cluster.append(goal_tokens[j])
                seen.add(j)
        if cluster:
            clusters.append(cluster)

    # Also add evidence-only tokens as additional clusters (low weight)
    ev_only = [t for t in all_tokens if t not in goal_tokens]
    if ev_only and len(clusters) < 8:
        # Group evidence tokens into one extra cluster
        clusters.append(ev_only[:10])  # cap at 10

    # 3. Embed each cluster
    seeds: list[list[float]] = []
    for cluster in clusters:
        if not cluster:
            continue
        seed = _hash_embed(cluster, dim)
        seeds.append(seed)

    # Cap at 8 seeds
    if len(seeds) > 8:
        seeds = seeds[:8]

    return seeds if seeds else [_hash_embed(goal_tokens, dim)]


# =========================================================================
# ADID loop closure: emit_state + residual_recluster
# =========================================================================


def emit_state(
    goal_sv: list[float] | None = None,
    completed_tasks: list[str] | None = None,
    pending_tasks: list[str] | None = None,
    blockers: list[str] | None = None,
    next_step: str | None = None,
    smoke_baseline: dict[str, dict] | None = None,
    out_of_scope: list[str] | None = None,
    terminal: bool = False,
) -> dict:
    """Emit a structured state record at the end of an ADID cycle.

    Returns a dict with keys: done, pending, blocked, next, goal_sv,
    smoke_baseline, out_of_scope, terminal. The caller is responsible for
    serialisation and InfoMark stamping.

    smoke_baseline: {label: {exit_code, stdout_hash, stderr_hash, timestamp}, ...}
      — recorded by smoke_before_record() before the first edit.

    v6 additions:
      out_of_scope: tasks discarded by residual_recluster (didn't pass Goal-SV threshold).
        Preserved for audit — not silently dropped.
      terminal: True when pending is empty and no further work remains.
        The agent transitions to TERMINAL and stops the ADID cycle.
    """
    result: dict = {
        "done": completed_tasks or [],
        "pending": pending_tasks or [],
        "blocked": blockers or [],
        "next": next_step or "",
        "goal_sv": goal_sv,
    }
    if smoke_baseline is not None:
        result["smoke_baseline"] = smoke_baseline
    if out_of_scope:
        result["out_of_scope"] = out_of_scope
    if terminal:
        result["terminal"] = True
    return result


def residual_recluster(
    state: dict,
    original_goal_sv: list[float] | None = None,
    dim: int = 512,
) -> list[str]:
    """Re-cluster residual work against the original Goal SV.

    After executing some medoids, the remaining pending tasks may need
    re-clustering to stay aligned with the original goal (not drift into
    unrelated territory).

    Algorithm:
    1. If no pending tasks, return empty.
    2. Embed pending task descriptions as vectors.
    3. Compute Manhattan distance from each pending task to the original goal.
    4. Group close tasks (distance < threshold) as the next increment.
    5. Return re-clustered task descriptions.

    v6: Tasks that don't pass the Goal-SV threshold are moved to
    state['out_of_scope'] (not silently dropped, not forced to survive).
    If no task passes → return [] → caller sets terminal=True.

    This closes the ADID loop: State → Decompose → Execute → Verify →
    Residual → State (with updated plan) or TERMINAL.
    """
    pending = state.get("pending", [])
    if not pending:
        return []

    # If no goal SV provided, return pending as-is (single cluster)
    if original_goal_sv is None:
        return pending

    # Embed each pending task
    task_vectors = [_hash_embed(_tokenize_text(t), dim) for t in pending]

    # Compute distances to goal
    distances = [_manhattan_distance(v, original_goal_sv) for v in task_vectors]

    # Small pending set: return all (can't meaningfully filter)
    if len(distances) < 3:
        return pending

    # Percentile-based cutoff (like adaptive_tau): keep closest 70%
    # This naturally adapts: tight cluster keeps more, spread keeps fewer
    tau = adaptive_tau(distances, percentile=0.70, fallback=0.5, min_n=3)

    # Return tasks ordered by proximity to goal, filtered by tau
    indexed = [(i, distances[i]) for i in range(len(pending))]
    indexed.sort(key=lambda x: x[1])

    in_scope = [(i, d) for i, d in indexed if d <= tau]
    out_of_scope = [pending[i] for i, d in indexed if d > tau]

    # v6: track discarded tasks in state for audit
    if out_of_scope:
        existing_oos = state.get("out_of_scope", [])
        state["out_of_scope"] = existing_oos + out_of_scope

    result = [pending[i] for i, d in in_scope]
    # v6: allow empty residual → TERMINAL state.
    # If no pending task passes the Goal-SV threshold, the cycle ends.
    # The agent signals TERMINAL and places discarded tasks in out_of_scope.
    # v5 behaviour (forced at least one) created perpetual motion:
    #   all residual tasks irrelevant → kernel keeps one → agent can't reach TERMINAL.
    return result  # may be empty — caller handles TERMINAL via emit_state


# =========================================================================
# Pipeline glue: ground, goal_peaks, sv_delta
# =========================================================================


def ground(goal: str) -> dict:
    """Generate an evidence-gathering plan from a goal.

    Does NOT execute tools — returns structured search instructions
    that the agent follows at Gate 1 (GROUND TRUTH / SEARCH_ORDER).

    Returns a dict with:
      - goal_keywords: extracted keyword tokens
      - searches: list of (source, query) tuples for universalsearch
      - local_probes: list of (tool, target) tuples for codegraph/filesystem
      - expected_evidence: categories of evidence to collect
    """
    tokens = _tokenize_text(goal)

    # Build targeted search queries from top keywords
    # Use keyword frequency to prioritise
    freq: dict[str, int] = {}
    for t in tokens:
        freq[t] = freq.get(t, 0) + 1
    ranked = sorted(freq.items(), key=lambda x: -x[1])
    top_keywords = [kw for kw, _ in ranked[:6]]

    # Searches: prefer web + code for prior art (REUSE_BEFORE)
    searches: list[tuple[str, str]] = []
    if top_keywords:
        q = " ".join(top_keywords[:4])
        searches.append(("web", q))
        searches.append(("code", q))

    # Local probes: what to look for in the codebase
    local_probes: list[tuple[str, str]] = []
    for kw in top_keywords[:3]:
        local_probes.append(("codegraph", kw))
        local_probes.append(("grep", kw))

    return {
        "goal_keywords": top_keywords,
        "searches": searches,
        "local_probes": local_probes,
        "expected_evidence": [
            "prior_art_external",      # web/code search results
            "local_structure",          # codegraph symbols + callers
            "local_occurrences",        # grep hits
            "conversation_history",     # messagesearch for prior decisions
        ],
    }


def goal_peaks(
    goal_text: str,
    evidence_texts: list[str] | None = None,
) -> int:
    """Count distinct keyword clusters (peaks) in a goal.

    Each peak represents a separable aspect of the goal — used by
    select_fractal_model to choose the right lattice geometry:
      - 1 peak   → L-System (linear grammar)
      - 2 peaks  → Quad-Oct binary subdivision
      - 3 peaks  → Sierpinski triangle
      - 4 peaks  → Quad-Oct quad subdivision
      - 5-7 peaks → Sierpinski (relaxed)
      - 8 peaks  → Quad-Oct oct subdivision
      - 9+ peaks → Sierpinski (clamped to 3 most central)

    Algorithm: reuse goal_seeds clustering — each seed cluster = one peak.
    """
    if evidence_texts is None:
        evidence_texts = []

    # Use the same clustering as goal_seeds to determine peak count
    goal_tokens = _tokenize_text(goal_text)

    if not goal_tokens:
        return 1

    # Re-run the clustering logic from goal_seeds to count clusters
    window_size = max(3, len(goal_tokens) // 3)
    seen: set[int] = set()
    cluster_count = 0

    for i in range(len(goal_tokens)):
        if i in seen:
            continue
        # Mark window as one cluster
        cluster_count += 1
        for j in range(max(0, i - window_size), min(len(goal_tokens), i + window_size + 1)):
            seen.add(j)

    # Each evidence text that introduces new tokens adds 1 potential peak
    ev_tokens = set()
    for ev_text in evidence_texts:
        ev_tokens.update(_tokenize_text(ev_text))
    new_ev = ev_tokens - set(goal_tokens)
    if new_ev and cluster_count < 8:
        cluster_count += 1

    # Clamp: at least 1, at most 9
    return max(1, min(cluster_count, 9))


def sv_delta(
    current_sv: dict[str, float] | None = None,
    previous_sv: dict[str, float] | None = None,
) -> float:
    """Compute the L1 semantic distance between two SV states.

    Each SV state is a dict mapping keyword → weight (sum ~= 1.0).
    Returns a float in [0.0, 2.0]:
      0.0 = identical
      1.0 = completely disjoint vocabularies
      2.0 = opposite (inverted weights)

    Used by select_fractal_model as the delta_v parameter:
      - delta_v < 0.3 → L-System (stable, linear refinement)
      - delta_v ≥ 0.3 → Quad-Oct (moderate shift, grid re-exploration)
      - delta_v ≥ 0.6 → Sierpinski (large shift, triangular re-decomposition)

    If either SV is None, returns 0.5 (neutral).
    """
    if current_sv is None or previous_sv is None:
        return 0.5  # neutral — not enough info

    if not current_sv and not previous_sv:
        return 0.0

    # Gather all keys
    all_keys = set(current_sv) | set(previous_sv)
    if not all_keys:
        return 0.0

    # L1 distance: sum |w_c(k) - w_p(k)| over all keywords
    total = 0.0
    for k in all_keys:
        w_c = current_sv.get(k, 0.0)
        w_p = previous_sv.get(k, 0.0)
        total += abs(w_c - w_p)

    return total


# =========================================================================
# run_task_geometry — full ADID pipeline, callable as one function
# =========================================================================


def run_task_geometry(
    goal: str,
    evidence_texts: list[str] | None = None,
    dim: int = 512,
) -> dict:
    """Execute the full fractal task geometry pipeline.

    Chains: ground → goal_seeds → goal_peaks → select_fractal_model →
    generate_fractal_candidates → L1 filter → emit_state → residual_recluster.

    Returns a structured dict with pipeline diagnostics — every stage is
    inspectable for integration testing. The agent uses this output to
    populate todowrite with CENTRAL_TASKS.

    NOTE: select_medoids_tasks requires PlanModification objects (not raw
    vectors). This function returns candidate vectors + recommended k;
    the agent converts vectors to task descriptions before clustering.
    """
    if evidence_texts is None:
        evidence_texts = []

    # 1. ground — evidence plan (informational; agent executes the plan)
    evidence_plan = ground(goal)

    # 2. seeds — meaning-true goal slices
    seeds = goal_seeds(goal, evidence_texts, dim=dim)

    # 3. fractal configuration
    peaks = goal_peaks(goal, evidence_texts)
    delta_v = sv_delta()  # neutral 0.5 if no previous SV
    model = select_fractal_model(peaks=peaks, delta_v=delta_v)
    depth = adaptive_depth(peaks=peaks, evidence_count=len(evidence_texts),
                           evidence_coverage=0.5)  # neutral default; agent overrides from codegraph health

    # 4. fractal over-generate
    candidates = generate_fractal_candidates(model, seeds, depth=depth, dim=dim)

    # 5. L1 filter — embed goal as vector, compute distances
    goal_tokens = _tokenize_text(goal)
    goal_vec = _hash_embed(goal_tokens, dim) if goal_tokens else [0.0] * dim

    if candidates:
        distances = [_manhattan_distance(c, goal_vec) for c in candidates]
        tau = adaptive_tau(distances, percentile=0.70)
        filtered = [c for c, d in zip(candidates, distances) if d <= tau]
        filtered_distances = [d for d in distances if d <= tau]
        # Safety: never return zero tasks — keep at least the closest candidate
        if not filtered:
            best_idx = min(range(len(distances)), key=lambda i: distances[i])
            filtered = [candidates[best_idx]]
            filtered_distances = [distances[best_idx]]
            tau = distances[best_idx] + 0.001  # expand τ to include it
        k = adaptive_k(filtered_distances if filtered_distances else distances, min_k=2)
    else:
        distances = []
        tau = 0.5
        filtered = []
        k = 2

    # 6. emit state
    state = emit_state(
        goal_sv=goal_vec,
        completed_tasks=[],
        pending_tasks=[f"candidate_{i}" for i in range(len(filtered))],
        blockers=[],
        next_step="cluster filtered candidates via select_medoids_tasks",
    )

    # 7. residual re-cluster
    residual = residual_recluster(state, original_goal_sv=goal_vec)

    return {
        "goal": goal,
        "seeds_n": len(seeds),
        "peaks": peaks,
        "model": model,
        "depth": depth,
        "candidates_n": len(candidates),
        "filtered_n": len(filtered),
        "tau": round(tau, 4),
        "k_recommended": k,
        "distances_min": round(min(distances), 4) if distances else None,
        "distances_median": round(_median(distances), 4) if distances else None,
        "distances_max": round(max(distances), 4) if distances else None,
        "residual_n": len(residual),
        "evidence_plan_searches": len(evidence_plan.get("searches", [])),
        "status": "ok" if filtered else "no_candidates_passed_filter",
    }


# =========================================================================
# Agent-side stubs — execute_medoid + verify_oracles
# =========================================================================
# These are documented contracts, not kernel implementations.
# The agent drives execution (REUSE_BEFORE, SMOKE_BEFORE, tool calls);
# the kernel provides the interface specification so every symbol in
# algorithm_card resolves to a callable.


def execute_medoid(task: str) -> tuple[str, str]:
    """Execute one medoid task (agent-side, kernel contract only).

    The agent MUST:
    1. Run REUSE_BEFORE (search prior art before inventing)
    2. Run SMOKE_BEFORE (baseline oracles before first edit)
    3. Execute the task using product tools (edit, write, bash, …)
    4. Return status + detail

    Returns:
        ('done', output)    — task completed, oracle-verified
        ('blocked', reason) — blocked by external dependency
        ('pending', detail) — not yet executed or oracle-failed

    This stub returns ('pending', 'agent must drive execution') — the
    kernel does not execute tasks; the agent interprets the contract.
    """
    return ("pending", "agent must drive execution — kernel provides contract only")


def verify_oracles(
    completed: list[str],
    pending: list[str],
    blockers: list[dict],
) -> None:
    """Verify executed tasks via post-impl oracles (agent-side, kernel contract).

    The agent MUST:
    1. Re-run SMOKE_BEFORE oracles for each completed task
    2. Compare post-impl output against baseline [Exact]
    3. Re-classify: PASS→stays in completed, FAIL→moves to pending
    4. Update blockers with newly discovered dependencies

    Mutates `completed`, `pending`, `blockers` in-place.
    Gate 8: only oracle PASS (not self-certify) promotes to Done.

    This stub is a no-op — the agent interprets the contract.
    """
    # No-op stub: kernel defines the contract; agent executes it.
    return


# =========================================================================
# SMOKE_BEFORE — industrial contract: baseline → edit → verify
# =========================================================================
# Kernel provides: spec generation, contract validation, baseline recording,
# post-impl verification. Agent executes the actual commands (shell access).
#
# Data contract (SmokeSpec):
#   {
#     "smoke_na": bool,
#     "smoke_na_reason": str | None,
#     "baseline": [{"label", "cmd", "expected_exit", "tolerance", "scope"}, ...],
#     "post_checks": [...],
#     "blast_radius": [str, ...],
#   }


def smoke_before_spec(task: str) -> dict:
    """Generate a SMOKE_BEFORE specification template from a task description.

    The returned spec has empty baseline/post_checks — the agent MUST fill
    in concrete, runnable commands before Gate 4 approval.

    Blast radius is inferred from task keywords (e.g. 'database' → db tests,
    'frontend' → UI tests, 'api' → integration tests).

    Returns a SmokeSpec dict with:
      - smoke_na: False (agent sets True if smoke not applicable)
      - smoke_na_reason: None
      - baseline: [] (agent fills with runnable commands)
      - post_checks: [] (agent fills with post-impl verification commands)
      - blast_radius: inferred scope hints from task keywords
    """
    # Infer blast radius from task keywords
    task_lower = task.lower()
    blast_hints: list[str] = []

    scope_keywords = {
        "database": "db/",
        "sql": "db/",
        "migration": "db/",
        "frontend": "ui/",
        "ui": "ui/",
        "component": "ui/",
        "react": "ui/",
        "css": "ui/",
        "style": "ui/",
        "api": "api/",
        "endpoint": "api/",
        "route": "api/",
        "server": "api/",
        "test": "tests/",
        "typecheck": "typecheck",
        "lint": "lint",
        "build": "build",
        "config": "config/",
        "auth": "auth/",
        "login": "auth/",
        "security": "auth/",
        "kernel": "kernel/",
        "pipeline": "kernel/",
        "prompt": "prompt/",
        "reasoning": "prompt/",
    }
    for keyword, hint in scope_keywords.items():
        if keyword in task_lower:
            blast_hints.append(hint)

    if not blast_hints:
        blast_hints = ["project/"]  # whole-project scope when unclear

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_hints: list[str] = []
    for h in blast_hints:
        if h not in seen:
            seen.add(h)
            unique_hints.append(h)

    return {
        "smoke_na": False,
        "smoke_na_reason": None,
        "baseline": [],
        "post_checks": [],
        "blast_radius": unique_hints,
    }


def smoke_before_validate(spec: dict) -> tuple[bool, str]:
    """Validate a SMOKE_BEFORE specification against the contract.

    Enforcement (Gate 4 — plan approval):
      1. smoke_na=True requires smoke_na_reason (not None, not empty)
      2. smoke_na=False requires at least one baseline check
      3. Every baseline check must have: label, cmd, expected_exit
      4. Tolerance > 0 requires a note in the check dict
      5. "Vague 'test later'" → empty baseline with smoke_na=False → REJECT

    Returns (is_valid, diagnostic_message).
    """
    smoke_na = spec.get("smoke_na", False)
    smoke_na_reason = spec.get("smoke_na_reason")
    baseline = spec.get("baseline", [])

    # Rule 1: smoke_na requires justification
    if smoke_na:
        if not smoke_na_reason or not str(smoke_na_reason).strip():
            return (False, "smoke_na=True requires smoke_na_reason (justification)")
        return (True, "smoke N/A with justification — accepted")

    # Rule 2: smoke_na=False requires at least one baseline check
    if not baseline:
        return (False, "vague 'test later' is forbidden — baseline must have ≥1 runnable check, or set smoke_na=True with justification")

    # Rule 3: every baseline check must have: label, cmd, expected_exit
    for i, check in enumerate(baseline):
        label = check.get("label", "").strip()
        cmd = check.get("cmd", "").strip()
        expected_exit = check.get("expected_exit")

        if not label:
            return (False, f"baseline[{i}]: missing 'label'")
        if not cmd:
            return (False, f"baseline[{i}] ('{label}'): missing 'cmd' — command must be runnable")
        if expected_exit is None:
            return (False, f"baseline[{i}] ('{label}'): missing 'expected_exit' — required for deterministic verification")

        # Rule 4: tolerance > 0 with no justification
        tolerance = check.get("tolerance", 0.0)
        if tolerance > 0.0 and not check.get("tolerance_reason", "").strip():
            return (False, f"baseline[{i}] ('{label}'): tolerance={tolerance}>0 requires 'tolerance_reason' (why fuzzy matching is needed)")

    # Post-checks: same validation if present
    post_checks = spec.get("post_checks", [])
    for i, check in enumerate(post_checks):
        label = check.get("label", "").strip()
        cmd = check.get("cmd", "").strip()
        if not label:
            return (False, f"post_checks[{i}]: missing 'label'")
        if not cmd:
            return (False, f"post_checks[{i}] ('{label}'): missing 'cmd'")

    return (True, "SMOKE_BEFORE spec valid")


def smoke_before_record(
    state: dict,
    smoke_spec: dict,
    baseline_outputs: dict[str, dict],
) -> dict:
    """Record SMOKE_BEFORE baseline outputs into the ADID state.

    Called AFTER the agent runs baseline commands and BEFORE the first edit.
    Baseline outputs are stamped as [Exact] evidence.

    baseline_outputs: {label: {exit_code, stdout_hash, stderr_hash, timestamp}, ...}
      - 'label' must match a baseline check label
      - 'exit_code' is the actual exit code
      - 'stdout_hash' is md5/sha256 of stdout (for fast comparison)
      - 'stderr_hash' is md5/sha256 of stderr
      - 'timestamp' is ISO 8601 UTC

    Returns the state dict with 'smoke_baseline' key added/updated.
    """
    recorded: dict[str, dict] = {}
    for label, output in baseline_outputs.items():
        recorded[label] = {
            "exit_code": output.get("exit_code"),
            "stdout_hash": output.get("stdout_hash", ""),
            "stderr_hash": output.get("stderr_hash", ""),
            "timestamp": output.get("timestamp", ""),
        }

    state["smoke_baseline"] = recorded
    state["smoke_spec_hash"] = _hash_smoke_spec(smoke_spec)

    return state


def smoke_before_verify(
    state: dict,
    post_outputs: dict[str, dict],
) -> dict:
    """Verify post-implementation outputs against SMOKE_BEFORE baseline.

    Called AFTER implementation, BEFORE marking task as Done.
    Compares each post_output against the recorded baseline.

    post_outputs: {label: {exit_code, stdout_hash, stderr_hash}, ...}

    Returns:
      {
        "status": "PASS" | "FAIL" | "BLOCKED" | "NO_BASELINE",
        "checks": [
          {"label", "status": "PASS"|"FAIL"|"MISSING", "detail": str},
          ...
        ],
        "summary": str,
      }
    """
    baseline = state.get("smoke_baseline", {})
    if not baseline:
        return {
            "status": "NO_BASELINE",
            "checks": [],
            "summary": "No SMOKE_BEFORE baseline recorded — cannot verify. Run smoke_before_record first.",
        }

    checks: list[dict] = []
    all_pass = True
    any_blocked = False

    for label, expected in baseline.items():
        actual = post_outputs.get(label)
        if actual is None:
            checks.append({
                "label": label,
                "status": "MISSING",
                "detail": f"post-output for '{label}' not provided",
            })
            all_pass = False
            continue

        # Compare exit codes
        expected_exit = expected.get("exit_code")
        actual_exit = actual.get("exit_code")
        if expected_exit is not None and actual_exit is not None:
            if expected_exit != actual_exit:
                checks.append({
                    "label": label,
                    "status": "FAIL",
                    "detail": f"exit code: expected {expected_exit}, got {actual_exit}",
                })
                all_pass = False
                continue

        # Compare output hashes (if both present)
        expected_hash = expected.get("stdout_hash", "")
        actual_hash = actual.get("stdout_hash", "")
        if expected_hash and actual_hash and expected_hash != actual_hash:
            checks.append({
                "label": label,
                "status": "FAIL",
                "detail": "stdout hash mismatch — output changed",
            })
            all_pass = False
            continue

        checks.append({
            "label": label,
            "status": "PASS",
            "detail": "output matches baseline",
        })

    if all_pass:
        status = "PASS"
        summary = f"All {len(checks)} smoke checks passed against baseline"
    elif any_blocked:
        status = "BLOCKED"
        summary = f"{sum(1 for c in checks if c['status']=='FAIL')} checks failed, {sum(1 for c in checks if c['status']=='MISSING')} missing"
    else:
        status = "FAIL"
        failed = sum(1 for c in checks if c["status"] == "FAIL")
        missing = sum(1 for c in checks if c["status"] == "MISSING")
        summary = f"{failed} failed, {missing} missing out of {len(checks)} checks"

    return {"status": status, "checks": checks, "summary": summary}


def _hash_smoke_spec(spec: dict) -> str:
    """Stable hash of a smoke spec for integrity verification."""
    import hashlib
    import json
    canonical = json.dumps(spec, sort_keys=True, default=str)
    return hashlib.md5(canonical.encode()).hexdigest()[:12]


