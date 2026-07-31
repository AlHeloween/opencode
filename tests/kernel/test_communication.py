"""Targeted tests for opencode_prompts_kernel (communication)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    CommunicationDirectives,
)

class TestCommunicationDirectives:
    """§I Communication protocol rules."""

    def test_defaults(self):
        d = CommunicationDirectives()
        assert d.act_as_expert is True
        assert d.no_apologies is True
        assert d.require_information_mark is True

    def test_detects_apology(self):
        d = CommunicationDirectives(no_apologies=True)
        violations = d.check_violations("I'm sorry, I cannot do that")
        assert len(violations) > 0
        assert any("apolog" in v.lower() for v in violations)

    def test_detects_ai_disclaimer(self):
        d = CommunicationDirectives(no_disclaimers=True)
        violations = d.check_violations("As an AI, I think...")
        assert len(violations) > 0

    def test_clean_text_passes(self):
        d = CommunicationDirectives()
        violations = d.check_violations("Here is the fix for the bug.")
        assert len(violations) == 0

