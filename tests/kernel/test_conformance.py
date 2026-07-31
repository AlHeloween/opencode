"""Targeted tests for opencode_prompts_kernel (conformance)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    build_conformance_suite,
)

class TestConformanceSuite:
    """§XVII All 20 conformance tests pass."""

    def test_external_oracle_ids_are_honest_subset(self):
        from opencode_prompts_kernel import EXTERNAL_ORACLE_TEST_IDS, kernel_closed_test_ids
        suite_ids = {t.name for t in build_conformance_suite()}
        assert EXTERNAL_ORACLE_TEST_IDS <= suite_ids
        closed = kernel_closed_test_ids()
        assert closed.isdisjoint(EXTERNAL_ORACLE_TEST_IDS)
        assert closed | EXTERNAL_ORACLE_TEST_IDS == suite_ids
        assert len(closed) >= 10

    def test_build_conformance_suite(self):
        suite = build_conformance_suite()
        assert len(suite) == 20

    def test_all_conformance_tests_pass(self):
        suite = build_conformance_suite()
        failures = []
        for test in suite:
            if not test.execute():
                failures.append(test.name)
        assert not failures, f"Conformance failures: {failures}"

    def test_conformance_test_named(self):
        suite = build_conformance_suite()
        names = {t.name for t in suite}
        assert "digest_determinism" in names
        assert "modify_no_write_rejected" in names
        assert "stale_approval_detected" in names
        assert "symlink_swap_detected" in names
        assert "idempotency_prevents_double" in names
        assert "reverse_order_rollback" in names

