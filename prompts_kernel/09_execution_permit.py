"""Kernel fragment: 09_execution_permit (former monofile L867-923)."""


@dataclass
class ExecutionPermit:
    """§21 Consumable permit tied to exact contract revision."""
    contract_id: str
    revision: int
    contract_digest: str
    precondition_digest: str
    approval_binding: str
    issued_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    consumed: bool = False

    def is_valid(self) -> bool:
        return not self.consumed

    def consume(self) -> None:
        if self.consumed:
            raise RuntimeError(f"ExecutionPermit {self.contract_id} r{self.revision} already consumed")
        self.consumed = True


def validate_for_execution(contract: ExecutionContract, current_state: dict[str, Any],
                           approval: ApprovalState,
                           envelope: ExecutionEnvelope | None = None) -> ExecutionPermit:
    """Validate contract against current state and approval. Returns permit or raises.

    v6 Execution Envelope model (resolves Gate 4 vs action_class contradiction):
      - MODIFY within an approved envelope → pre-approved (no explicit APPROVED needed)
      - MODIFY outside envelope → requires explicit APPROVED
      - SELF_MODIFY → ALWAYS requires explicit APPROVED (separate permission boundary)
      - PROMOTE_STABLE → ALWAYS requires explicit user approval

    The envelope is approved ONCE by the user. Within its scope+budget, the agent
    can freely experiment. Re-approval is only needed when expanding scope or
    promoting to stable.
    """
    if not contract.contract_id:
        raise InvariantError("Contract missing contract_id")
    errors = validate_cross_field_invariants(contract)
    if errors:
        raise InvariantError(f"Invariant violations: {'; '.join(errors)}")
    if contract.state not in ("FROZEN", "APPROVED"):
        raise InvariantError(f"Contract state must be FROZEN or APPROVED, got {contract.state}")

    contract_digest = compute_contract_digest(contract)
    precondition_digest = compute_precondition_digest(current_state)

    activity = contract.classification.activity

    # SELF_MODIFY: ALWAYS requires explicit approval — separate permission boundary.
    # Component cannot change itself, its oracle, AND its promotion criteria.
    if activity == Activity.SELF_MODIFY:
        if approval.status != ApprovalStatus.APPROVED:
            raise InvariantError(
                f"SELF_MODIFY requires explicit APPROVED status, got {approval.status}. "
                f"Components cannot modify themselves, their oracles, AND their promotion "
                f"criteria in a single mutation. Use a separate candidate branch + "
                f"sealed holdout + regression oracle."
            )

    # MODIFY within envelope: pre-approved by envelope scope+budget.
    # This resolves the Gate 4 (approval for any MODIFY) vs action_class
    # (approval only for ELEVATED/DESTRUCTIVE) contradiction.
    elif activity == Activity.MODIFY:
        if envelope is not None and envelope.is_valid():
            # Check scope: all resources must be within envelope paths
            for resource in contract.resources:
                if not envelope.contains(resource.requested_locator or resource.canonical_locator):
                    raise InvariantError(
                        f"Resource '{resource.requested_locator}' outside envelope scope. "
                        f"Envelope paths: {envelope.scope_paths}"
                    )
            # Check budget
            if not envelope.within_budget(contract.change_budget):
                raise InvariantError(
                    f"Change budget exceeds envelope limits. "
                    f"Envelope: created≤{envelope.budget.maximum_created}, "
                    f"modified≤{envelope.budget.maximum_modified}"
                )
            # Within envelope — pre-approved. No explicit APPROVED needed.
        else:
            # No envelope or expired — requires explicit approval
            if approval.status != ApprovalStatus.APPROVED:
                raise InvariantError(f"MODIFY requires APPROVED status or valid envelope, got {approval.status}")
            if approval.contract_digest and approval.contract_digest != contract_digest:
                raise InvariantError("Contract digest mismatch")
            if approval.precondition_digest and approval.precondition_digest != precondition_digest:
                raise InvariantError("Precondition digest mismatch")

    write_count = sum(1 for ae in contract.allowed_effects if ae.operation in ("create", "write", "replace", "delete"))
    budget_writes = contract.change_budget.maximum_created + contract.change_budget.maximum_modified
    if write_count > budget_writes:
        raise InvariantError(f"Declared effects ({write_count}) exceed budget ({budget_writes})")

    return ExecutionPermit(
        contract_id=contract.contract_id, revision=contract.revision,
        contract_digest=contract_digest, precondition_digest=precondition_digest,
        approval_binding=compute_approval_binding(
            contract_digest, precondition_digest, contract.revision, approval.approval_context_id,
        ),
    )


