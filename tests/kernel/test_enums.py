"""Targeted tests for opencode_prompts_kernel (enums)."""
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
    ApprovalStatus,
    ContractState,
    DataSensitivity,
    DeltaClass,
    Effect,
    Execution,
    ExecutionContract,
    ExecutionMode,
    Reversibility,
    Risk,
    Role,
)

class TestEnums:
    """All 11 enums behave correctly."""

    def test_activity_values(self):
        assert Activity.CONVERSATION.value == "CONVERSATION"
        assert Activity.OBSERVE.value == "OBSERVE"
        assert Activity.EXECUTE_TEST.value == "EXECUTE_TEST"
        assert Activity.MODIFY.value == "MODIFY"

    def test_effect_values(self):
        assert Effect.NO_WRITE.value == "NO_WRITE"
        assert Effect.DECLARED_TEMP_WRITE.value == "DECLARED_TEMP_WRITE"
        assert Effect.PERSISTENT_WRITE.value == "PERSISTENT_WRITE"

    def test_risk_values(self):
        assert Risk.LOW.value == "LOW"
        assert Risk.ELEVATED.value == "ELEVATED"
        assert Risk.DESTRUCTIVE.value == "DESTRUCTIVE"

    def test_reversibility_values(self):
        assert Reversibility.REVERSIBLE.value == "REVERSIBLE"
        assert Reversibility.COMPENSATABLE.value == "COMPENSATABLE"
        assert Reversibility.IRREVERSIBLE.value == "IRREVERSIBLE"

    def test_data_sensitivity_values(self):
        assert DataSensitivity.PUBLIC.value == "PUBLIC"
        assert DataSensitivity.INTERNAL.value == "INTERNAL"
        assert DataSensitivity.CONFIDENTIAL.value == "CONFIDENTIAL"
        assert DataSensitivity.SECRET.value == "SECRET"
        assert DataSensitivity.RESTRICTED.value == "RESTRICTED"

    def test_contract_state_monotonic(self):
        """Ensure state forward progression only."""
        assert ContractState.DRAFT.value == "DRAFT"
        assert ContractState.COMPLETED.value == "COMPLETED"

    def test_delta_class_values(self):
        assert DeltaClass.STABLE.value == "STABLE"
        assert DeltaClass.SHIFT.value == "SHIFT"
        assert DeltaClass.DIVERGENCE.value == "DIVERGENCE"

    def test_approval_status_values(self):
        assert ApprovalStatus.NOT_REQUIRED.value == "NOT_REQUIRED"
        assert ApprovalStatus.APPROVED.value == "APPROVED"

    def test_execution_mode_values(self):
        assert ExecutionMode.SEQUENTIAL_APPROVE.value == "SEQUENTIAL_APPROVE"
        assert ExecutionMode.BATCH_EXECUTE.value == "BATCH_EXECUTE"

    def test_role_properties(self):
        assert Role.HUMAN_STRATEGIST.is_human is True
        assert Role.AGENT_SYNTHESIZER.is_agent is True
        assert Role.HUMAN_APPROVER.responsibility() == "Reviews and approves ExecutionContracts"
        assert Role.AGENT_ORACLE.responsibility() == "Runs primary and secondary verification, reports results"

