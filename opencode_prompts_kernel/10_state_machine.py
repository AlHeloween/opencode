"""Kernel fragment: 10_state_machine (former monofile L927-955)."""


class ContractStateMachine:
    """§15 GATE 0-6 — Monotonic forward state machine. No backward transitions."""

    _TRANSITIONS: dict[ContractState, set[ContractState]] = {
        ContractState.DRAFT: {ContractState.FROZEN},
        ContractState.FROZEN: {ContractState.PENDING_APPROVAL, ContractState.EXECUTING},
        ContractState.PENDING_APPROVAL: {ContractState.APPROVED, ContractState.REJECTED},
        ContractState.APPROVED: {ContractState.EXECUTING, ContractState.STALE},
        ContractState.EXECUTING: {ContractState.VERIFYING, ContractState.BLOCKED, ContractState.PARTIAL},
        ContractState.VERIFYING: {
            ContractState.COMPLETED, ContractState.BLOCKED, ContractState.PARTIAL, ContractState.ROLLED_BACK,
        },
    }

    def __init__(self, contract: ExecutionContract):
        self.contract = contract

    def transition(self, to_state: ContractState) -> None:
        current = ContractState(self.contract.state)
        allowed = self._TRANSITIONS.get(current, set())
        if to_state not in allowed:
            raise InvariantError(
                f"Invalid transition: {current.value} -> {to_state.value}. "
                f"Allowed: {[s.value for s in allowed]}"
            )
        self.contract.state = to_state.value


