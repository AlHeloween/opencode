"""Targeted tests for prompts_kernel (state machine)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    ContractState,
    ContractStateMachine,
    Execution,
    ExecutionContract,
    InvariantError,
)

class TestStateMachine:
    """§15 GATE 0-6 — Contract state machine monotonic progression."""

    def test_draft_to_frozen(self):
        c = ExecutionContract(state="DRAFT")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.FROZEN)
        assert c.state == "FROZEN"

    def test_frozen_to_executing(self):
        c = ExecutionContract(state="FROZEN")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.EXECUTING)
        assert c.state == "EXECUTING"

    def test_frozen_to_pending_approval(self):
        c = ExecutionContract(state="FROZEN")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.PENDING_APPROVAL)
        assert c.state == "PENDING_APPROVAL"

    def test_approval_approve(self):
        c = ExecutionContract(state="PENDING_APPROVAL")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.APPROVED)
        assert c.state == "APPROVED"

    def test_approval_reject(self):
        c = ExecutionContract(state="PENDING_APPROVAL")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.REJECTED)
        assert c.state == "REJECTED"

    def test_executing_to_verifying(self):
        c = ExecutionContract(state="EXECUTING")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.VERIFYING)
        assert c.state == "VERIFYING"

    def test_executing_to_blocked(self):
        c = ExecutionContract(state="EXECUTING")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.BLOCKED)
        assert c.state == "BLOCKED"

    def test_verifying_to_completed(self):
        c = ExecutionContract(state="VERIFYING")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.COMPLETED)
        assert c.state == "COMPLETED"

    def test_verifying_to_rolled_back(self):
        c = ExecutionContract(state="VERIFYING")
        sm = ContractStateMachine(c)
        sm.transition(ContractState.ROLLED_BACK)
        assert c.state == "ROLLED_BACK"

    def test_invalid_transition_raises(self):
        c = ExecutionContract(state="DRAFT")
        sm = ContractStateMachine(c)
        with pytest.raises(InvariantError, match="Invalid transition"):
            sm.transition(ContractState.COMPLETED)

    def test_no_backward_transition(self):
        c = ExecutionContract(state="FROZEN")
        sm = ContractStateMachine(c)
        with pytest.raises(InvariantError, match="Invalid transition"):
            sm.transition(ContractState.DRAFT)

    def test_no_double_transition(self):
        c = ExecutionContract(state="COMPLETED")
        sm = ContractStateMachine(c)
        # COMPLETED has no outgoing edges
        for target in ContractState:
            if target != ContractState.COMPLETED:
                with pytest.raises(InvariantError):
                    sm.transition(target)

    def test_all_valid_transitions(self):
        """Verify every declared transition is valid."""
        valid = [
            ("DRAFT", "FROZEN"),
            ("FROZEN", "PENDING_APPROVAL"),
            ("FROZEN", "EXECUTING"),
            ("PENDING_APPROVAL", "APPROVED"),
            ("PENDING_APPROVAL", "REJECTED"),
            ("APPROVED", "EXECUTING"),
            ("APPROVED", "STALE"),
            ("EXECUTING", "VERIFYING"),
            ("EXECUTING", "BLOCKED"),
            ("EXECUTING", "PARTIAL"),
            ("VERIFYING", "COMPLETED"),
            ("VERIFYING", "BLOCKED"),
            ("VERIFYING", "PARTIAL"),
            ("VERIFYING", "ROLLED_BACK"),
        ]
        for from_state, to_state in valid:
            c = ExecutionContract(state=from_state)
            sm = ContractStateMachine(c)
            sm.transition(ContractState(to_state))
            assert c.state == to_state, f"Failed: {from_state} -> {to_state}"

