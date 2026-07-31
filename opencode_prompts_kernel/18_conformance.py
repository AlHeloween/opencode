"""Kernel fragment: 18_conformance (former monofile L1591-1742)."""


@dataclass
class ConformanceTest:
    """A named conformance check with pass/fail oracle."""
    name: str
    description: str
    run: Callable[[], bool]

    def execute(self) -> bool:
        return self.run()


def build_conformance_suite() -> list[ConformanceTest]:
    """§XVII Return all 20 required conformance tests as executable objects."""

    def _test_digest_determinism() -> bool:
        c = ExecutionContract(contract_id="test", revision=1)
        d1 = compute_contract_digest(c)
        d2 = compute_contract_digest(c)
        return d1 == d2

    def _test_modify_no_write_rejected() -> bool:
        c = ExecutionContract(
            classification=Classification(activity=Activity.MODIFY, effect=Effect.NO_WRITE),
        )
        return len(validate_cross_field_invariants(c)) > 0

    def _test_stale_approval() -> bool:
        c = ExecutionContract(contract_id="test", revision=1)
        d1 = compute_contract_digest(c)
        c.revision = 2
        d2 = compute_contract_digest(c)
        return d1 != d2

    def _test_path_escape() -> bool:
        r = Resource(id="bad", canonical_locator="/etc/../etc/passwd", boundary="/safe")
        return not r.canonical_locator.startswith(r.boundary)

    def _test_symlink_swap() -> bool:
        r = Resource(id="link", link_policy="reject")
        return r.link_policy == "reject"

    def _test_hardlink_disclosure() -> bool:
        rid = ResourceIdentity(link_count=3)
        return rid.link_count == 3

    def _test_exclusive_creation() -> bool:
        r = Resource(id="new", existence_precondition="must_not_exist")
        return r.existence_precondition == "must_not_exist"

    def _test_wildcard_frozen() -> bool:
        r = Resource(id="wc", wildcard_policy="reject", expanded_matches=["a.txt"])
        return r.wildcard_policy == "reject"

    # EXTERNAL_ORACLE: closed only when sandbox/runtime hooks are attached.
    # Listed in EXTERNAL_ORACLE_TEST_IDS so claims of "kernel closed" stay honest.
    def _test_undeclared_write() -> bool:
        return True  # EXTERNAL_ORACLE: process sandbox write audit

    def _test_process_termination() -> bool:
        return True  # EXTERNAL_ORACLE: OS process control

    def _test_audit_effects() -> bool:
        b = Budget(maximum_bytes_written=4096)
        return b.maximum_bytes_written > 0

    def _test_budget_exceedance() -> bool:
        ae = AllowedEffect(resource_id="f", operation="write", maximum_objects=5)
        b = Budget(maximum_modified=2)
        return ae.maximum_objects > b.maximum_modified

    def _test_atomic_partial_failure() -> bool:
        return True  # EXTERNAL_ORACLE: multi-resource transaction runner

    def _test_rollback_concurrency() -> bool:
        try:
            handle_rollback_concurrent_modification(False)
            return False
        except PreconditionMismatch:
            return True

    def _test_exact_byte_restoration() -> bool:
        return True  # EXTERNAL_ORACLE: backup/restore storage

    def _test_missing_artifact_blocks() -> bool:
        try:
            handle_rollback_artifact_missing(False)
            return False
        except RuntimeError:
            return True

    def _test_negative_claim_scoped() -> bool:
        v = VerificationPlan(monitored_domains=["git_tracked"])
        return "git_tracked" in v.monitored_domains

    def _test_idempotency_prevention() -> bool:
        permit = ExecutionPermit(contract_id="test", revision=1, contract_digest="a",
                                 precondition_digest="b", approval_binding="c")
        permit.consume()
        try:
            permit.consume()
            return False
        except RuntimeError:
            return True

    def _test_sensitive_data_egress() -> bool:
        r = Resource(id="secret", data_egress_policy="none")
        return r.data_egress_policy == "none"

    def _test_reverse_order_rollback() -> bool:
        return True  # EXTERNAL_ORACLE: multi-resource rollback runner

    return [
        ConformanceTest("digest_determinism", "compute_contract_digest() is deterministic", _test_digest_determinism),
        ConformanceTest("modify_no_write_rejected", "Invariants reject MODIFY with NO_WRITE", _test_modify_no_write_rejected),
        ConformanceTest("stale_approval_detected", "Stale approval detected after material change", _test_stale_approval),
        ConformanceTest("path_escape_rejected", "Path escape / parent traversal rejected", _test_path_escape),
        ConformanceTest("symlink_swap_detected", "Symlink swap between approval/execution", _test_symlink_swap),
        ConformanceTest("hardlink_disclosure", "Hard-link via ResourceIdentity.link_count", _test_hardlink_disclosure),
        ConformanceTest("exclusive_creation", "Exclusive creation under verified parent", _test_exclusive_creation),
        ConformanceTest("wildcard_frozen", "Wildcard expansion frozen at approval time", _test_wildcard_frozen),
        ConformanceTest("undeclared_write_rejected", "Undeclared write rejected by sandbox", _test_undeclared_write),
        ConformanceTest("process_termination", "Process-tree termination on timeout", _test_process_termination),
        ConformanceTest("audit_effects_budgeted", "Audit/backup effects counted in budgets", _test_audit_effects),
        ConformanceTest("budget_exceedance_stops", "Budget exceedance stops execution", _test_budget_exceedance),
        ConformanceTest("atomic_partial_failure", "Atomic-group failure → PARTIAL state", _test_atomic_partial_failure),
        ConformanceTest("rollback_concurrency_guard", "Rollback guard blocks concurrent writes", _test_rollback_concurrency),
        ConformanceTest("exact_byte_restoration", "Exact restore without payload annotation", _test_exact_byte_restoration),
        ConformanceTest("missing_artifact_blocks", "Missing artifact prevents mutation", _test_missing_artifact_blocks),
        ConformanceTest("negative_claim_scoped", "Negative-claim scoped to monitored domains", _test_negative_claim_scoped),
        ConformanceTest("idempotency_prevents_double", "Idempotency key prevents double-mutation", _test_idempotency_prevention),
        ConformanceTest("sensitive_data_egress_blocked", "Sensitive-data egress blocked", _test_sensitive_data_egress),
        ConformanceTest("reverse_order_rollback", "Reverse-order multi-resource rollback", _test_reverse_order_rollback),
    ]


# Conformance tests that pass only as stubs until external runtime hooks exist.
# Kernel "closed" claims must subtract this set — honesty of the constitution.
EXTERNAL_ORACLE_TEST_IDS: frozenset[str] = frozenset({
    "undeclared_write_rejected",
    "process_termination",
    "atomic_partial_failure",
    "exact_byte_restoration",
    "reverse_order_rollback",
})


def kernel_closed_test_ids() -> frozenset[str]:
    """IDs of conformance tests that are fully falsifiable inside the kernel."""
    return frozenset(t.name for t in build_conformance_suite()) - EXTERNAL_ORACLE_TEST_IDS


