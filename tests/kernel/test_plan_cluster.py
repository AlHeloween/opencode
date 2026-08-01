"""Targeted tests for opencode_prompts_kernel (fractal plan cluster)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    PlanModification,
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
