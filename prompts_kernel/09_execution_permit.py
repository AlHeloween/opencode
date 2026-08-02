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
                           approval: ApprovalState) -> ExecutionPermit:
    """Validate contract against current state and approval. Returns permit or raises."""
    if not contract.contract_id:
        raise InvariantError("Contract missing contract_id")
    errors = validate_cross_field_invariants(contract)
    if errors:
        raise InvariantError(f"Invariant violations: {'; '.join(errors)}")
    if contract.state not in ("FROZEN", "APPROVED"):
        raise InvariantError(f"Contract state must be FROZEN or APPROVED, got {contract.state}")

    contract_digest = compute_contract_digest(contract)
    precondition_digest = compute_precondition_digest(current_state)

    if contract.classification.activity == Activity.MODIFY:
        if approval.status != ApprovalStatus.APPROVED:
            raise InvariantError(f"MODIFY requires APPROVED status, got {approval.status}")
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


