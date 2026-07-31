"""Kernel fragment: 14_plan_cluster (former monofile L1259-1457)."""

# Pre-flight investigation: cluster planned modifications via k-medoids,
# dispatch explorer agent to each centroid BEFORE executing changes.
# This prevents "old midware bugs package" surprises — systemic issues
# that are invisible from a single file diff.

import math


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
) -> list[PlanCluster]:
    """Cluster planned modifications via k-medoids (Lloyd-style).

    Algorithm:
    1. Embed each modification → 512-d vector
    2. k = ceil(N/2) per ADID Mode 2 fractal task generation spec
    3. Initialize k medoids evenly spaced
    4. Iterate: assign→recompute medoid until convergence (max 20 iters)
    5. Return PlanCluster per medoid

    Distance metric: Manhattan (L1) — preserves interpretability in sparse
    fractal embedding spaces and avoids hollow-centroid artifacts.
    """
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


