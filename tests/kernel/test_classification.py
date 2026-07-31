"""Targeted tests for opencode_prompts_kernel (classification)."""
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
    Risk,
    classify_activity,
    classify_risk,
)

class TestClassifyActivity:
    """§3.6 Rule-based activity classification from text."""

    @pytest.mark.parametrize("text,expected", [
        ("delete the file", Activity.MODIFY),
        ("change permission", Activity.MODIFY),
        ("create a new folder", Activity.MODIFY),
        ("edit the config", Activity.MODIFY),
        ("install package", Activity.MODIFY),
        ("deploy to production", Activity.MODIFY),
        ("show me the dir", Activity.OBSERVE),
        ("list files", Activity.OBSERVE),
        ("check permission", Activity.OBSERVE),
        ("inspect the folder", Activity.OBSERVE),
        ("read the file", Activity.OBSERVE),
        ("search for errors", Activity.OBSERVE),
        ("run pytest", Activity.EXECUTE_TEST),
        ("run test suite", Activity.EXECUTE_TEST),
        ("build the project", Activity.EXECUTE_TEST),
        ("lint the code", Activity.EXECUTE_TEST),
        ("hello how are you", Activity.CONVERSATION),
        ("what time is it", Activity.CONVERSATION),
        ("tell me a joke", Activity.CONVERSATION),
    ])
    def test_classify(self, text, expected):
        assert classify_activity(text) == expected


class TestClassifyRisk:
    """§3.3 Risk classification from activity + request text."""

    @pytest.mark.parametrize("text,expected", [
        ("delete everything", Risk.DESTRUCTIVE),
        ("remove the file", Risk.DESTRUCTIVE),
        ("force reset", Risk.DESTRUCTIVE),
        ("format the drive", Risk.DESTRUCTIVE),
        ("change permissions", Risk.ELEVATED),
        ("update password", Risk.ELEVATED),
        ("deploy to production", Risk.ELEVATED),
        ("show the file", Risk.LOW),
        ("list directory", Risk.LOW),
        ("read the log", Risk.LOW),
    ])
    def test_risk(self, text, expected):
        activity = classify_activity(text)
        assert classify_risk(activity, text) == expected

