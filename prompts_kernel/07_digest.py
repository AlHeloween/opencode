"""Kernel fragment: 07_digest (former monofile L736-768)."""


class InvariantError(Exception):
    """Raised when cross-field or validation invariants are violated."""
    pass


def canonical_material_contract(contract: ExecutionContract) -> str:
    """Normalize material fields to deterministic JSON, excluding runtime state."""
    d = json.loads(contract.to_json())
    for key in ("approval", "md5_msg_tag", "md5_sv_tag", "state"):
        d.pop(key, None)
    return json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_contract_digest(contract: ExecutionContract) -> str:
    """SHA-256 of canonical material contract."""
    return hashlib.sha256(canonical_material_contract(contract).encode("utf-8")).hexdigest()


def compute_precondition_digest(state: dict[str, Any]) -> str:
    """SHA-256 of canonical binding preconditions."""
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def compute_approval_binding(contract_digest: str, precondition_digest: str,
                             revision: int, approval_context_id: str) -> str:
    """SHA256(contract_digest:precondition_digest:revision:context_id)."""
    raw = f"{contract_digest}:{precondition_digest}:{revision}:{approval_context_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


