"""Targeted tests for prompts_kernel (execution permit)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    Execution, ExecutionPermit,
)

class TestExecutionPermit:
    """§21 Consumable execution permit."""

    def test_created_valid(self):
        permit = ExecutionPermit(
            contract_id="test", revision=1,
            contract_digest="a", precondition_digest="b",
            approval_binding="c",
        )
        assert permit.is_valid()
        assert not permit.consumed

    def test_consume_once(self):
        permit = ExecutionPermit(
            contract_id="test", revision=1,
            contract_digest="a", precondition_digest="b",
            approval_binding="c",
        )
        permit.consume()
        assert not permit.is_valid()
        assert permit.consumed

    def test_double_consume_fails(self):
        permit = ExecutionPermit(
            contract_id="test", revision=1,
            contract_digest="a", precondition_digest="b",
            approval_binding="c",
        )
        permit.consume()
        with pytest.raises(RuntimeError, match="already consumed"):
            permit.consume()

