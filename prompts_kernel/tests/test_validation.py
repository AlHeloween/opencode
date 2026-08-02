"""Targeted tests for prompts_kernel (validation)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    Activity,
    AllowedEffect,
    ApprovalState,
    ApprovalStatus,
    Budget,
    Classification,
    Effect,
    Execution,
    ExecutionContract,
    InvariantError,
    Resource,
    Reversibility,
    Risk,
    validate_cross_field_invariants,
    validate_for_execution,
)

class TestContractValidation:
    """§5.3 Cross-field invariants — type-level constraints."""

    def test_conversation_needs_no_write(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.CONVERSATION, effect=Effect.PERSISTENT_WRITE,
            ),
        )
        errors = validate_cross_field_invariants(c)
        assert any("NO_WRITE" in e for e in errors)

    def test_conversation_no_execution(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.CONVERSATION, effect=Effect.NO_WRITE,
            ),
            execution=Execution(method="argv"),
        )
        errors = validate_cross_field_invariants(c)
        assert any("execution method" in e for e in errors)

    def test_conversation_zero_budgets(self):
        c = ExecutionContract(
            classification=Classification(activity=Activity.CONVERSATION, effect=Effect.NO_WRITE),
            change_budget=Budget(maximum_created=5),
        )
        errors = validate_cross_field_invariants(c)
        assert any("create budget" in e for e in errors)

    def test_observe_zero_budgets(self):
        c = ExecutionContract(
            classification=Classification(activity=Activity.OBSERVE, effect=Effect.NO_WRITE),
        )
        errors = validate_cross_field_invariants(c)
        assert len(errors) == 0

    def test_observe_rejects_write(self):
        c = ExecutionContract(
            classification=Classification(activity=Activity.OBSERVE, effect=Effect.PERSISTENT_WRITE),
        )
        errors = validate_cross_field_invariants(c)
        assert any("NO_WRITE" in e for e in errors)

    def test_execute_test_wrong_effect(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.EXECUTE_TEST, effect=Effect.PERSISTENT_WRITE,
            ),
        )
        errors = validate_cross_field_invariants(c)
        assert any("EXECUTE_TEST" in e for e in errors)

    def test_execute_test_persistent_resource_read_only(self):
        """EXECUTE_TEST: non-temp resources with write ops must be flagged."""
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.EXECUTE_TEST, effect=Effect.NO_WRITE,
            ),
            resources=[Resource(id="src_file", allowed_operations=["write"])],
        )
        errors = validate_cross_field_invariants(c)
        assert any("persistent resource" in e for e in errors)

    def test_modify_needs_persistent_write(self):
        c = ExecutionContract(
            classification=Classification(activity=Activity.MODIFY, effect=Effect.NO_WRITE, risk=Risk.LOW),
            approval=ApprovalState(required=True, status=ApprovalStatus.PENDING),
            allowed_effects=[AllowedEffect(resource_id="f", operation="write")],
            resources=[Resource(id="f")],
        )
        errors = validate_cross_field_invariants(c)
        assert any("PERSISTENT_WRITE" in e for e in errors)

    def test_modify_needs_approval(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.MODIFY, effect=Effect.PERSISTENT_WRITE, risk=Risk.LOW,
            ),
            allowed_effects=[AllowedEffect(resource_id="f", operation="write")],
            resources=[Resource(id="f")],
        )
        errors = validate_cross_field_invariants(c)
        assert any("approval" in e for e in errors)

    def test_modify_resource_cross_reference(self):
        """MODIFY: allowed_effect resource must exist in declared resources."""
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.MODIFY, effect=Effect.PERSISTENT_WRITE, risk=Risk.LOW,
            ),
            approval=ApprovalState(required=True, status=ApprovalStatus.PENDING),
            allowed_effects=[AllowedEffect(resource_id="nonexistent", operation="write")],
            resources=[Resource(id="real_file")],
        )
        errors = validate_cross_field_invariants(c)
        assert any("not in resources" in e for e in errors)

    def test_destructive_not_reversible(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.MODIFY, effect=Effect.PERSISTENT_WRITE,
                risk=Risk.DESTRUCTIVE, reversibility=Reversibility.REVERSIBLE,
            ),
        )
        errors = validate_cross_field_invariants(c)
        assert any("REVERSIBLE" in e for e in errors)

    def test_no_write_effect_budgets(self):
        """NO_WRITE effect must have all write budgets at zero."""
        c = ExecutionContract(
            classification=Classification(activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW),
            change_budget=Budget(maximum_bytes_written=100),
        )
        errors = validate_cross_field_invariants(c)
        # Both OBSERVE zero-budget + NO_WRITE effect checks fire
        assert any("write budget" in e for e in errors)

    def test_declared_temp_write_needs_temp_resource(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.EXECUTE_TEST, effect=Effect.DECLARED_TEMP_WRITE, risk=Risk.LOW,
            ),
            resources=[Resource(id="persistent_file")],
        )
        errors = validate_cross_field_invariants(c)
        assert any("declared temp resource" in e for e in errors)

    def test_valid_execute_test_passes(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.EXECUTE_TEST, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        errors = validate_cross_field_invariants(c)
        assert len(errors) == 0

    def test_valid_observe_passes(self):
        c = ExecutionContract(
            classification=Classification(activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW),
        )
        errors = validate_cross_field_invariants(c)
        assert len(errors) == 0

    def test_valid_conversation_passes(self):
        c = ExecutionContract(
            classification=Classification(
                activity=Activity.CONVERSATION, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        errors = validate_cross_field_invariants(c)
        assert len(errors) == 0


class TestValidateForExecution:
    """§21 Full validation pipeline — contract + state + approval."""

    def test_valid_observe_contract(self):
        c = ExecutionContract(
            contract_id="test-valid",
            state="FROZEN",
            classification=Classification(
                activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        permit = validate_for_execution(c, {"file": "/tmp"}, ApprovalState())
        assert permit.is_valid()

    def test_missing_contract_id(self):
        c = ExecutionContract(contract_id="")
        with pytest.raises(InvariantError, match="missing contract_id"):
            validate_for_execution(c, {}, ApprovalState())

    def test_wrong_state(self):
        c = ExecutionContract(
            contract_id="test", state="DRAFT",
            classification=Classification(
                activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        with pytest.raises(InvariantError, match="must be FROZEN or APPROVED"):
            validate_for_execution(c, {}, ApprovalState())

    def test_permit_consumption(self):
        c = ExecutionContract(
            contract_id="test-permit",
            state="FROZEN",
            classification=Classification(
                activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        permit = validate_for_execution(c, {}, ApprovalState())
        permit.consume()
        assert not permit.is_valid()

    def test_double_consumption_fails(self):
        c = ExecutionContract(
            contract_id="test-double",
            state="FROZEN",
            classification=Classification(
                activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        permit = validate_for_execution(c, {}, ApprovalState())
        permit.consume()
        with pytest.raises(RuntimeError, match="already consumed"):
            permit.consume()

