"""Kernel fragment: 16_example (former monofile L1488-1558)."""


def example_ownership_inspection() -> ExecutionContract:
    """Construct an ExecutionContract for read-only ownership inspection.
    Demonstrates OBSERVE classification, resource identity binding,
    environment constraints, and cross-field invariant validation."""

    classification = Classification(
        activity=Activity.OBSERVE,
        effect=Effect.NO_WRITE,
        risk=Risk.LOW,
        reversibility=Reversibility.REVERSIBLE,
        data_sensitivity=DataSensitivity.INTERNAL,
        information_mark=InformationMark(
            exact=0.0, inferred=0.95, hypothetical=0.05,
            guess=0.0, unknown=0.0,
            label="Inferred + Classification derived from request text analysis",
        ),
    )

    resource = Resource(
        id="folder",
        kind="directory",
        requested_locator=r"C:\project\exact-folder",
        canonical_locator=r"C:\project\exact-folder",
        boundary=r"C:\project\exact-folder",
        existence_precondition="must_exist",
        identity=ResourceIdentity(file_id="<observed-Windows-file-ID>"),
        descendant_policy="none",
        wildcard_policy="reject",
        link_policy="reject",
        allowed_operations=["stat"],
        read_scope="metadata",
        data_egress_policy="none",
    )

    env = Environment(
        canonical_working_directory=r"C:\project",
        required_privilege="none",
        network_policy="deny",
        timeout_seconds=60,
        maximum_output_bytes=1_000_000,
    )

    contract = ExecutionContract(
        contract_id="ownership-observe-001",
        revision=1,
        state="FROZEN",
        classification=classification,
        environment=env,
        resources=[resource],
        execution=Execution(
            method="structured_tool",
            tool="<ownership-query-tool>",
            operation="read_owner",
        ),
        allowed_effects=[
            AllowedEffect(resource_id="folder", operation="read", maximum_objects=1)
        ],
        forbidden_effects=["chown", "chmod", "set_acl", "recursive_traversal"],
        information_mark=InformationMark(
            exact=1.0, inferred=0.0, hypothetical=0.0,
            guess=0.0, unknown=0.0,
            label="Exact + Direct contract construction",
        ),
    )

    errors = validate_cross_field_invariants(contract)
    assert not errors, f"Invariant violations: {errors}"
    return contract


