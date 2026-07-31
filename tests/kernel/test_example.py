"""Targeted tests for opencode_prompts_kernel (example)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    Activity, example_ownership_inspection, validate_cross_field_invariants,
)

class TestExampleOwnershipInspection:
    """§14 Example — ownership inspection contract construction."""

    def test_contract_builds(self):
        contract = example_ownership_inspection()
        assert contract.contract_id == "ownership-observe-001"
        assert contract.classification.activity == Activity.OBSERVE
        assert contract.state == "FROZEN"

    def test_invariants_pass(self):
        contract = example_ownership_inspection()
        errors = validate_cross_field_invariants(contract)
        assert len(errors) == 0

    def test_serialization(self):
        contract = example_ownership_inspection()
        js = contract.to_json()
        parsed = json.loads(js)
        assert parsed["contract_id"] == "ownership-observe-001"
        assert parsed["classification"]["activity"] == "OBSERVE"

