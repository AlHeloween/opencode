"""Targeted tests for opencode_prompts_kernel (fractal plan cluster)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    CLARA_THRESHOLD,
    PlanCluster,
    PlanModification,
    adaptive_depth,
    adaptive_k,
    adaptive_tau,
    clara_k_medoids_modifications,
    k_medoids_modifications,
    lsystem_rewrite,
    select_fractal_model,
    select_medoids_tasks,
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
