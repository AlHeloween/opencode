"""Targeted tests for prompts_kernel (state record)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    EpistemicStatus, StateRecord,
)

class TestStateRecord:
    """§XIV.2 / §XV Fixed-format execution report."""

    def test_to_json(self):
        record = StateRecord(
            goal="test goal",
            goal_desc="verify functionality",
            contract_id="test-001",
            contract_revision=1,
            contract_state="COMPLETED",
        )
        js = record.to_json()
        parsed = json.loads(js)
        assert parsed["goal"] == "test goal"
        assert parsed["contract"]["contract_id"] == "test-001"
        assert parsed["contract"]["state"] == "COMPLETED"

    def test_with_information_mark(self):
        record = StateRecord(
            goal="ownership change",
            information_mark=EpistemicStatus("Exact"),
            contract_id="oc-001",
            contract_revision=1,
            contract_state="COMPLETED",
            primary_oracle_result="Owner: DOMAIN\\User",
        )
        js = record.to_json()
        parsed = json.loads(js)
        assert parsed["information_mark"] == "Exact"
        assert parsed["verification"]["primary_oracle"] == "Owner: DOMAIN\\User"

    def test_empty_record(self):
        record = StateRecord()
        js = record.to_json()
        parsed = json.loads(js)
        assert parsed["msg_type"] == "execution_record"
        assert parsed["next"] == ""

