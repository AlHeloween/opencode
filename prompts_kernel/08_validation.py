"""Kernel fragment: 08_validation (former monofile L772-863)."""


def validate_cross_field_invariants(contract: ExecutionContract) -> list[str]:
    """§5.3 Enforce all cross-field invariants. Returns list of violations (empty = pass)."""
    errors: list[str] = []
    c = contract

    # 1. CONVERSATION
    if c.classification.activity == Activity.CONVERSATION:
        if c.classification.effect != Effect.NO_WRITE:
            errors.append("CONVERSATION must have NO_WRITE effect")
        if c.execution.method != "none":
            errors.append("CONVERSATION must have execution method 'none'")
        if c.change_budget.maximum_created != 0:
            errors.append("CONVERSATION must have zero create budget")
        if c.change_budget.maximum_bytes_written != 0:
            errors.append("CONVERSATION must have zero write budget")

    # 2. OBSERVE
    if c.classification.activity == Activity.OBSERVE:
        if c.classification.effect != Effect.NO_WRITE:
            errors.append("OBSERVE must have NO_WRITE effect")
        for field_name in ("maximum_created", "maximum_modified", "maximum_deleted", "maximum_bytes_written"):
            if getattr(c.change_budget, field_name) != 0:
                errors.append(f"OBSERVE must have zero {field_name.replace('maximum_', '')} budget")

    # 3. EXECUTE_TEST
    if c.classification.activity == Activity.EXECUTE_TEST:
        if c.classification.effect not in (Effect.NO_WRITE, Effect.DECLARED_TEMP_WRITE):
            errors.append("EXECUTE_TEST must have NO_WRITE or DECLARED_TEMP_WRITE effect")
        # Resource-level: persistent resources must be read-only unless contract is MODIFY
        for r in c.resources:
            if r.id not in ("test_temp", "temp", "work_temp") and any(
                op in r.allowed_operations
                for op in ("create", "write", "delete", "replace", "append")
            ):
                if c.classification.effect != Effect.PERSISTENT_WRITE:
                    errors.append(
                        f"EXECUTE_TEST: persistent resource '{r.id}' must be read-only "
                        "unless contract is MODIFY"
                    )

    # 4. MODIFY
    if c.classification.activity == Activity.MODIFY:
        if c.classification.effect != Effect.PERSISTENT_WRITE:
            errors.append("MODIFY must have PERSISTENT_WRITE effect")
        if not c.approval.required:
            errors.append("MODIFY requires approval.required = True")
        if c.approval.status not in (ApprovalStatus.APPROVED, ApprovalStatus.PENDING):
            errors.append("MODIFY requires approval.status = APPROVED or PENDING")
        if not c.allowed_effects:
            errors.append("MODIFY must have at least one allowed_effect")
        # Allowed-effect resource IDs must exist in declared resources
        for ae in c.allowed_effects:
            if ae.operation in ("create", "write", "replace", "delete", "chmod", "chown"):
                if not any(r.id == ae.resource_id for r in c.resources):
                    errors.append(
                        f"MODIFY: allowed_effect resource '{ae.resource_id}' not in resources"
                    )

    # 5. ELEVATED
    if c.classification.risk == Risk.ELEVATED and not c.approval.required:
        errors.append("ELEVATED risk requires approval.required = True")

    # 6. DESTRUCTIVE
    if c.classification.risk == Risk.DESTRUCTIVE and c.classification.reversibility == Reversibility.REVERSIBLE:
        errors.append("DESTRUCTIVE risk cannot have REVERSIBLE reversibility")

    # 7. NO_WRITE effect budgets
    if c.classification.effect == Effect.NO_WRITE:
        if c.change_budget.maximum_created != 0:
            errors.append("NO_WRITE effect must have zero create budget")
        if c.change_budget.maximum_modified != 0:
            errors.append("NO_WRITE effect must have zero modify budget")
        if c.change_budget.maximum_deleted != 0:
            errors.append("NO_WRITE effect must have zero delete budget")
        if c.change_budget.maximum_bytes_written != 0:
            errors.append("NO_WRITE effect must have zero write budget")

    # 8. DECLARED_TEMP_WRITE resource declaration
    if c.classification.effect == Effect.DECLARED_TEMP_WRITE:
        temp_resources = [r for r in c.resources if r.id in ("test_temp", "temp", "work_temp")]
        if not temp_resources:
            errors.append("DECLARED_TEMP_WRITE requires at least one declared temp resource")

    # 9. PERSISTENT_WRITE rollback
    if c.classification.effect == Effect.PERSISTENT_WRITE:
        if c.rollback.mode not in ("RESTORE", "COMPENSATE") and c.classification.risk != Risk.DESTRUCTIVE:
            errors.append("PERSISTENT_WRITE requires rollback.mode = RESTORE or COMPENSATE, or risk = DESTRUCTIVE")

    return errors


