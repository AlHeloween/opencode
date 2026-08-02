"""Targeted tests for opencode_prompts_kernel (handlers)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    PreconditionMismatch,
    handle_rollback_artifact_missing,
    handle_rollback_concurrent_modification,
    handle_target_change,
)

class TestEdgeCaseHandlers:
    """§XVI Edge-case handlers — precondition guards."""

    def test_target_change_raises(self):
        with pytest.raises(PreconditionMismatch, match="Target identity changed"):
            handle_target_change(precondition_ok=False)

    def test_target_no_change_passes(self):
        handle_target_change(precondition_ok=True)

    def test_rollback_artifact_missing_raises(self):
        with pytest.raises(RuntimeError, match="Rollback artifact missing"):
            handle_rollback_artifact_missing(artifact_available=False)

    def test_rollback_artifact_available_passes(self):
        handle_rollback_artifact_missing(artifact_available=True)

    def test_rollback_concurrent_mod_fails(self):
        with pytest.raises(PreconditionMismatch, match="changed concurrently"):
            handle_rollback_concurrent_modification(current_matches_expected=False)

    def test_rollback_concurrent_match_passes(self):
        handle_rollback_concurrent_modification(current_matches_expected=True)

