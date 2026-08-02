"""Targeted tests for opencode_prompts_kernel (digest)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    Activity,
    Classification,
    Effect,
    Execution,
    ExecutionContract,
    compute_approval_binding,
    compute_contract_digest,
    compute_precondition_digest,
)

class TestDigest:
    """§VI Contract digest computation — SHA-256 determinism."""

    def test_contract_digest_deterministic(self):
        c = ExecutionContract(
            contract_id="test-1", revision=1, state="FROZEN",
            classification=Classification(activity=Activity.OBSERVE, effect=Effect.NO_WRITE),
        )
        d1 = compute_contract_digest(c)
        d2 = compute_contract_digest(c)
        assert d1 == d2

    def test_different_contracts_different_digests(self):
        c1 = ExecutionContract(contract_id="a")
        c2 = ExecutionContract(contract_id="b")
        assert compute_contract_digest(c1) != compute_contract_digest(c2)

    def test_revision_change_changes_digest(self):
        c = ExecutionContract(contract_id="test", revision=1)
        d1 = compute_contract_digest(c)
        c.revision = 2
        d2 = compute_contract_digest(c)
        assert d1 != d2

    def test_approval_binding_format(self):
        binding = compute_approval_binding(
            contract_digest="abc123",
            precondition_digest="def456",
            revision=1,
            approval_context_id="session-1",
        )
        assert isinstance(binding, str)
        assert len(binding) == 64  # SHA-256 hex

    def test_precondition_digest(self):
        state = {"file": "/path/to/file", "owner": "user"}
        d = compute_precondition_digest(state)
        assert isinstance(d, str)
        assert len(d) == 64

