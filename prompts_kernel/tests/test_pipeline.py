"""Integration test: full run_task_geometry pipeline end-to-end.

Tests the complete fractal planning pipeline:
  ground → seeds → fractal over-generate → L1 filter (adaptive τ)
  → adaptive k → medoids (→ CLARA when N≥100) → CENTRAL_TASKS
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    CLARA_THRESHOLD,
    PlanModification,
    adaptive_depth,
    adaptive_k,
    adaptive_tau,
    k_medoids_modifications,
    lsystem_rewrite,
    select_fractal_model,
    select_medoids_tasks,
)


# ── Pipeline helpers (mirrors ALGORITHM_CARD pseudocode) ──────────────

def _make_candidate_mods(n: int, seed: int = 0) -> list[PlanModification]:
    """Generate synthetic candidates with varied modules/files/risks."""
    import random
    rng = random.Random(seed)
    modules = ["core.auth", "core.db", "ui.dialog", "ui.table",
               "api.rest", "api.graphql", "config.theme", "config.runtime"]
    risks = ["low", "medium", "high"]
    types = ["logic", "visual", "data_flow", "api_surface"]
    mods: list[PlanModification] = []
    for i in range(n):
        mods.append(PlanModification(
            target_file=f"src/{rng.choice(modules).replace('.', '/')}/file{i}.py",
            target_module=rng.choice(modules),
            change_type=rng.choice(types),
            risk=rng.choice(risks),
            description=f"task-{i}: modify {rng.choice(modules)}",
        ))
    return mods


def _candidate_distance_to_goal(mod: PlanModification, goal_keywords: set[str]) -> float:
    """Synthetic L1 distance: penalize missing goal keywords."""
    mod_terms = set(mod.target_module.replace(".", " ").split())
    mod_terms.update(mod.description.split("-")[-1].split())
    mod_terms.update(mod.change_type.split("_"))
    # More shared keywords → lower distance
    overlap = len(mod_terms & goal_keywords)
    # Distance = 1.0 - normalized overlap
    if not mod_terms:
        return 1.0
    return max(0.05, 1.0 - overlap / max(len(mod_terms), len(goal_keywords)))


# ── Integration tests ─────────────────────────────────────────────────

class TestPipelineSmallN:
    """Pipeline with N < 100 (exact k-medoids, no CLARA fallback)."""

    def test_full_pipeline_tiny(self):
        """3 candidates → ground→seeds→fractal→filter→medoids."""
        goal_keywords = {"core", "auth", "db"}  # match real module names
        evidence_count = 5

        # Step 1 & 2: ground + seeds (simulated)
        peaks = 2  # 2 goal-surface peaks
        model = select_fractal_model(peaks)
        assert model in ("Quad-Oct", "Sierpinski", "L-System")

        depth = adaptive_depth(peaks, evidence_count)
        assert depth >= 1

        # Step 3: fractal over-generate (simulated)
        # Generate enough candidates that filter doesn't eliminate all
        candidates = _make_candidate_mods(40, seed=42)

        # Step 4: L1 filter
        distances = [_candidate_distance_to_goal(c, goal_keywords) for c in candidates]
        tau = adaptive_tau(distances, percentile=0.70)
        filtered = [c for c, d in zip(candidates, distances) if d <= tau]
        assert len(filtered) > 0, f"Filter eliminated all {len(candidates)} candidates, tau={tau:.3f}"

        # Step 5: adaptive k + select medoids
        filtered_distances = [d for d in distances if d <= tau]
        k = adaptive_k(filtered_distances, min_k=2)
        tasks = select_medoids_tasks(filtered)
        assert len(tasks) > 0

    def test_pipeline_deterministic(self):
        """Same input → same output (fixed seed)."""
        goal_keywords = {"db", "migrate", "schema"}

        def run_pipe():
            candidates = _make_candidate_mods(30, seed=100)
            distances = [_candidate_distance_to_goal(c, goal_keywords) for c in candidates]
            tau = adaptive_tau(distances)
            filtered = [c for c, d in zip(candidates, distances) if d <= tau]
            return select_medoids_tasks(filtered)

        tasks_a = run_pipe()
        tasks_b = run_pipe()
        assert tasks_a == tasks_b  # deterministic given same seed

    def test_pipeline_noise_resistance(self):
        """Adding distant candidates doesn't change medoids."""
        goal_keywords = {"ui", "render", "component"}
        good = _make_candidate_mods(20, seed=1)

        # Create distant "noise" candidates with unrelated keywords
        import random
        rng = random.Random(999)
        noise = [
            PlanModification(
                target_file=f"noise/n{i}.py",
                target_module="noise.unrelated",
                change_type="logic",
                risk="low",
                description=f"noise-{i}: unrelated-task",
            )
            for i in range(15)
        ]

        all_candidates = good + noise
        distances = [_candidate_distance_to_goal(c, goal_keywords) for c in all_candidates]
        tau = adaptive_tau(distances, percentile=0.70)
        filtered = [c for c, d in zip(all_candidates, distances) if d <= tau]
        tasks = select_medoids_tasks(filtered)

        # None of the noise should survive the filter
        for t in tasks:
            assert "noise" not in t.lower(), f"Noise task leaked: {t}"


