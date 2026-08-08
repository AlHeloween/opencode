"""Targeted tests for prompts_kernel (specs)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    _ALL_SPECS, _validate_spec,
)

class TestProjectSpecs:
    """§P1-P6 All project specifications validate correctly."""

    def test_all_specs_have_required_fields(self):
        for name, spec in _ALL_SPECS.items():
            _validate_spec(name, spec)

    def test_all_specs_loaded(self):
        # Skills (ADM_EXE, RAG, …) are a separate package — not kernel SPECS.
        assert len(_ALL_SPECS) == 27
        assert "BUILD_MODE" in _ALL_SPECS
        assert "PLAN_MODE" in _ALL_SPECS
        assert "CODER_AGENT" in _ALL_SPECS
        assert "EXPLORER_AGENT" in _ALL_SPECS
        assert "ORCHESTRATOR_AGENT" in _ALL_SPECS
        assert "ADM_EXE" not in _ALL_SPECS
        assert "ADID_OPS" in _ALL_SPECS
        assert "GOVERNANCE" in _ALL_SPECS
        assert "GROUNDING_RULES" in _ALL_SPECS
        assert "PLANNING" in _ALL_SPECS
        assert "COMMIT" in _ALL_SPECS

    def test_spec_field_counts(self):
        """Verify known field counts to catch regression."""
        counts = {
            "CODER_AGENT": {"constraints": 4, "invariants": 4, "forbidden_actions": 4},
            "ORCHESTRATOR_AGENT": {"constraints": 3, "invariants": 5, "forbidden_actions": 5},
            "BUILD_MODE": {"constraints": 5, "invariants": 4, "forbidden_actions": 4},
            "GOVERNANCE": {"constraints": 5, "invariants": 3, "forbidden_actions": 2},
        }
        for name, expected in counts.items():
            spec = _ALL_SPECS[name]
            for field, count in expected.items():
                assert len(spec.get(field, [])) == count, f"{name}.{field} expected {count}"

