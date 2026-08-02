"""Targeted tests for opencode_prompts_kernel (integration)."""
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
    AllowedEffect,
    ApprovalState,
    ApprovalStatus,
    Budget,
    Classification,
    ContractState,
    ContractStateMachine,
    Effect,
    Execution,
    ExecutionContract,
    InvariantError,
    Resource,
    ResourceIdentity,
    Reversibility,
    Risk,
    RollbackPlan,
    StateRecord,
    VerificationPlan,
    classify_activity,
    classify_risk,
    compute_contract_digest,
    compute_precondition_digest,
    validate_cross_field_invariants,
    validate_for_execution,
)

class TestIntegration:
    """End-to-end scenario tests combining multiple kernel components."""

    def test_observe_contract_full_lifecycle(self):
        """OBSERVE contract: build → validate → approve → execute → record."""
        # Build
        contract = ExecutionContract(
            contract_id="observe-lifecycle",
            revision=1,
            state="FROZEN",
            classification=Classification(
                activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
            resources=[Resource(
                id="target", kind="file",
                canonical_locator="/tmp/test.txt",
                identity=ResourceIdentity(content_hash="sha256:abc"),
                allowed_operations=["read", "stat"],
            )],
            execution=Execution(method="read", operation="read"),
            allowed_effects=[AllowedEffect(resource_id="target", operation="read")],
            verification=VerificationPlan(
                primary_oracle="content_hash",
                postconditions=["content_matches_expected"],
            ),
        )

        # Validate
        errors = validate_cross_field_invariants(contract)
        assert len(errors) == 0

        # Execute (get permit)
        permit = validate_for_execution(contract, {"target_hash": "sha256:abc"}, ApprovalState())
        assert permit.is_valid()

        # Record
        record = StateRecord(
            goal="verify file content",
            contract_id=contract.contract_id,
            contract_revision=contract.revision,
            contract_state="COMPLETED",
            primary_oracle_result="sha256:abc matches expected",
            actual_bytes_written=0,
        )
        js = record.to_json()
        parsed = json.loads(js)
        assert parsed["contract"]["state"] == "COMPLETED"
        assert parsed["effects"]["bytes_written"] == 0

    def test_modify_contract_requires_full_approval(self):
        """MODIFY contract: must have approval + budgets + resources."""
        contract = ExecutionContract(
            contract_id="modify-lifecycle",
            revision=1,
            state="PENDING_APPROVAL",
            classification=Classification(
                activity=Activity.MODIFY, effect=Effect.PERSISTENT_WRITE, risk=Risk.ELEVATED,
                reversibility=Reversibility.REVERSIBLE,
            ),
            resources=[Resource(id="target", canonical_locator="/tmp/test.txt",
                                identity=ResourceIdentity(content_hash="sha256:abc"),
                                allowed_operations=["read", "write"])],
            execution=Execution(method="write", tool="edit", argv=["/tmp/test.txt"]),
            allowed_effects=[AllowedEffect(resource_id="target", operation="write")],
            change_budget=Budget(maximum_modified=1, maximum_bytes_written=100),
            rollback=RollbackPlan(mode="RESTORE", artifacts=["/tmp/test.txt.bak"]),
            approval=ApprovalState(required=True, status=ApprovalStatus.APPROVED,
                                   contract_digest=compute_contract_digest(contract) if False else ""),
        )
        # Must set contract_digest after construction since compute_contract_digest
        # runs on the default contract before our fields are set
        contract.approval.contract_digest = compute_contract_digest(contract)
        contract.approval.precondition_digest = compute_precondition_digest(
            {"target_hash": "sha256:abc"}
        )

        errors = validate_cross_field_invariants(contract)
        assert len(errors) == 0, f"Unexpected errors: {errors}"

    def test_invalid_transition_rejected(self):
        """Ensure invalid state transitions are caught."""
        contract = ExecutionContract(state="DRAFT")
        sm = ContractStateMachine(contract)
        with pytest.raises(InvariantError):
            sm.transition(ContractState.COMPLETED)

    def test_classification_to_execution_pipeline(self):
        """Classify a request → build contract → validate."""
        user_text = "check the owner of C:\\project\\folder"
        activity = classify_activity(user_text)
        assert activity == Activity.OBSERVE

        risk = classify_risk(activity, user_text)
        assert risk == Risk.LOW

        contract = ExecutionContract(
            contract_id="classify-pipeline",
            state="FROZEN",
            classification=Classification(
                activity=activity, effect=Effect.NO_WRITE, risk=risk,
            ),
        )
        errors = validate_cross_field_invariants(contract)
        assert len(errors) == 0

