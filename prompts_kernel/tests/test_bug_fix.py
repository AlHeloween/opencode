"""Targeted tests for prompts_kernel (bug fix)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    BugFixProtocol, InvariantError,
)

class TestBugFixProtocol:
    """§XIV Formal 4-step bug fix chain."""

    def test_full_chain(self):
        state = {"bug_exists": True, "error_calls": 0}

        def error_test():
            state["error_calls"] += 1
            return not state["bug_exists"]  # False = bug present

        def trial_fix():
            state["bug_exists"] = False

        def real_fix():
            pass  # Confirms trial fix

        def full_suite():
            return state["error_calls"] >= 2

        protocol = BugFixProtocol("test bug")
        protocol.create_error_test(error_test)
        protocol.create_trial_fix(trial_fix)
        protocol.create_real_fix(real_fix)
        assert protocol.verify(full_suite) is True

    def test_error_test_must_fail(self):
        protocol = BugFixProtocol("test")
        with pytest.raises(InvariantError, match="Error test must reproduce"):
            protocol.create_error_test(lambda: True)  # Returns True = no bug

    def test_skip_error_test(self):
        protocol = BugFixProtocol("test")
        with pytest.raises(InvariantError, match="Must create error test"):
            protocol.create_trial_fix(lambda: None)

    def test_skip_trial_fix(self):
        protocol = BugFixProtocol("test")
        protocol.create_error_test(lambda: False)
        with pytest.raises(InvariantError, match="Must create trial fix"):
            protocol.create_real_fix(lambda: None)

    def test_skip_real_fix(self):
        state = {"bug_exists": True}

        def error_test():
            return not state["bug_exists"]

        def trial_fix():
            state["bug_exists"] = False

        protocol = BugFixProtocol("test")
        protocol.create_error_test(error_test)
        protocol.create_trial_fix(trial_fix)
        with pytest.raises(InvariantError, match="Must create real fix"):
            protocol.verify(lambda: True)