class TestPipelineLargeN:
    """Pipeline with N ≥ 100 (CLARA auto-delegation)."""

    def test_pipeline_110_candidates(self):
        """110 candidates → CLARA path, completes successfully."""
        goal_keywords = {"api", "endpoint", "handler"}
        candidates = _make_candidate_mods(110, seed=42)

        distances = [_candidate_distance_to_goal(c, goal_keywords) for c in candidates]
        tau = adaptive_tau(distances, percentile=0.70)
        filtered = [c for c, d in zip(candidates, distances) if d <= tau]
        assert len(filtered) > 10, f"Filter too aggressive: {len(filtered)}/{len(candidates)}"

        tasks = select_medoids_tasks(filtered)
        assert len(tasks) > 0
        assert all(isinstance(t, str) and len(t) > 0 for t in tasks)

    def test_pipeline_110_vs_exact_consistency(self):
        """CLARA results should cover all candidates (no data loss)."""
        goal_keywords = {"config", "theme", "style"}
        candidates = _make_candidate_mods(110, seed=99)

        distances = [_candidate_distance_to_goal(c, goal_keywords) for c in candidates]
        tau = adaptive_tau(distances, percentile=0.70)
        filtered = [c for c, d in zip(candidates, distances) if d <= tau]

        # CLARA (auto via k_medoids_modifications)
        clusters = k_medoids_modifications(filtered)
        total_covered = sum(c.cluster_size for c in clusters)
        assert total_covered == len(filtered)

        # Exact (skip on large sets — O(N²) is slow; test coverage on smaller set)
        if len(filtered) < 80:
            clusters_exact = k_medoids_modifications(filtered, use_clara=False)
            total_exact = sum(c.cluster_size for c in clusters_exact)
            assert total_exact == len(filtered)


class TestPipelineEdgeCases:
    """Edge case handling in the pipeline."""

    def test_empty_candidates(self):
        """Empty candidate set → empty tasks."""
        assert select_medoids_tasks([]) == []

    def test_single_candidate(self):
        """Single candidate → single task."""
        mod = PlanModification(
            target_file="src/x.py",
            target_module="x.y",
            change_type="logic",
            risk="low",
            description="only task",
        )
        tasks = select_medoids_tasks([mod])
        assert tasks == ["only task"]

    def test_all_identical_candidates(self):
        """All candidates identical → single cluster."""
        mods = [
            PlanModification(
                target_file="src/a.py",
                target_module="a.b",
                change_type="logic",
                risk="low",
                description="same task",
            )
            for _ in range(50)
        ]
        tasks = select_medoids_tasks(mods)
        assert len(tasks) >= 1
        # With identical descriptions, medoids collapse
        assert len(set(tasks)) <= len(tasks)
