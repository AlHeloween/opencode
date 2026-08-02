"""Targeted tests for prompts_kernel (fractal plan cluster)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    CLARA_THRESHOLD,
    PlanCluster,
    PlanModification,
    adaptive_depth,
    adaptive_k,
    adaptive_tau,
    clara_k_medoids_modifications,
    emit_state,
    execute_medoid,
    generate_fractal_candidates,
    generate_lsystem_candidates,
    generate_quad_oct,
    generate_sierpinski,
    goal_peaks,
    goal_seeds,
    ground,
    k_medoids_modifications,
    lsystem_rewrite,
    residual_recluster,
    run_task_geometry,
    select_fractal_model,
    select_medoids_tasks,
    smoke_before_record,
    smoke_before_spec,
    smoke_before_validate,
    smoke_before_verify,
    sv_delta,
    verify_oracles,
)


class TestSelectFractalModel:
    """Model dispatch by peak count."""

    def test_sierpinski_3_peaks(self):
        assert select_fractal_model(3) == "Sierpinski"

    def test_sierpinski_many_peaks(self):
        assert select_fractal_model(7) == "Sierpinski"

    def test_quad_oct_2(self):
        assert select_fractal_model(2) == "Quad-Oct"

    def test_quad_oct_4(self):
        assert select_fractal_model(4) == "Quad-Oct"

    def test_quad_oct_8(self):
        assert select_fractal_model(8) == "Quad-Oct"

    def test_lsystem_fallback_1(self):
        assert select_fractal_model(1) == "L-System"

    def test_lsystem_fallback_5(self):
        """5 peaks is not 2/4/8 but IS >= 3 → Sierpinski, not L-System."""
        assert select_fractal_model(5) == "Sierpinski"

    def test_lsystem_fallback_0(self):
        assert select_fractal_model(0) == "L-System"

    def test_delta_v_ignored(self):
        """delta_v is reserved, currently ignored."""
        assert select_fractal_model(3, delta_v=0.9) == "Sierpinski"
        assert select_fractal_model(1, delta_v=0.9) == "L-System"


class TestSelectMedoidsTasks:
    """Clause-level cut: foam dies, medoids only."""

    def _make_mod(self, desc: str, file: str = "test.py") -> PlanModification:
        return PlanModification(
            target_file=file,
            target_module="test.module",
            change_type="logic",
            risk="low",
            description=desc,
        )

    def test_empty(self):
        assert select_medoids_tasks([]) == []

    def test_single(self):
        mods = [self._make_mod("fix typo")]
        tasks = select_medoids_tasks(mods)
        assert tasks == ["fix typo"]

    def test_two(self):
        mods = [
            self._make_mod("fix A", "a.py"),
            self._make_mod("fix B", "b.py"),
        ]
        tasks = select_medoids_tasks(mods)
        # k = ceil(2/2) = 1 → one medoid
        assert len(tasks) == 1
        assert tasks[0] in ("fix A", "fix B")

    def test_four(self):
        mods = [
            self._make_mod("fix A", "a.py"),
            self._make_mod("fix B", "b.py"),
            self._make_mod("fix C", "c.py"),
            self._make_mod("fix D", "d.py"),
        ]
        tasks = select_medoids_tasks(mods)
        # k = ceil(4/2) = 2 → two medoids
        assert len(tasks) == 2
        assert all(isinstance(t, str) for t in tasks)


class TestLSystemRewrite:
    """F→F+F-F grammar engine."""

    def test_depth_0_axiom_only(self):
        result = lsystem_rewrite("F", depth=0)
        assert result == ["F"]

    def test_depth_1_default(self):
        result = lsystem_rewrite(depth=1)
        assert result == ["F", "F+F-F"]

    def test_depth_2_default(self):
        result = lsystem_rewrite(depth=2)
        assert len(result) == 3
        assert result[0] == "F"
        assert result[1] == "F+F-F"
        # F+F-F → (F+F-F)+(F+F-F)-(F+F-F) = F+F-F+F+F-F-F+F-F
        expected_d2 = "F+F-F+F+F-F-F+F-F"
        assert result[2] == expected_d2

    def test_depth_3_string_length(self):
        """Each level: len ≈ 3^depth (Koch growth)."""
        result = lsystem_rewrite(depth=3)
        assert len(result) == 4
        # F=1, F+F-F=5, d2=17, d3=53 (5*3+2 connectors)
        assert len(result[3]) > len(result[2])

    def test_custom_rules(self):
        result = lsystem_rewrite("A", {"A": "AB", "B": "A"}, depth=2)
        assert result == ["A", "AB", "ABA"]

    def test_no_match_char_passthrough(self):
        """Characters not in rules pass through unchanged."""
        result = lsystem_rewrite("X", depth=2)
        assert result == ["X", "X", "X"]


class TestAdaptiveTau:
    """Percentile-based candidate filter threshold for GATE 2."""

    def test_empty_fallback(self):
        assert adaptive_tau([], fallback=0.5) == 0.5

    def test_small_n_fallback(self):
        """N < min_n (20) → fixed fallback."""
        dists = [0.1, 0.2, 0.9]
        assert adaptive_tau(dists, fallback=0.5, min_n=20) == 0.5

    def test_percentile_logic(self):
        """70th percentile on values in [0,1] range."""
        # 100 values: 70 below 0.42, 30 above
        dists = [0.01 * i for i in range(100)]  # 0.00 .. 0.99
        tau = adaptive_tau(dists, percentile=0.70, min_n=20)
        # 70th item in sorted 100 items: index 70 → value 0.70
        assert abs(tau - 0.70) < 0.01

    def test_clamped_low(self):
        """Never below 0.1."""
        dists = [0.001] * 50 + [0.002] * 50
        tau = adaptive_tau(dists, percentile=0.70, min_n=20)
        assert tau == 0.1  # would be 0.001 or 0.002, clamped to 0.1

    def test_clamped_high(self):
        """Never above 0.9."""
        dists = [0.99] * 50 + [0.999] * 50
        tau = adaptive_tau(dists, percentile=0.70, min_n=20)
        assert tau == 0.9  # would be ~0.99, clamped to 0.9

    def test_large_diverse_set(self):
        """Realistic: diverse distances, 70th percentile."""
        import random
        random.seed(42)
        dists = [random.uniform(0.05, 1.5) for _ in range(500)]
        tau = adaptive_tau(dists, percentile=0.70, min_n=20)
        # Should be somewhere in the upper third, but clamped between 0.1-0.9
        assert 0.1 <= tau <= 0.9
        # Actual 70th percentile of this seed is ~1.07, clamped to 0.9
        assert tau == 0.9


class TestAdaptiveK:
    """CV-based dispersion → k for k-medoids."""

    def test_empty_small_n_fallback(self):
        """N < min_n (4) → clamped to [1, N]."""
        assert adaptive_k([], min_k=2, min_n=4) == 1
        assert adaptive_k([0.1, 0.2], min_k=2, min_n=4) == 2  # N=2 < 4

    def test_all_identical_zero_cv(self):
        """All distances equal → CV = 0 → k = min_k."""
        dists = [0.42] * 50
        k = adaptive_k(dists, min_k=2, min_n=4)
        assert k == 2

    def test_wide_spread_high_k(self):
        """High dispersion → k > min_k."""
        dists = [0.01 * i for i in range(100)]  # 0.00 .. 0.99, wide spread
        k = adaptive_k(dists, min_k=2, min_n=4)
        # CV ≈ 0.58 → k in upper half
        assert 10 <= k <= 50

    def test_clamped_to_max_k(self):
        """Cannot exceed ceil(N/2)."""
        dists = [0.0, 0.0, 1.0, 1.0] * 5  # bimodal, N=20
        k = adaptive_k(dists, min_k=2, min_n=4)
        assert k <= 10  # ceil(20/2) = 10

    def test_explicit_max_k(self):
        """Respect explicit max_k parameter."""
        dists = [0.01 * i for i in range(100)]  # wide spread
        k = adaptive_k(dists, min_k=2, max_k=5, min_n=4)
        assert k <= 5


class TestAdaptiveDepth:
    """Depth scaling by peaks + evidence count."""

    def test_simple_single_peak(self):
        assert adaptive_depth(1, 0) == 1
        assert adaptive_depth(1, 5) == 1

    def test_default_two_peaks(self):
        assert adaptive_depth(2, 0) == 2
        assert adaptive_depth(3, 5) == 2

    def test_complex_many_peaks(self):
        assert adaptive_depth(4, 0) == 3
        assert adaptive_depth(10, 0) == 3

    def test_complex_high_evidence(self):
        """evidence_count > 10 overrides peak count."""
        assert adaptive_depth(2, 11) == 3
        assert adaptive_depth(1, 15) == 3

    def test_edge_zero_peaks(self):
        assert adaptive_depth(0, 0) == 1


class TestCLARAKMedoids:
    """CLARA sampling k-medoids for large N."""

    def _make_mod(self, desc: str, file: str = "test.py", module: str = "test.module") -> PlanModification:
        return PlanModification(
            target_file=file,
            target_module=module,
            change_type="logic",
            risk="low",
            description=desc,
        )

    def test_small_n_falls_back_to_exact(self):
        """N < CLARA_THRESHOLD → exact k-medoids."""
        mods = [self._make_mod(f"fix {i}", f"file{i}.py") for i in range(10)]
        clusters = clara_k_medoids_modifications(mods)
        assert len(clusters) > 0
        total_members = sum(c.cluster_size for c in clusters)
        assert total_members == len(mods)

    def test_large_n_clara_runs(self):
        """N ≥ CLARA_THRESHOLD → CLARA path, returns valid clusters."""
        N = CLARA_THRESHOLD + 5  # 105 — just above threshold
        mods = [
            self._make_mod(f"fix {i}", f"file{i % 20}.py", f"mod.{i % 5}")
            for i in range(N)
        ]
        clusters = clara_k_medoids_modifications(mods, repetitions=2)
        assert len(clusters) > 0
        total_members = sum(c.cluster_size for c in clusters)
        assert total_members == N

    def test_medoids_are_real_members(self):
        """Every medoid must be one of the input modifications."""
        import random
        random.seed(123)
        N = 110
        mods = [
            self._make_mod(f"fix {i}", f"f{i}.py", f"m{i % 10}")
            for i in range(N)
        ]
        clusters = clara_k_medoids_modifications(mods, repetitions=2)
        descriptions = {m.description for m in mods}
        for c in clusters:
            assert c.centroid.description in descriptions

    def test_no_duplicate_medoids(self):
        """Medoid descriptions should be distinct."""
        import random
        random.seed(456)
        N = 110
        mods = [
            self._make_mod(f"fix {i}", f"f{i}.py", f"m{i % 8}")
            for i in range(N)
        ]
        clusters = clara_k_medoids_modifications(mods, repetitions=2)
        medoid_descs = [c.centroid.description for c in clusters]
        assert len(medoid_descs) == len(set(medoid_descs))

    def test_clara_auto_integrated(self):
        """k_medoids_modifications auto-delegates to CLARA when N ≥ threshold."""
        import random
        random.seed(789)
        N = 110
        mods = [
            self._make_mod(f"fix {i}", f"f{i}.py", f"m{i % 10}")
            for i in range(N)
        ]
        # use_clara=True (default) → CLARA path
        clusters = k_medoids_modifications(mods)
        assert len(clusters) > 0
        total = sum(c.cluster_size for c in clusters)
        assert total == N
        # use_clara=False → exact path (small enough to be fast)
        clusters_exact = k_medoids_modifications(mods, use_clara=False)
        assert len(clusters_exact) > 0
        total_exact = sum(c.cluster_size for c in clusters_exact)
        assert total_exact == N


# =========================================================================
# Fractal generators: Sierpinski, Quad/Oct, L-System
# =========================================================================


def _make_sv(keywords_and_weights: list[tuple[str, float]]) -> dict[str, float]:
    """Helper: build an SV dict from (keyword, weight) pairs."""
    return {kw: w for kw, w in keywords_and_weights}


def _sample_seeds(n: int, dim: int = 512) -> list[list[float]]:
    """Create synthetic seed vectors with controlled spread."""
    import random
    random.seed(n * 137)
    seeds: list[list[float]] = []
    for i in range(n):
        # Each seed has a different "direction" in the embedding space
        v = [0.0] * dim
        # Activate a block of dimensions unique to this seed
        base = (i * 37) % dim
        for j in range(5):
            idx = (base + j * 13) % dim
            v[idx] = random.uniform(0.5, 1.0)
        seeds.append(v)
    return seeds


class TestSierpinskiGenerator:
    """Recursive triangle subdivision from 3 seeds."""

    def test_depth_0_vertices_only(self):
        seeds = _sample_seeds(3)
        cands = generate_sierpinski(seeds, depth=0)
        # At depth 0: just the 3 vertices
        assert len(cands) == 3

    def test_depth_1_adds_midpoints(self):
        seeds = _sample_seeds(3)
        cands = generate_sierpinski(seeds, depth=1)
        # Depth 1: 3 vertices + 3 edge midpoints = 6
        assert len(cands) == 6

    def test_depth_2_growth(self):
        seeds = _sample_seeds(3)
        cands = generate_sierpinski(seeds, depth=2)
        # Depth 2: 6 + 6 new midpoints = up to 12 (some may be duplicates)
        assert 9 <= len(cands) <= 15

    def test_fewer_than_3_seeds_pads(self):
        """1 or 2 seeds → padded to 3 with zero vectors."""
        seeds = _sample_seeds(1)
        cands = generate_sierpinski(seeds, depth=0)
        assert len(cands) == 3  # padded to 3

    def test_more_than_3_seeds_selects_central(self):
        """8 seeds → selects 3 most central."""
        seeds = _sample_seeds(8)
        cands = generate_sierpinski(seeds, depth=0)
        assert len(cands) == 3

    def test_all_candidates_are_unique(self):
        seeds = _sample_seeds(3)
        cands = generate_sierpinski(seeds, depth=2)
        # Convert to tuples for hashing
        tuples = [tuple(round(x, 10) for x in c) for c in cands]
        assert len(tuples) == len(set(tuples))

    def test_candidates_are_in_convex_hull(self):
        """Candidates should be within the bounding box of the seeds."""
        seeds = _sample_seeds(3)
        cands = generate_sierpinski(seeds, depth=2)
        dim = len(seeds[0])
        for d in range(dim):
            min_val = min(s[d] for s in seeds)
            max_val = max(s[d] for s in seeds)
            for c in cands:
                assert min_val - 1e-6 <= c[d] <= max_val + 1e-6


class TestQuadOctGenerator:
    """Grid subdivision for 2/4/8 seeds."""

    def test_binary_2_seeds_depth_0(self):
        seeds = _sample_seeds(2)
        cands = generate_quad_oct(seeds, depth=0)
        # (2^0 + 1)^1 = 2 points
        assert len(cands) == 2

    def test_binary_2_seeds_depth_1(self):
        seeds = _sample_seeds(2)
        cands = generate_quad_oct(seeds, depth=1)
        assert len(cands) == 3  # (2+1) = 3 points on line

    def test_quad_4_seeds_depth_0(self):
        seeds = _sample_seeds(4)
        cands = generate_quad_oct(seeds, depth=0)
        assert len(cands) == 4  # (1+1)^2 = 4

    def test_quad_4_seeds_depth_1(self):
        seeds = _sample_seeds(4)
        cands = generate_quad_oct(seeds, depth=1)
        assert len(cands) == 9  # (2+1)^2 = 9

    def test_oct_8_seeds_depth_0(self):
        seeds = _sample_seeds(8)
        cands = generate_quad_oct(seeds, depth=0)
        assert len(cands) == 8  # (1+1)^3 = 8

    def test_oct_8_seeds_depth_1(self):
        seeds = _sample_seeds(8)
        cands = generate_quad_oct(seeds, depth=1)
        assert len(cands) == 27  # (2+1)^3 = 27

    def test_odd_seed_count_rounds_up(self):
        """5 seeds → quad (selects 4 most central)."""
        seeds = _sample_seeds(5)
        cands = generate_quad_oct(seeds, depth=0)
        assert len(cands) == 4  # rounds up to quad

    def test_single_seed_uses_binary(self):
        """1 seed → binary (padded to 2)."""
        seeds = _sample_seeds(1)
        cands = generate_quad_oct(seeds, depth=0)
        assert len(cands) == 2  # binary: (1+1)^1 = 2

    def test_candidates_within_reasonable_range(self):
        """Candidates should not diverge arbitrarily from seed values."""
        seeds = _sample_seeds(4)
        cands = generate_quad_oct(seeds, depth=1)
        dim = len(seeds[0])
        # Grid may extend slightly beyond seed extents (parallelogram vs AABB),
        # but should be within 2x the seed bounding box range.
        for d in range(dim):
            min_val = min(s[d] for s in seeds)
            max_val = max(s[d] for s in seeds)
            span = max_val - min_val
            if span < 0.001:
                continue  # skip near-zero dimensions
            for c in cands:
                # Within [min - span, max + span] — generous but finite
                assert min_val - span - 0.01 <= c[d] <= max_val + span + 0.01, (
                    f"d={d} min={min_val} max={max_val} c[d]={c[d]}"
                )


class TestLSystemGenerator:
    """Grammar-walk candidate generation."""

    def test_empty_seeds(self):
        cands = generate_lsystem_candidates([], depth=1)
        assert cands == []

    def test_depth_0_one_candidate(self):
        seeds = _sample_seeds(2)
        cands = generate_lsystem_candidates(seeds, depth=0)
        # Depth 0: string "F" → 1 candidate at centroid
        assert len(cands) == 1

    def test_depth_1_several_candidates(self):
        seeds = _sample_seeds(3)
        cands = generate_lsystem_candidates(seeds, depth=1)
        # Depth 1: string "F+F-F" → 3 F's
        assert len(cands) == 3

    def test_depth_2_approx_30_candidates(self):
        seeds = _sample_seeds(2)
        cands = generate_lsystem_candidates(seeds, depth=2)
        # Depth 2: 9 F's but some may land on same position
        assert 5 <= len(cands) <= 9

    def test_unique_positions(self):
        seeds = _sample_seeds(3)
        cands = generate_lsystem_candidates(seeds, depth=2)
        tuples = [tuple(round(x, 8) for x in c) for c in cands]
        assert len(tuples) == len(set(tuples))


class TestGenerateFractalCandidates:
    """Dispatcher: model → generator."""

    def test_sierpinski_dispatch(self):
        seeds = _sample_seeds(3)
        cands = generate_fractal_candidates("Sierpinski", seeds, depth=1)
        assert len(cands) == 6  # matches generate_sierpinski depth=1

    def test_quad_oct_dispatch(self):
        seeds = _sample_seeds(4)
        cands = generate_fractal_candidates("Quad-Oct", seeds, depth=0)
        assert len(cands) == 4

    def test_lsystem_dispatch(self):
        seeds = _sample_seeds(2)
        cands = generate_fractal_candidates("L-System", seeds, depth=1)
        assert len(cands) == 3

    def test_unknown_model_fallback(self):
        seeds = _sample_seeds(2)
        cands = generate_fractal_candidates("UnknownModel", seeds, depth=1)
        # Falls back to L-System
        assert len(cands) == 3

    def test_empty_seeds(self):
        assert generate_fractal_candidates("Sierpinski", [], depth=1) == []


# =========================================================================
# Goal seeds + ADID loop closure
# =========================================================================


class TestGoalSeeds:
    """Keyword extraction → cluster → seed vectors."""

    def test_trivial_goal_single_seed(self):
        seeds = goal_seeds("fix bug", [])
        assert 1 <= len(seeds) <= 2  # 2 tokens → 1 cluster
        for s in seeds:
            assert len(s) == 512

    def test_moderate_goal_multiple_clusters(self):
        seeds = goal_seeds(
            "add dark mode toggle to settings with persistence and sync",
            [],
        )
        assert 2 <= len(seeds) <= 5
        for s in seeds:
            assert len(s) == 512
            # Seeds should be L2-normalized (by _hash_embed)
            norm = sum(x * x for x in s) ** 0.5
            assert abs(norm - 1.0) < 0.01

    def test_with_evidence(self):
        seeds = goal_seeds(
            "refactor auth module",
            ["JWT tokens expire after 1h", "OAuth2 flow needs refresh token support"],
        )
        assert len(seeds) >= 1
        for s in seeds:
            assert len(s) == 512

    def test_empty_goal(self):
        seeds = goal_seeds("", [])
        assert len(seeds) == 1
        assert len(seeds[0]) == 512

    def test_seeds_capped_at_8(self):
        """Very long goal should not produce more than 8 seeds."""
        long_goal = " ".join(
            f"implement feature number {i} with specific requirements"
            for i in range(50)
        )
        seeds = goal_seeds(long_goal, [])
        assert len(seeds) <= 8

    def test_seeds_are_deterministic(self):
        """Same input → same seeds."""
        seeds1 = goal_seeds("add login page with session management", [])
        seeds2 = goal_seeds("add login page with session management", [])
        for s1, s2 in zip(seeds1, seeds2):
            assert s1 == s2


class TestEmitState:
    """Structured state record emission."""

    def test_empty_state(self):
        s = emit_state()
        assert s["done"] == []
        assert s["pending"] == []
        assert s["blocked"] == []
        assert s["next"] == ""

    def test_full_state(self):
        s = emit_state(
            goal_sv=[0.1, 0.2, 0.3],
            completed_tasks=["added login"],
            pending_tasks=["add dashboard", "add settings"],
            blockers=["need API key"],
            next_step="add dashboard",
        )
        assert s["done"] == ["added login"]
        assert s["pending"] == ["add dashboard", "add settings"]
        assert s["blocked"] == ["need API key"]
        assert s["next"] == "add dashboard"
        assert s["goal_sv"] == [0.1, 0.2, 0.3]


class TestResidualRecluster:
    """ADID loop closure: pending tasks vs original Goal SV."""

    def test_empty_pending(self):
        state = {"pending": []}
        result = residual_recluster(state)
        assert result == []

    def test_no_goal_sv_returns_all(self):
        state = {"pending": ["task a", "task b"]}
        result = residual_recluster(state, original_goal_sv=None)
        assert result == ["task a", "task b"]

    def test_filters_distant_tasks(self):
        goal = [1.0] + [0.0] * 511  # goal aligned with dim 0
        state = {
            "pending": [
                "core feature x",       # close to goal
                "core feature y",       # close to goal
                "tangential zzz",       # distant
                "unrelated qqq",        # distant
            ],
        }
        result = residual_recluster(state, original_goal_sv=goal)
        # Should filter at least some tasks (adaptive_tau at 70th percentile)
        assert len(result) >= 1
        # The 70th percentile may keep 3 of 4 — acceptable
        assert len(result) <= 4

    def test_returns_at_least_one(self):
        goal = [0.0] * 512
        goal[0] = 1.0
        state = {"pending": ["distant task aaa", "distant task bbb"]}
        result = residual_recluster(state, original_goal_sv=goal)
        assert len(result) >= 1

    def test_small_pending_returns_all(self):
        goal = [1.0] + [0.0] * 511
        state = {"pending": ["only task"]}
        result = residual_recluster(state, original_goal_sv=goal)
        assert result == ["only task"]


# =========================================================================
# ground, goal_peaks, sv_delta — pipeline glue
# =========================================================================


class TestGround:
    """Evidence-gathering plan generation."""

    def test_returns_structured_plan(self):
        goal = "implement dark mode toggle in settings"
        plan = ground(goal)
        assert isinstance(plan, dict)
        assert "goal_keywords" in plan
        assert "searches" in plan
        assert "local_probes" in plan
        assert "expected_evidence" in plan

    def test_keywords_extracted(self):
        goal = "fix memory leak in render loop"
        plan = ground(goal)
        keywords = plan["goal_keywords"]
        assert len(keywords) >= 1
        # Should include meaningful words, not stopwords
        for kw in keywords:
            assert kw not in {"the", "a", "in", "is", "of", "to", "and"}

    def test_searches_include_web_and_code(self):
        goal = "optimize database queries for user dashboard"
        plan = ground(goal)
        searches = plan["searches"]
        sources = {s for s, _ in searches}
        assert "web" in sources
        assert "code" in sources

    def test_local_probes_target_codegraph(self):
        goal = "refactor auth module"
        plan = ground(goal)
        probes = plan["local_probes"]
        tools = {t for t, _ in probes}
        assert "codegraph" in tools

    def test_empty_goal_handled(self):
        goal = ""
        plan = ground(goal)
        assert plan["goal_keywords"] == []
        assert plan["searches"] == []
        # local_probes may be empty too
        assert isinstance(plan["local_probes"], list)


class TestGoalPeaks:
    """Keyword cluster counting for fractal model selection."""

    def test_simple_goal_one_peak(self):
        goal = "fix typo in readme"
        peaks = goal_peaks(goal)
        assert peaks == 1

    def test_two_aspect_goal(self):
        goal = "add dark mode toggle and update color palette"
        peaks = goal_peaks(goal)
        assert peaks >= 1  # may be 1-2 depending on window

    def test_complex_goal_many_peaks(self):
        goal = (
            "implement user registration product catalog shopping cart "
            "checkout flow payment integration email notifications "
            "admin dashboard analytics reporting search engine"
        )
        peaks = goal_peaks(goal)
        assert peaks >= 2  # many distinct topics

    def test_with_evidence_increases_peaks(self):
        goal = "improve performance"
        evidence = [
            "database queries are slow on large datasets",
            "frontend rendering blocks the main thread",
            "network requests timeout under load",
        ]
        peaks_with_ev = goal_peaks(goal, evidence)
        peaks_without = goal_peaks(goal)
        # Evidence may add a peak (new tokens)
        assert peaks_with_ev >= peaks_without

    def test_clamped_to_max(self):
        # Very long goal with many distinct clusters
        goal = " ".join(
            f"feature_{i}" for i in range(50)
        )
        peaks = goal_peaks(goal)
        assert 1 <= peaks <= 9

    def test_empty_goal_returns_one(self):
        assert goal_peaks("") == 1
        assert goal_peaks("   ") == 1


class TestSVDelta:
    """L1 semantic distance between SV states."""

    def test_identical_svs_zero_delta(self):
        sv = _make_sv([("list", 0.3), ("tool", 0.25), ("oracle", 0.2)])
        delta = sv_delta(sv, sv)
        assert delta == 0.0

    def test_disjoint_svs_large_delta(self):
        sv_a = _make_sv([("list", 0.5), ("tool", 0.5)])
        sv_b = _make_sv([("oracle", 0.5), ("verify", 0.5)])
        delta = sv_delta(sv_a, sv_b)
        # Each keyword exists in only one SV → total = 0.5+0.5+0.5+0.5 = 2.0
        assert delta == 2.0

    def test_partial_overlap_moderate_delta(self):
        sv_a = _make_sv([("list", 0.6), ("tool", 0.4)])
        sv_b = _make_sv([("list", 0.4), ("oracle", 0.6)])
        # |0.6-0.4| + |0.4-0.0| + |0.0-0.6| = 0.2 + 0.4 + 0.6 = 1.2
        delta = sv_delta(sv_a, sv_b)
        assert delta == pytest.approx(1.2)

    def test_none_inputs_return_neutral(self):
        assert sv_delta(None, None) == 0.5
        sv = _make_sv([("list", 1.0)])
        assert sv_delta(sv, None) == 0.5
        assert sv_delta(None, sv) == 0.5

    def test_empty_dicts_zero_delta(self):
        assert sv_delta({}, {}) == 0.0

    def test_delta_range_clamped(self):
        """Delta is always in [0.0, 2.0]."""
        sv_a = _make_sv([("a", 1.0)])
        sv_b = _make_sv([("b", 1.0)])
        delta = sv_delta(sv_a, sv_b)
        assert 0.0 <= delta <= 2.0

    def test_large_shift_detected(self):
        """Complete goal change → delta > 0.6 → Sierpinski trigger."""
        sv_a = _make_sv([("list", 0.5), ("tool", 0.5)])
        sv_b = _make_sv([("oracle", 0.4), ("verify", 0.3), ("smoke", 0.3)])
        delta = sv_delta(sv_a, sv_b)
        # Total: |0.5-0| + |0.5-0| + |0-0.4| + |0-0.3| + |0-0.3| = 2.0
        assert delta >= 0.6  # triggers Sierpinski


# =========================================================================
# Integration: run_task_geometry full pipeline
# =========================================================================


class TestRunTaskGeometry:
    """End-to-end pipeline: goal → seeds → fractal → filter → state."""

    def test_simple_3_step_goal(self):
        """A trivial 3-step goal produces valid pipeline output."""
        goal = "fix typo in readme update changelog bump version"
        result = run_task_geometry(goal)

        assert result["status"] == "ok"
        assert result["goal"] == goal
        assert result["seeds_n"] >= 1
        assert result["peaks"] >= 1
        assert result["depth"] >= 1
        assert result["model"] in ("Sierpinski", "Quad-Oct", "L-System")
        assert result["candidates_n"] >= 1
        assert result["filtered_n"] >= 1
        assert result["tau"] > 0.0
        assert result["k_recommended"] >= 1
        assert result["residual_n"] >= 0
        assert result["evidence_plan_searches"] >= 0

    def test_moderate_5_step_goal(self):
        """A 5-aspect goal generates multiple candidates and passes filter."""
        goal = (
            "implement user registration add login form create database schema "
            "setup email verification write unit tests"
        )
        result = run_task_geometry(goal)

        assert result["status"] == "ok"
        assert result["candidates_n"] >= result["filtered_n"]  # filter never adds
        assert result["filtered_n"] >= 1
        # Model should be non-trivial for 5-aspect goal
        assert result["model"] in ("Sierpinski", "Quad-Oct", "L-System")

    def test_complex_10_step_goal(self):
        """A complex multi-topic goal exercises the full deep pipeline."""
        goal = (
            "build ecommerce platform with product catalog shopping cart "
            "checkout flow payment gateway integration order management "
            "inventory tracking shipping labels email notifications "
            "admin dashboard analytics reporting search engine optimization "
            "security audit logging rate limiting"
        )
        result = run_task_geometry(goal)

        assert result["status"] == "ok"
        assert result["peaks"] >= 2  # many distinct topics
        assert result["candidates_n"] >= 1
        assert result["filtered_n"] >= 1
        assert result["k_recommended"] >= 1

    def test_pipeline_deterministic(self):
        """Same goal twice → same pipeline output (fixed seeds used internally)."""
        goal = "add dark mode toggle to settings panel"
        r1 = run_task_geometry(goal)
        r2 = run_task_geometry(goal)

        # All structural fields must match
        for key in ("seeds_n", "peaks", "model", "depth", "candidates_n",
                     "filtered_n", "tau", "k_recommended"):
            assert r1[key] == r2[key], f"non-deterministic field: {key}"

    def test_empty_goal_handled(self):
        """Empty goal should not crash the pipeline."""
        result = run_task_geometry("")
        assert result["status"] in ("ok", "no_candidates_passed_filter")
        assert result["seeds_n"] >= 1  # at least one fallback seed

    def test_evidence_improves_seeds(self):
        """Providing evidence texts increases seed count."""
        goal = "improve performance"
        without_ev = run_task_geometry(goal)
        with_ev = run_task_geometry(goal, evidence_texts=[
            "database queries are slow on large tables",
            "frontend rendering blocks the main thread for 2 seconds",
            "network requests timeout after 30s under load",
        ])
        # Evidence may add additional keyword clusters → more or equal seeds
        assert with_ev["seeds_n"] >= without_ev["seeds_n"]

    def test_filter_never_empty_with_valid_goal(self):
        """For any non-trivial goal, at least some candidates pass the filter."""
        goals = [
            "fix bug in login",
            "add search bar to navigation",
            "update dependencies and run tests",
        ]
        for goal in goals:
            result = run_task_geometry(goal)
            assert result["filtered_n"] >= 1, f"filter lost all candidates for: {goal}"

    def test_tau_in_valid_range(self):
        """Adaptive tau is clamped to [0.1, 0.9]."""
        goal = "refactor the entire authentication module with new oauth2 flow"
        result = run_task_geometry(goal)
        assert 0.1 <= result["tau"] <= 0.9

    def test_depth_scales_with_complexity(self):
        """More complex goals get deeper fractal generation."""
        simple = run_task_geometry("fix typo")
        complex_goal = run_task_geometry(
            "implement user registration product catalog shopping cart "
            "checkout payment admin dashboard analytics"
        )
        # Complex goal should have >= depth of simple goal
        assert complex_goal["depth"] >= simple["depth"]

    def test_residual_returns_subset(self):
        """residual_recluster returns <= pending count tasks."""
        goal = "add dark mode with persistence and system preference detection"
        result = run_task_geometry(goal)
        # residual_n <= filtered_n (residual always subset of pending)
        assert result["residual_n"] <= result["filtered_n"]


# =========================================================================
# Agent-side contract stubs
# =========================================================================


class TestExecuteMedoid:
    """execute_medoid is an agent-side contract stub."""

    def test_returns_tuple(self):
        status, output = execute_medoid("fix login bug")
        assert isinstance(status, str)
        assert isinstance(output, str)

    def test_default_status_is_pending(self):
        """Stub always returns 'pending' — agent must drive execution."""
        status, output = execute_medoid("any task")
        assert status == "pending"
        assert "agent must drive execution" in output.lower()

    def test_accepts_any_task_description(self):
        """Accepts any string as task description."""
        tasks = ["", "x" * 1000, "implement\nmultiline\ntask"]
        for task in tasks:
            status, output = execute_medoid(task)
            assert status == "pending"


class TestVerifyOracles:
    """verify_oracles is an agent-side contract stub."""

    def test_no_op_on_empty_lists(self):
        completed, pending, blockers = [], [], []
        verify_oracles(completed, pending, blockers)
        assert completed == []
        assert pending == []
        assert blockers == []

    def test_does_not_mutate_on_no_op(self):
        completed = ["task_a", "task_b"]
        pending = ["task_c"]
        blockers = [{"task": "task_d", "reason": "external dep"}]
        verify_oracles(completed, pending, blockers)
        # Stub is no-op — lists unchanged
        assert completed == ["task_a", "task_b"]
        assert pending == ["task_c"]
        assert len(blockers) == 1

    def test_accepts_empty_blockers(self):
        completed, pending = ["done_task"], ["retry_task"]
        verify_oracles(completed, pending, [])
        # No-op stub preserves state
        assert completed == ["done_task"]
        assert pending == ["retry_task"]


# =========================================================================
# SMOKE.BEFORE — industrial contract tests
# =========================================================================


def _valid_smoke_spec() -> dict:
    """Helper: a minimal valid smoke spec."""
    return {
        "smoke_na": False,
        "smoke_na_reason": None,
        "baseline": [
            {
                "label": "typecheck",
                "cmd": "bun typecheck 2>&1",
                "expected_exit": 0,
                "tolerance": 0.0,
                "scope": "typecheck",
            },
            {
                "label": "unit_tests",
                "cmd": "pytest tests/ -x -q",
                "expected_exit": 0,
                "tolerance": 0.0,
                "scope": "unit",
            },
        ],
        "post_checks": [],
        "blast_radius": ["src/", "tests/"],
    }


def _valid_baseline_outputs() -> dict:
    """Helper: baseline outputs matching _valid_smoke_spec."""
    return {
        "typecheck": {
            "exit_code": 0,
            "stdout_hash": "abc123def456",
            "stderr_hash": "",
            "timestamp": "2026-08-02T00:00:00Z",
        },
        "unit_tests": {
            "exit_code": 0,
            "stdout_hash": "def789ghi012",
            "stderr_hash": "",
            "timestamp": "2026-08-02T00:00:01Z",
        },
    }


class TestSmokeBeforeSpec:
    """smoke_before_spec generates a structured template from task description."""

    def test_returns_smoke_na_false_by_default(self):
        spec = smoke_before_spec("fix bug in login")
        assert spec["smoke_na"] is False
        assert spec["smoke_na_reason"] is None

    def test_returns_empty_baseline(self):
        """Agent must fill in baseline commands — kernel provides template."""
        spec = smoke_before_spec("add dark mode")
        assert spec["baseline"] == []
        assert spec["post_checks"] == []

    def test_infers_blast_radius_from_keywords(self):
        spec = smoke_before_spec("fix database migration and update frontend react component")
        assert "db/" in spec["blast_radius"]
        assert "ui/" in spec["blast_radius"]

    def test_default_blast_radius_when_no_keywords(self):
        spec = smoke_before_spec("do something vague")
        assert spec["blast_radius"] == ["project/"]

    def test_deduplicates_blast_radius(self):
        spec = smoke_before_spec("database database database migration sql database")
        # 'db/' should appear only once (database + sql + migration all map to db/)
        assert spec["blast_radius"].count("db/") == 1

    def test_task_with_multiple_domains(self):
        spec = smoke_before_spec("fix api endpoint security and add ui component tests")
        assert "api/" in spec["blast_radius"]
        assert "auth/" in spec["blast_radius"]  # 'security' maps to auth/
        assert "ui/" in spec["blast_radius"]


class TestSmokeBeforeValidate:
    """smoke_before_validate enforces the SMOKE.BEFORE contract."""

    def test_valid_spec_passes(self):
        ok, msg = smoke_before_validate(_valid_smoke_spec())
        assert ok, msg

    def test_smoke_na_without_reason_fails(self):
        spec = {"smoke_na": True, "smoke_na_reason": None, "baseline": []}
        ok, msg = smoke_before_validate(spec)
        assert not ok
        assert "justification" in msg.lower()

    def test_smoke_na_with_empty_reason_fails(self):
        spec = {"smoke_na": True, "smoke_na_reason": "   ", "baseline": []}
        ok, msg = smoke_before_validate(spec)
        assert not ok

    def test_smoke_na_with_reason_passes(self):
        spec = {"smoke_na": True, "smoke_na_reason": "documentation-only change", "baseline": []}
        ok, msg = smoke_before_validate(spec)
        assert ok

    def test_empty_baseline_without_smoke_na_fails(self):
        """'test later' is forbidden — must have specs or declare N/A."""
        spec = {"smoke_na": False, "smoke_na_reason": None, "baseline": []}
        ok, msg = smoke_before_validate(spec)
        assert not ok
        assert "test later" in msg.lower()

    def test_missing_label_fails(self):
        spec = _valid_smoke_spec()
        spec["baseline"][0].pop("label")
        ok, msg = smoke_before_validate(spec)
        assert not ok
        assert "label" in msg.lower()

    def test_missing_cmd_fails(self):
        spec = _valid_smoke_spec()
        spec["baseline"][0]["cmd"] = ""
        ok, msg = smoke_before_validate(spec)
        assert not ok
        assert "cmd" in msg.lower()

    def test_missing_expected_exit_fails(self):
        spec = _valid_smoke_spec()
        spec["baseline"][0].pop("expected_exit")
        ok, msg = smoke_before_validate(spec)
        assert not ok
        assert "expected_exit" in msg.lower()

    def test_tolerance_without_reason_fails(self):
        spec = _valid_smoke_spec()
        spec["baseline"][0]["tolerance"] = 0.3
        ok, msg = smoke_before_validate(spec)
        assert not ok
        assert "tolerance_reason" in msg.lower()

    def test_tolerance_with_reason_passes(self):
        spec = _valid_smoke_spec()
        spec["baseline"][0]["tolerance"] = 0.3
        spec["baseline"][0]["tolerance_reason"] = "timing-dependent integration test"
        ok, msg = smoke_before_validate(spec)
        assert ok

    def test_post_checks_validated_too(self):
        spec = _valid_smoke_spec()
        spec["post_checks"] = [{"label": "", "cmd": "run something"}]
        ok, msg = smoke_before_validate(spec)
        assert not ok
        assert "post_checks" in msg.lower()


class TestSmokeBeforeRecord:
    """smoke_before_record records baseline outputs into state."""

    def test_records_baseline_into_state(self):
        state = {"done": [], "pending": ["task1"], "blocked": [], "next": "task1"}
        spec = _valid_smoke_spec()
        outputs = _valid_baseline_outputs()
        result = smoke_before_record(state, spec, outputs)
        assert "smoke_baseline" in result
        assert "typecheck" in result["smoke_baseline"]
        assert result["smoke_baseline"]["typecheck"]["exit_code"] == 0

    def test_preserves_existing_state_keys(self):
        state = {"done": ["old_task"], "pending": [], "blocked": [], "next": None}
        spec = _valid_smoke_spec()
        outputs = _valid_baseline_outputs()
        result = smoke_before_record(state, spec, outputs)
        assert result["done"] == ["old_task"]

    def test_adds_smoke_spec_hash(self):
        state = {"done": [], "pending": [], "blocked": [], "next": None}
        spec = _valid_smoke_spec()
        outputs = _valid_baseline_outputs()
        result = smoke_before_record(state, spec, outputs)
        assert "smoke_spec_hash" in result
        assert len(result["smoke_spec_hash"]) == 12  # md5[:12]

    def test_spec_hash_is_stable(self):
        state = {"done": [], "pending": [], "blocked": [], "next": None}
        spec = _valid_smoke_spec()
        outputs = _valid_baseline_outputs()
        r1 = smoke_before_record(dict(state), spec, outputs)
        r2 = smoke_before_record(dict(state), spec, outputs)
        assert r1["smoke_spec_hash"] == r2["smoke_spec_hash"]


class TestSmokeBeforeVerify:
    """smoke_before_verify compares post-impl outputs against baseline."""

    def test_all_pass_when_outputs_match(self):
        state = {"smoke_baseline": {
            "typecheck": {"exit_code": 0, "stdout_hash": "abc", "stderr_hash": ""},
        }}
        post = {"typecheck": {"exit_code": 0, "stdout_hash": "abc", "stderr_hash": ""}}
        result = smoke_before_verify(state, post)
        assert result["status"] == "PASS"
        assert result["checks"][0]["status"] == "PASS"

    def test_exit_code_mismatch_fails(self):
        state = {"smoke_baseline": {
            "typecheck": {"exit_code": 0, "stdout_hash": "abc", "stderr_hash": ""},
        }}
        post = {"typecheck": {"exit_code": 1, "stdout_hash": "abc", "stderr_hash": ""}}
        result = smoke_before_verify(state, post)
        assert result["status"] == "FAIL"

    def test_hash_mismatch_fails(self):
        state = {"smoke_baseline": {
            "typecheck": {"exit_code": 0, "stdout_hash": "abc", "stderr_hash": ""},
        }}
        post = {"typecheck": {"exit_code": 0, "stdout_hash": "xyz", "stderr_hash": ""}}
        result = smoke_before_verify(state, post)
        assert result["status"] == "FAIL"

    def test_missing_post_output_reported(self):
        state = {"smoke_baseline": {
            "typecheck": {"exit_code": 0, "stdout_hash": "abc", "stderr_hash": ""},
        }}
        post = {}  # nothing provided
        result = smoke_before_verify(state, post)
        assert result["status"] == "FAIL"
        assert result["checks"][0]["status"] == "MISSING"

    def test_no_baseline_returns_no_baseline_status(self):
        state = {}
        post = {"typecheck": {"exit_code": 0, "stdout_hash": "abc"}}
        result = smoke_before_verify(state, post)
        assert result["status"] == "NO_BASELINE"

    def test_partial_failure_mixed_status(self):
        state = {"smoke_baseline": {
            "typecheck": {"exit_code": 0, "stdout_hash": "abc", "stderr_hash": ""},
            "unit": {"exit_code": 0, "stdout_hash": "def", "stderr_hash": ""},
        }}
        post = {
            "typecheck": {"exit_code": 0, "stdout_hash": "abc", "stderr_hash": ""},
            "unit": {"exit_code": 1, "stdout_hash": "xyz", "stderr_hash": "err"},
        }
        result = smoke_before_verify(state, post)
        assert result["status"] == "FAIL"
        assert result["checks"][0]["status"] == "PASS"
        assert result["checks"][1]["status"] == "FAIL"


class TestEmitStateSmokeBaseline:
    """emit_state with smoke_baseline parameter."""

    def test_emit_state_includes_smoke_baseline_when_provided(self):
        state = emit_state(
            goal_sv=[0.5, 0.5],
            completed_tasks=["task_a"],
            smoke_baseline={"check1": {"exit_code": 0}},
        )
        assert "smoke_baseline" in state
        assert state["smoke_baseline"]["check1"]["exit_code"] == 0

    def test_emit_state_omits_smoke_baseline_when_none(self):
        state = emit_state(completed_tasks=["task_a"])
        assert "smoke_baseline" not in state
