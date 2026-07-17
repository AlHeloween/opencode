"""
Tests for opencode_prompts_kernel.py — validates all reasoning kernel algorithms
and project specifications are working correctly.

Run: pytest tests/  (from repo root)

Covers: Enums, Information Mark system, Semantic Vectors, Delta functions,
        Contract validation, Digest computation, State machine, Classification,
        Bug Fix Protocol, Execution Permit, Edge-case handlers, State Record,
        Conformance suite, and all project specs (agents, skills, commands, rules).
"""

import pytest
import json
import sys
import os

# Add repo root to path so opencode_prompts_kernel.py is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from opencode_prompts_kernel import (
    # Enums
    Activity, Effect, Risk, Reversibility, DataSensitivity,
    InfoMarkLevel, ContractState, DeltaClass, ApprovalStatus,
    ExecutionMode, Role,

    # Information Mark
    InformationMark, confusion_matrix_validation,
    promote_information_mark, reverse_search,

    # Semantic Vector
    SemanticVector, build_semantic_vector, md5_msg_tag,

    # Delta
    delta_l1, delta_cos, delta_star, classify_delta, DELTA_STABLE, DELTA_SHIFT,

    # Contracts
    Budget, ResourceIdentity, Resource, AllowedEffect,
    Classification, Environment, Execution, RollbackPlan,
    RollbackArtifact, VerificationPlan, ApprovalState,
    DiscoveryContract, ExecutionContract,

    # Digest & Validation
    compute_contract_digest, compute_precondition_digest,
    compute_approval_binding,
    validate_cross_field_invariants, validate_for_execution,
    InvariantError, ContractStateMachine, ExecutionPermit,

    # State Record
    StateRecord,

    # Classification
    classify_activity, classify_risk,

    # Bug Fix
    BugFixProtocol,

    # Handlers
    PreconditionMismatch, handle_target_change,
    handle_rollback_artifact_missing, handle_rollback_concurrent_modification,

    # Example
    example_ownership_inspection,

    # Communication
    CommunicationDirectives,

    # Conformance
    ConformanceTest, build_conformance_suite,

    # Project Specs
    _ALL_SPECS, _validate_spec, _SPEC_FIELDS,

    # Syntax Projection
    SYNTAX_PROJECTION, SYNTAX_FORMATS, TREESITTER_GRAMMARS,
    resolve_syntax, render_field_to_format,

    # Epistemic Projection
    ResearchKernel, ClaimNode, DisciplineProjection,
    EPISTEMIC_NODE_TYPES, QUESTION_TYPES,
    PROJECTION_LIBRARY, select_projection,
    get_projection_names, get_projection_by_name,
    PRECEDENCE, resolve_precedence,
    NATURAL_SCIENCE, PHYSICS, CHEMISTRY, BIOLOGY,
    SOCIAL_SCIENCE, ECONOMICS, PSYCHOLOGY, SOCIOLOGY, HISTORY,

    # Prompt IR Compilation
    RESERVED_PREFIXES, _KERNEL_SYMBOLS, _PROJECTION_PREFIXES,
    PREFIX_RULE, _FIELD_TO_IR,
    compile_to_ir, expand_from_ir, validate_symbols, validate_ir_equivalence,
    get_ir_symbol, find_duplicate_mapping_keys, find_normalized_runtime_rule_duplicates,
    validate_runtime_contracts, validate_runtime_pack_hierarchy, validate_runtime_references,
    validate_runtime_rule_owners, render_runtime_kernel,
    PROMPT_ABI, RUNTIME_CONTRACTS, RUNTIME_PACKS, RUNTIME_RULE_ALIASES, RUNTIME_RULE_OWNERS,
    RUNTIME_RULES, RUNTIME_TERMS, RUNTIME_WORKFLOWS, SPEC_CONTRACT_IDS, _ALL_SPECS,
    runtime_kernel_digest,
)


# ======================================================================
# ENUM TESTS
# ======================================================================

class TestEnums:
    """All 11 enums behave correctly."""

    def test_activity_values(self):
        assert Activity.CONVERSATION.value == "CONVERSATION"
        assert Activity.OBSERVE.value == "OBSERVE"
        assert Activity.EXECUTE_TEST.value == "EXECUTE_TEST"
        assert Activity.MODIFY.value == "MODIFY"

    def test_effect_values(self):
        assert Effect.NO_WRITE.value == "NO_WRITE"
        assert Effect.DECLARED_TEMP_WRITE.value == "DECLARED_TEMP_WRITE"
        assert Effect.PERSISTENT_WRITE.value == "PERSISTENT_WRITE"

    def test_risk_values(self):
        assert Risk.LOW.value == "LOW"
        assert Risk.ELEVATED.value == "ELEVATED"
        assert Risk.DESTRUCTIVE.value == "DESTRUCTIVE"

    def test_reversibility_values(self):
        assert Reversibility.REVERSIBLE.value == "REVERSIBLE"
        assert Reversibility.COMPENSATABLE.value == "COMPENSATABLE"
        assert Reversibility.IRREVERSIBLE.value == "IRREVERSIBLE"

    def test_data_sensitivity_values(self):
        assert DataSensitivity.PUBLIC.value == "PUBLIC"
        assert DataSensitivity.INTERNAL.value == "INTERNAL"
        assert DataSensitivity.CONFIDENTIAL.value == "CONFIDENTIAL"
        assert DataSensitivity.SECRET.value == "SECRET"
        assert DataSensitivity.RESTRICTED.value == "RESTRICTED"

    def test_info_mark_level(self):
        assert InfoMarkLevel.from_accuracy(1.0) == InfoMarkLevel.EXACT
        assert InfoMarkLevel.from_accuracy(0.8) == InfoMarkLevel.INFERRED
        assert InfoMarkLevel.from_accuracy(0.6) == InfoMarkLevel.HYPOTHETICAL
        assert InfoMarkLevel.from_accuracy(0.3) == InfoMarkLevel.GUESS
        assert InfoMarkLevel.from_accuracy(0.1) == InfoMarkLevel.UNKNOWN

    def test_contract_state_monotonic(self):
        """Ensure state forward progression only."""
        assert ContractState.DRAFT.value == "DRAFT"
        assert ContractState.COMPLETED.value == "COMPLETED"

    def test_delta_class_values(self):
        assert DeltaClass.STABLE.value == "Stable"
        assert DeltaClass.SHIFT.value == "Shift"
        assert DeltaClass.DIVERGENCE.value == "Divergence"

    def test_approval_status_values(self):
        assert ApprovalStatus.NOT_REQUIRED.value == "NOT_REQUIRED"
        assert ApprovalStatus.APPROVED.value == "APPROVED"

    def test_execution_mode_values(self):
        assert ExecutionMode.SEQUENTIAL_APPROVE.value == "SEQUENTIAL_APPROVE"
        assert ExecutionMode.BATCH_EXECUTE.value == "BATCH_EXECUTE"

    def test_role_properties(self):
        assert Role.STRATEGIST1.is_human is True
        assert Role.SYNTHESIZER.is_agent is True
        assert Role.APPROVER1.responsibility() == "Reviews and approves ExecutionContracts"
        assert Role.ORACLE2.responsibility() == "Runs primary and secondary verification, reports results"


# ======================================================================
# INFORMATION MARK TESTS
# ======================================================================

class TestInformationMark:
    """§I.2 Information Mark system — epistemic status, promotion, reverse search."""

    def test_normalization(self):
        im = InformationMark(exact=1.0, inferred=1.0, hypothetical=0.0, guess=0.0, unknown=0.0)
        assert abs(im.exact - 0.5) < 0.01
        assert abs(im.inferred - 0.5) < 0.01
        assert im.dominant_level == InfoMarkLevel.EXACT

    def test_zero_does_not_divide(self):
        im = InformationMark()
        assert im.exact == 0.0
        assert im.dominant_level == InfoMarkLevel.UNKNOWN

    def test_dominant_level_inferred(self):
        im = InformationMark(exact=0.1, inferred=0.8, hypothetical=0.1, guess=0.0, unknown=0.0)
        assert im.dominant_level == InfoMarkLevel.INFERRED

    def test_accuracy_exact(self):
        im = InformationMark(exact=1.0, inferred=0.0, hypothetical=0.0, guess=0.0, unknown=0.0)
        assert im.accuracy == 1.0

    def test_accuracy_mixed(self):
        im = InformationMark(exact=0.0, inferred=1.0, hypothetical=0.0, guess=0.0, unknown=0.0)
        assert abs(im.accuracy - 0.75) < 0.01

    def test_with_label(self):
        im = InformationMark(exact=1.0, inferred=0.0, hypothetical=0.0, guess=0.0, unknown=0.0,
                             label="Exact + Verified by oracle")
        assert im.label == "Exact + Verified by oracle"


class TestConfusionMatrix:
    """§I.2 Promotion mechanics — Hypothetical -> Inferred gates."""

    def test_promotion_meets_threshold(self):
        r = confusion_matrix_validation(tp=90, fp=5, tn=80, fn=10)
        assert r["promoted"] is True
        assert r["new_level"] == "Inferred"
        assert r["precision"] >= 0.85
        assert r["f1"] >= 0.8

    def test_no_promotion_below_f1(self):
        r = confusion_matrix_validation(tp=10, fp=20, tn=5, fn=65)
        assert r["promoted"] is False
        assert r["new_level"] == "Hypothetical"

    def test_no_promotion_below_precision(self):
        r = confusion_matrix_validation(tp=30, fp=30, tn=10, fn=10)
        assert r["promoted"] is False
        assert r["precision"] < 0.85

    def test_zero_division_handling(self):
        r = confusion_matrix_validation(tp=0, fp=0, tn=0, fn=0)
        assert r["precision"] == 0.0
        assert r["recall"] == 0.0
        assert r["f1"] == 0.0
        assert r["promoted"] is False


class TestPromoteInformationMark:
    """§I.2 Promotion by mention frequency."""

    def test_exact_ratio(self):
        assert promote_information_mark(0.5) == InfoMarkLevel.EXACT

    def test_inferred_ratio(self):
        assert promote_information_mark(0.35) == InfoMarkLevel.INFERRED

    def test_hypothetical_ratio(self):
        assert promote_information_mark(0.25) == InfoMarkLevel.HYPOTHETICAL

    def test_guess_ratio(self):
        assert promote_information_mark(0.15) == InfoMarkLevel.GUESS

    def test_unknown_ratio(self):
        assert promote_information_mark(0.05) == InfoMarkLevel.UNKNOWN

    def test_boundary_values(self):
        assert promote_information_mark(0.4) == InfoMarkLevel.EXACT
        assert promote_information_mark(0.3) == InfoMarkLevel.INFERRED
        assert promote_information_mark(0.2) == InfoMarkLevel.HYPOTHETICAL
        assert promote_information_mark(0.1) == InfoMarkLevel.GUESS


class TestReverseSearch:
    """§I.2 Reverse search filtering — only Exact + Inferred claims."""

    def test_filters_hypothetical_and_below(self):
        claims = [
            {"level": "Exact", "text": "memory leak fixed in v3", "source": "test output"},
            {"level": "Inferred", "text": "similar leak in v2", "source": "code analysis"},
            {"level": "Hypothetical", "text": "maybe another leak in v1", "source": "speculation"},
            {"level": "Guess", "text": "v0 might be related", "source": "wild guess"},
        ]
        results = reverse_search(claims, "leak")
        assert len(results) == 2
        assert all(r["level"] in ("Exact", "Inferred") for r in results)

    def test_empty_claims(self):
        assert reverse_search([], "test") == []

    def test_case_insensitive(self):
        claims = [{"level": "Exact", "text": "MEMORY LEAK", "source": "test"}]
        results = reverse_search(claims, "memory")
        assert len(results) == 1

    def test_no_match(self):
        claims = [{"level": "Exact", "text": "performance improvement", "source": "test"}]
        results = reverse_search(claims, "leak")
        assert len(results) == 0


# ======================================================================
# SEMANTIC VECTOR TESTS
# ======================================================================

class TestSemanticVector:
    """§III Semantic Vector — keyword weights, canonical string, hashing."""

    def test_normalization(self):
        sv = build_semantic_vector(["a", "b"], [1.0, 3.0])
        assert abs(sum(sv.weights) - 1.0) < 0.01

    def test_canonical_string_sorted_keys(self):
        sv = build_semantic_vector(["z", "a", "m"], [1.0, 2.0, 3.0], dominant="test")
        canonical = sv.canonical_string()
        parts = canonical.split("|")
        assert parts[0] == "dominant=test"
        # Keys sorted: a, m, z
        assert "a:" in parts[1]
        assert "m:" in parts[2]
        assert "z:" in parts[3]

    def test_md5_sv_tag_format(self):
        sv = build_semantic_vector(["key"], [1.0], dominant="dom")
        tag = sv.md5_sv_tag()
        assert isinstance(tag, str)
        assert len(tag) == 32  # MD5 hex
        assert all(c in "0123456789abcdef" for c in tag)

    def test_md5_sv_tag_deterministic(self):
        sv1 = build_semantic_vector(["a"], [1.0], dominant="x")
        sv2 = build_semantic_vector(["a"], [1.0], dominant="x")
        assert sv1.md5_sv_tag() == sv2.md5_sv_tag()

    def test_md5_msg_tag_strips_whitespace(self):
        tag1 = md5_msg_tag("hello world")
        tag2 = md5_msg_tag("hello  world")   # extra space
        tag3 = md5_msg_tag("  hello world ")  # leading/trailing
        assert tag1 == tag2
        assert tag1 == tag3

    def test_md5_msg_tag_strips_newlines(self):
        tag1 = md5_msg_tag("line1\nline2")
        tag2 = md5_msg_tag("line1line2")
        assert tag1 == tag2


class TestDeltaFunctions:
    """§III Delta measurement — L1, cosine, star, classification."""

    def test_delta_l1_range(self):
        d = delta_l1({"a": 0.6, "b": 0.4}, {"a": 0.3, "c": 0.7})
        assert 0.0 < d <= 2.0

    def test_delta_l1_identical(self):
        d = delta_l1({"a": 1.0}, {"a": 1.0})
        assert d == 0.0

    def test_delta_l1_disjoint_keys(self):
        d = delta_l1({"a": 1.0}, {"b": 1.0})
        assert d == 2.0

    def test_delta_cos_identical(self):
        d = delta_cos([0.5, 0.5], [0.5, 0.5])
        assert abs(d) < 0.001

    def test_delta_cos_orthogonal(self):
        d = delta_cos([1.0, 0.0], [0.0, 1.0])
        assert abs(d - 1.0) < 0.001

    def test_delta_cos_opposite(self):
        d = delta_cos([1.0, 0.0], [-1.0, 0.0])
        assert abs(d - 2.0) < 0.001

    def test_delta_cos_dim_mismatch(self):
        with pytest.raises(ValueError, match="Dim mismatch"):
            delta_cos([1.0], [0.5, 0.5])

    def test_delta_cos_zero_vector(self):
        d = delta_cos([0.0, 0.0], [1.0, 0.0])
        assert d == 1.0

    def test_delta_star_composite(self):
        d = delta_star(0.5, 0.3, 0.2, alpha=0.4, beta=0.4, gamma=0.2)
        assert abs(d - (0.4*0.5 + 0.4*0.3 + 0.2*0.2)) < 0.01

    def test_delta_constants(self):
        assert DELTA_STABLE == 0.3
        assert DELTA_SHIFT == 0.6

    def test_classify_stable(self):
        assert classify_delta(0.1) == DeltaClass.STABLE

    def test_classify_shift(self):
        assert classify_delta(0.45) == DeltaClass.SHIFT

    def test_classify_divergence(self):
        assert classify_delta(0.8) == DeltaClass.DIVERGENCE

    def test_classify_boundaries(self):
        assert classify_delta(DELTA_STABLE - 0.001) == DeltaClass.STABLE
        assert classify_delta(DELTA_STABLE + 0.001) == DeltaClass.SHIFT
        assert classify_delta(DELTA_SHIFT - 0.001) == DeltaClass.SHIFT
        assert classify_delta(DELTA_SHIFT + 0.001) == DeltaClass.DIVERGENCE
        # NB: classify_delta(d) uses strict < for each threshold,
        # so at exact thresholds d == 0.3 and d == 0.6, the result
        # is the HIGHER class (SHIFT and DIVERGENCE respectively).


# ======================================================================
# CONTRACT DATA CLASS TESTS
# ======================================================================

class TestBudget:
    def test_defaults(self):
        b = Budget()
        assert b.maximum_created == 0
        assert b.maximum_bytes_written == 0

    def test_custom_values(self):
        b = Budget(maximum_modified=5, maximum_bytes_written=4096)
        assert b.maximum_modified == 5
        assert b.maximum_bytes_written == 4096


class TestResourceIdentity:
    def test_defaults(self):
        rid = ResourceIdentity()
        assert rid.file_id is None

    def test_with_identity(self):
        rid = ResourceIdentity(device="0x80000000", inode=12345, content_hash="sha256:abc", size=2048)
        assert rid.device == "0x80000000"
        assert rid.inode == 12345


class TestResource:
    def test_default_kind(self):
        r = Resource()
        assert r.kind == "file"
        assert r.wildcard_policy == "reject"

    def test_path_escape_detected(self):
        r = Resource(id="bad", canonical_locator="/etc/../etc/passwd", boundary="/safe")
        assert not r.canonical_locator.startswith(r.boundary)


class TestClassification:
    def test_default_conversation(self):
        c = Classification()
        assert c.activity == Activity.CONVERSATION
        assert c.effect == Effect.NO_WRITE
        assert c.risk == Risk.LOW


class TestDiscoveryContract:
    def test_defaults(self):
        dc = DiscoveryContract()
        assert dc.phase == "discovery"
        assert dc.state == "ACTIVE"
        assert "read" in dc.allowed_operations

    def test_to_json(self):
        dc = DiscoveryContract(goal_requested_text="Inspect folder ownership")
        js = dc.to_json()
        parsed = json.loads(js)
        assert parsed["goal"]["requested_text"] == "Inspect folder ownership"


class TestExecutionContract:
    def test_defaults(self):
        ec = ExecutionContract()
        assert ec.phase == "execution"
        assert ec.state == "DRAFT"

    def test_serialization_roundtrip(self):
        ec = ExecutionContract(
            contract_id="test-001",
            revision=1,
            state="FROZEN",
            classification=Classification(
                activity=Activity.OBSERVE, effect=Effect.NO_WRITE, risk=Risk.LOW,
            ),
        )
        js = ec.to_json()
        parsed = json.loads(js)
        assert parsed["contract_id"] == "test-001"
        assert parsed["state"] == "FROZEN"
        assert parsed["classification"]["activity"] == "OBSERVE"

    def test_execution_serialization(self):
        ec = ExecutionContract(
            contract_id="exec-test",
            classification=Classification(activity=Activity.MODIFY, effect=Effect.PERSISTENT_WRITE, risk=Risk.LOW),
            execution=Execution(method="structured_tool", tool="test-tool", operation="write"),
            allowed_effects=[AllowedEffect(resource_id="f", operation="write", maximum_objects=1)],
            change_budget=Budget(maximum_modified=1),
        )
        # Must set approval for MODIFY to serialize cleanly
        ec.approval.required = True
        ec.approval.status = ApprovalStatus.PENDING
        js = ec.to_json()
        parsed = json.loads(js)
        assert parsed["execution"]["method"] == "structured_tool"
        assert parsed["execution"]["tool"] == "test-tool"


# ======================================================================
# DIGEST & APPROVAL BINDING TESTS
# ======================================================================

class TestDigest:
    """§VI Contract digest computation — SHA-256 determinism."""

    def test_contract_digest_deterministic(self):
        c = ExecutionContract(
            contract_id="test-1", revision=1, state="FROZEN",
            classification=Classification(activity=Activity.OBSERVE, effect=Effect.NO_WRITE),
        )
        d1 = compute_contract_digest(c)
        d2 = compute_contract_digest(c)
        assert d1 == d2

    def test_different_contracts_different_digests(self):
        c1 = ExecutionContract(contract_id="a")
        c2 = ExecutionContract(contract_id="b")
        assert compute_contract_digest(c1) != compute_contract_digest(c2)

    def test_revision_change_changes_digest(self):
        c = ExecutionContract(contract_id="test", revision=1)
        d1 = compute_contract_digest(c)
        c.revision = 2
        d2 = compute_contract_digest(c)
        assert d1 != d2

    def test_approval_binding_format(self):
        binding = compute_approval_binding(
            contract_digest="abc123",
            precondition_digest="def456",
            revision=1,
            approval_context_id="session-1",
        )
        assert isinstance(binding, str)
        assert len(binding) == 64  # SHA-256 hex

    def test_precondition_digest(self):
        state = {"file": "/path/to/file", "owner": "user"}
        d = compute_precondition_digest(state)
        assert isinstance(d, str)
        assert len(d) == 64


# ======================================================================
# CONTRACT VALIDATION TESTS
# ======================================================================

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


# ======================================================================
# STATE MACHINE TESTS
# ======================================================================

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


# ======================================================================
# CLASSIFICATION TESTS
# ======================================================================

class TestClassifyActivity:
    """§3.6 Rule-based activity classification from text."""

    @pytest.mark.parametrize("text,expected", [
        ("delete the file", Activity.MODIFY),
        ("change permission", Activity.MODIFY),
        ("create a new folder", Activity.MODIFY),
        ("edit the config", Activity.MODIFY),
        ("install package", Activity.MODIFY),
        ("deploy to production", Activity.MODIFY),
        ("show me the dir", Activity.OBSERVE),
        ("list files", Activity.OBSERVE),
        ("check permission", Activity.OBSERVE),
        ("inspect the folder", Activity.OBSERVE),
        ("read the file", Activity.OBSERVE),
        ("search for errors", Activity.OBSERVE),
        ("run pytest", Activity.EXECUTE_TEST),
        ("run test suite", Activity.EXECUTE_TEST),
        ("build the project", Activity.EXECUTE_TEST),
        ("lint the code", Activity.EXECUTE_TEST),
        ("hello how are you", Activity.CONVERSATION),
        ("what time is it", Activity.CONVERSATION),
        ("tell me a joke", Activity.CONVERSATION),
    ])
    def test_classify(self, text, expected):
        assert classify_activity(text) == expected


class TestClassifyRisk:
    """§3.3 Risk classification from activity + request text."""

    @pytest.mark.parametrize("text,expected", [
        ("delete everything", Risk.DESTRUCTIVE),
        ("remove the file", Risk.DESTRUCTIVE),
        ("force reset", Risk.DESTRUCTIVE),
        ("format the drive", Risk.DESTRUCTIVE),
        ("change permissions", Risk.ELEVATED),
        ("update password", Risk.ELEVATED),
        ("deploy to production", Risk.ELEVATED),
        ("show the file", Risk.LOW),
        ("list directory", Risk.LOW),
        ("read the log", Risk.LOW),
    ])
    def test_risk(self, text, expected):
        activity = classify_activity(text)
        assert classify_risk(activity, text) == expected


# ======================================================================
# BUG FIX PROTOCOL TESTS
# ======================================================================

class TestBugFixProtocol:
    """§XIV Formal 4-step bug fix chain."""

    def test_full_chain(self):
        state = {"bug_exists": True, "error_calls": 0}

        def error_test():
            state["error_calls"] += 1
            return not state["bug_exists"]  # False = bug present

        def trial_fix():
            state["bug_exists"] = False

        def real_fix():
            pass  # Confirms trial fix

        def full_suite():
            return state["error_calls"] >= 2

        protocol = BugFixProtocol("test bug")
        protocol.create_error_test(error_test)
        protocol.create_trial_fix(trial_fix)
        protocol.create_real_fix(real_fix)
        assert protocol.verify(full_suite) is True

    def test_error_test_must_fail(self):
        protocol = BugFixProtocol("test")
        with pytest.raises(InvariantError, match="Error test must reproduce"):
            protocol.create_error_test(lambda: True)  # Returns True = no bug

    def test_skip_error_test(self):
        protocol = BugFixProtocol("test")
        with pytest.raises(InvariantError, match="Must create error test"):
            protocol.create_trial_fix(lambda: None)

    def test_skip_trial_fix(self):
        protocol = BugFixProtocol("test")
        protocol.create_error_test(lambda: False)
        with pytest.raises(InvariantError, match="Must create trial fix"):
            protocol.create_real_fix(lambda: None)

    def test_skip_real_fix(self):
        state = {"bug_exists": True}

        def error_test():
            return not state["bug_exists"]

        def trial_fix():
            state["bug_exists"] = False

        protocol = BugFixProtocol("test")
        protocol.create_error_test(error_test)
        protocol.create_trial_fix(trial_fix)
        with pytest.raises(InvariantError, match="Must create real fix"):
            protocol.verify(lambda: True)


# ======================================================================
# EXECUTION PERMIT TESTS
# ======================================================================

class TestExecutionPermit:
    """§21 Consumable execution permit."""

    def test_created_valid(self):
        permit = ExecutionPermit(
            contract_id="test", revision=1,
            contract_digest="a", precondition_digest="b",
            approval_binding="c",
        )
        assert permit.is_valid()
        assert not permit.consumed

    def test_consume_once(self):
        permit = ExecutionPermit(
            contract_id="test", revision=1,
            contract_digest="a", precondition_digest="b",
            approval_binding="c",
        )
        permit.consume()
        assert not permit.is_valid()
        assert permit.consumed

    def test_double_consume_fails(self):
        permit = ExecutionPermit(
            contract_id="test", revision=1,
            contract_digest="a", precondition_digest="b",
            approval_binding="c",
        )
        permit.consume()
        with pytest.raises(RuntimeError, match="already consumed"):
            permit.consume()


# ======================================================================
# EDGE-CASE HANDLER TESTS
# ======================================================================

class TestEdgeCaseHandlers:
    """§XVI Edge-case handlers — precondition guards."""

    def test_target_change_raises(self):
        with pytest.raises(PreconditionMismatch, match="Target identity changed"):
            handle_target_change(precondition_ok=False)

    def test_target_no_change_passes(self):
        handle_target_change(precondition_ok=True)

    def test_rollback_artifact_missing_raises(self):
        with pytest.raises(RuntimeError, match="Rollback artifact missing"):
            handle_rollback_artifact_missing(artifact_available=False)

    def test_rollback_artifact_available_passes(self):
        handle_rollback_artifact_missing(artifact_available=True)

    def test_rollback_concurrent_mod_fails(self):
        with pytest.raises(PreconditionMismatch, match="changed concurrently"):
            handle_rollback_concurrent_modification(current_matches_expected=False)

    def test_rollback_concurrent_match_passes(self):
        handle_rollback_concurrent_modification(current_matches_expected=True)


# ======================================================================
# STATE RECORD TESTS
# ======================================================================

class TestStateRecord:
    """§XIV.2 / §XV Fixed-format execution report."""

    def test_to_json(self):
        record = StateRecord(
            goal="test goal",
            goal_desc="verify functionality",
            contract_id="test-001",
            contract_revision=1,
            contract_state="COMPLETED",
        )
        js = record.to_json()
        parsed = json.loads(js)
        assert parsed["goal"] == "test goal"
        assert parsed["contract"]["contract_id"] == "test-001"
        assert parsed["contract"]["state"] == "COMPLETED"

    def test_with_information_mark(self):
        im = InformationMark(exact=0.85, inferred=0.15, hypothetical=0.0, guess=0.0, unknown=0.0)
        record = StateRecord(
            goal="ownership change",
            information_mark=im,
            contract_id="oc-001",
            contract_revision=1,
            contract_state="COMPLETED",
            primary_oracle_result="Owner: DOMAIN\\User",
        )
        js = record.to_json()
        parsed = json.loads(js)
        assert abs(parsed["information_mark"]["exact"] - 0.85) < 0.01
        assert parsed["verification"]["primary_oracle"] == "Owner: DOMAIN\\User"

    def test_empty_record(self):
        record = StateRecord()
        js = record.to_json()
        parsed = json.loads(js)
        assert parsed["msg_type"] == "execution_record"
        assert parsed["next"] == ""


# ======================================================================
# EXAMPLE FUNCTION TEST
# ======================================================================

class TestExampleOwnershipInspection:
    """§14 Example — ownership inspection contract construction."""

    def test_contract_builds(self):
        contract = example_ownership_inspection()
        assert contract.contract_id == "ownership-observe-001"
        assert contract.classification.activity == Activity.OBSERVE
        assert contract.state == "FROZEN"

    def test_invariants_pass(self):
        contract = example_ownership_inspection()
        errors = validate_cross_field_invariants(contract)
        assert len(errors) == 0

    def test_serialization(self):
        contract = example_ownership_inspection()
        js = contract.to_json()
        parsed = json.loads(js)
        assert parsed["contract_id"] == "ownership-observe-001"
        assert parsed["classification"]["activity"] == "OBSERVE"


# ======================================================================
# COMMUNICATION DIRECTIVES TESTS
# ======================================================================

class TestCommunicationDirectives:
    """§I Communication protocol rules."""

    def test_defaults(self):
        d = CommunicationDirectives()
        assert d.act_as_expert is True
        assert d.no_apologies is True
        assert d.require_information_mark is True

    def test_detects_apology(self):
        d = CommunicationDirectives(no_apologies=True)
        violations = d.check_violations("I'm sorry, I cannot do that")
        assert len(violations) > 0
        assert any("apolog" in v.lower() for v in violations)

    def test_detects_ai_disclaimer(self):
        d = CommunicationDirectives(no_disclaimers=True)
        violations = d.check_violations("As an AI, I think...")
        assert len(violations) > 0

    def test_clean_text_passes(self):
        d = CommunicationDirectives()
        violations = d.check_violations("Here is the fix for the bug.")
        assert len(violations) == 0


# ======================================================================
# CONFORMANCE SUITE TESTS
# ======================================================================

class TestConformanceSuite:
    """§XVII All 20 conformance tests pass."""

    def test_build_conformance_suite(self):
        suite = build_conformance_suite()
        assert len(suite) == 20

    def test_all_conformance_tests_pass(self):
        suite = build_conformance_suite()
        failures = []
        for test in suite:
            if not test.execute():
                failures.append(test.name)
        assert not failures, f"Conformance failures: {failures}"

    def test_conformance_test_named(self):
        suite = build_conformance_suite()
        names = {t.name for t in suite}
        assert "digest_determinism" in names
        assert "modify_no_write_rejected" in names
        assert "stale_approval_detected" in names
        assert "symlink_swap_detected" in names
        assert "idempotency_prevents_double" in names
        assert "reverse_order_rollback" in names


# ======================================================================
# PROJECT SPEC VALIDATION TESTS
# ======================================================================

class TestProjectSpecs:
    """§P1-P6 All 32 project specifications validate correctly."""

    def test_all_specs_have_required_fields(self):
        for name, spec in _ALL_SPECS.items():
            _validate_spec(name, spec)

    def test_all_specs_loaded(self):
        assert len(_ALL_SPECS) == 32
        assert "CODER" in _ALL_SPECS
        assert "EXPLORER" in _ALL_SPECS
        assert "ORCHESTRATOR" in _ALL_SPECS
        assert "ADM_EXE" in _ALL_SPECS
        assert "GOVERNANCE" in _ALL_SPECS
        assert "DEFAULT_PROMPT" in _ALL_SPECS
        assert "GROUNDING_RULES" in _ALL_SPECS

    def test_spec_field_counts(self):
        """Verify known field counts to catch regression."""
        counts = {
            "CODER": {"constraints": 6, "invariants": 3, "acceptance_tests": 3, "forbidden_actions": 4},
            "ORCHESTRATOR": {"constraints": 4, "invariants": 4, "acceptance_tests": 3, "forbidden_actions": 7},
            "GOVERNANCE": {"constraints": 4, "invariants": 6, "forbidden_actions": 2},
        }
        for name, expected in counts.items():
            spec = _ALL_SPECS[name]
            for field, count in expected.items():
                assert len(spec.get(field, [])) == count, f"{name}.{field} expected {count}"


# ======================================================================
# SYNTAX PROJECTION LAYER TESTS
# ======================================================================

class TestSyntaxProjection:
    """Validate the kernel-to-format syntax projection layer."""

    def test_all_seven_fields_have_projections(self):
        """All 7 spec fields must have entries in SYNTAX_PROJECTION."""
        for field in _SPEC_FIELDS:
            assert field in SYNTAX_PROJECTION, f"Missing projection for field: {field}"

    def test_all_fields_have_kernel_syntax(self):
        """Every projected field must have a 'kernel' entry."""
        for field in _SPEC_FIELDS:
            assert "kernel" in SYNTAX_PROJECTION[field], (
                f"{field} missing kernel syntax template"
            )

    def test_all_fields_have_agent_txt(self):
        """Every projected field must have an '.agent.txt' entry."""
        for field in _SPEC_FIELDS:
            assert ".agent.txt" in SYNTAX_PROJECTION[field], (
                f"{field} missing .agent.txt syntax template"
            )

    def test_all_fields_have_session_txt(self):
        """Every projected field must have an '.session.txt' entry."""
        for field in _SPEC_FIELDS:
            assert ".session.txt" in SYNTAX_PROJECTION[field], (
                f"{field} missing .session.txt syntax template"
            )

    def test_all_fields_have_mdc(self):
        """Every projected field must have an '.mdc' entry."""
        for field in _SPEC_FIELDS:
            assert ".mdc" in SYNTAX_PROJECTION[field], (
                f"{field} missing .mdc syntax template"
            )

    def test_all_fields_have_skill_md(self):
        """Every projected field must have an '.SKILL.md' entry."""
        for field in _SPEC_FIELDS:
            assert ".SKILL.md" in SYNTAX_PROJECTION[field], (
                f"{field} missing .SKILL.md syntax template"
            )

    def test_all_fields_have_agents_md(self):
        """Every projected field must have an 'AGENTS.md' entry."""
        for field in _SPEC_FIELDS:
            assert "AGENTS.md" in SYNTAX_PROJECTION[field], (
                f"{field} missing AGENTS.md syntax template"
            )

    def test_inverse_map_completeness(self):
        """SYNTAX_FORMATS inverse map must contain all formats."""
        expected_formats = {"kernel", ".agent.txt", ".session.txt", ".mdc",
                           ".SKILL.md", "AGENTS.md", ".txt.plan"}
        for fmt in expected_formats:
            assert fmt in SYNTAX_FORMATS, (
                f"Missing format in SYNTAX_FORMATS: {fmt}"
            )

    def test_inverse_map_field_count(self):
        """Each format in SYNTAX_FORMATS must have all 7 fields."""
        # .txt.plan is a minimal format (plan mode only needs intent)
        exempt = {".txt.plan"}
        for fmt, fields in SYNTAX_FORMATS.items():
            if fmt in exempt:
                continue
            missing = _SPEC_FIELDS - set(fields.keys())
            assert not missing, (
                f"Format '{fmt}' missing fields: {missing}"
            )

    def test_tree_sitter_grammars_defined(self):
        """Tree-sitter grammar mapping must have entries for all key formats."""
        required = {".agent.txt", ".session.txt", ".mdc", ".SKILL.md",
                    "AGENTS.md", "kernel", "agent.ts"}
        for fmt in required:
            assert fmt in TREESITTER_GRAMMARS, (
                f"Missing tree-sitter grammar for format: {fmt}"
            )

    def test_grammar_names_valid(self):
        """Tree-sitter grammar names should be known parsers."""
        valid = {"markdown", "yaml", "python", "typescript", "json"}
        for fmt, grammar in TREESITTER_GRAMMARS.items():
            assert grammar in valid, (
                f"Unknown grammar '{grammar}' for format '{fmt}'. "
                f"Valid: {valid}"
            )

    def test_resolve_syntax_found(self):
        """resolve_syntax() returns correct template for known field+format."""
        template = resolve_syntax("intent", ".agent.txt")
        assert template is not None
        assert "intent:" in template

    def test_resolve_syntax_not_found(self):
        """resolve_syntax() returns None for unknown field."""
        assert resolve_syntax("nonexistent_field", ".agent.txt") is None

    def test_resolve_syntax_unknown_format(self):
        """resolve_syntax() returns None for unknown format."""
        assert resolve_syntax("intent", ".unknown.format") is None

    def test_render_field_string(self):
        """render_field_to_format() renders string values."""
        field = "intent"
        value = "Test intent description"
        # Get the .session.txt template
        template = resolve_syntax(field, ".session.txt")
        assert template is not None
        # Should contain value somewhere
        result = render_field_to_format(field, value, ".session.txt")
        assert result is not None
        assert value in result

    def test_render_field_list(self):
        """render_field_to_format() renders list values."""
        result = render_field_to_format("forbidden_actions",
                                         ["no x", "no y", "no z"],
                                         ".session.txt")
        assert result is not None
        assert "- no x" in result
        assert "- no y" in result
        assert "- no z" in result

    def test_render_unknown_field(self):
        """render_field_to_format() returns None for unknown field."""
        result = render_field_to_format("unknown", ["test"], ".session.txt")
        assert result is None

    def test_render_unknown_format(self):
        """render_field_to_format() returns None for unknown format."""
        result = render_field_to_format("intent", "test", ".unknown")
        assert result is None


# ======================================================================
# EPISTEMIC PROJECTION TESTS
# ======================================================================

class TestEpistemicProjection:
    """Validate discipline projection system — research kernel, epistemic nodes,
    discipline projections, and precedence rules."""

    def test_research_kernel_defaults(self):
        """ResearchKernel creates with sensible defaults."""
        rk = ResearchKernel()
        assert rk.question_type == "descriptive"
        assert rk.scope["population"] == ""
        assert rk.ontology["entities"] == []
        assert rk.evidence["sources"] == []
        assert rk.uncertainty["unknowns"] == []
        assert rk.invariants == []
        assert rk.falsifiers == []
        assert rk.acceptance_tests == []
        assert rk.forbidden_actions == []

    def test_research_kernel_custom(self):
        """ResearchKernel accepts custom values."""
        rk = ResearchKernel(
            objective="Test effect of X on Y",
            question_type="causal",
            assumptions=["Linear relationship"],
            falsifiers=["No effect detected"],
        )
        assert rk.objective == "Test effect of X on Y"
        assert rk.question_type == "causal"
        assert rk.assumptions == ["Linear relationship"]
        assert rk.falsifiers == ["No effect detected"]

    def test_research_kernel_invalid_question_type(self):
        """ResearchKernel accepts any string for question_type (no enum yet)."""
        rk = ResearchKernel(question_type="invalid_type")
        assert rk.question_type == "invalid_type"

    def test_epistemic_node_types(self):
        """EPISTEMIC_NODE_TYPES must include all core claim types."""
        required = {"definition", "observation", "measurement", "hypothesis",
                     "causal_claim", "normative_claim", "uncertainty_statement"}
        for node in required:
            assert node in EPISTEMIC_NODE_TYPES, f"Missing epistemic node: {node}"

    def test_question_types(self):
        """QUESTION_TYPES must include all core question types."""
        required = {"descriptive", "comparative", "causal", "predictive",
                     "mechanistic", "normative", "interpretive"}
        for qt in required:
            assert qt in QUESTION_TYPES, f"Missing question type: {qt}"

    def test_claim_node_defaults(self):
        """ClaimNode creates with empty defaults."""
        cn = ClaimNode()
        assert cn.claim_type == ""
        assert cn.subject == ""
        assert cn.source == ""

    def test_claim_node_custom(self):
        """ClaimNode accepts structured claim data."""
        cn = ClaimNode(
            claim_type="causal_claim",
            subject="education",
            relation="affects",
            object="income",
            population="urban adults",
            evidence="panel data",
            identification="fixed effects",
        )
        assert cn.claim_type == "causal_claim"
        assert cn.subject == "education"
        assert cn.identification == "fixed effects"

    def test_nine_projections_loaded(self):
        """PROJECTION_LIBRARY must have all 9 expected projections."""
        assert len(PROJECTION_LIBRARY) == 9
        expected = {"natural_science", "physics", "chemistry", "biology",
                     "social_science", "economics", "psychology", "sociology", "history"}
        assert set(PROJECTION_LIBRARY.keys()) == expected

    def test_each_projection_has_name(self):
        """Every projection has a name and version."""
        for name, proj in PROJECTION_LIBRARY.items():
            assert proj.name == name, f"Projection name mismatch: {proj.name} != {name}"
            assert proj.version == "1.0"

    def test_parent_relationships(self):
        """Sub-disciplines have valid parent references."""
        parent_map = {
            "physics": "natural_science",
            "chemistry": "natural_science",
            "biology": "natural_science",
            "economics": "social_science",
            "psychology": "social_science",
            "sociology": "social_science",
            "history": "social_science",
        }
        for child, expected_parent in parent_map.items():
            proj = PROJECTION_LIBRARY[child]
            assert proj.parent == expected_parent, (
                f"{child}.parent should be {expected_parent}, got {proj.parent}"
            )
            assert expected_parent in PROJECTION_LIBRARY, (
                f"Parent projection {expected_parent} not in library"
            )

    def test_disciplines_have_kernel_projections(self):
        """All discipline projections must have kernel_projection with
        at minimum: invariants and forbidden_actions."""
        for name, proj in PROJECTION_LIBRARY.items():
            kp = proj.kernel_projection or {}
            has_invariants = "invariants" in kp and len(kp["invariants"]) > 0
            has_forbidden = "forbidden_actions" in kp and len(kp["forbidden_actions"]) > 0
            assert has_invariants or has_forbidden, (
                f"{name}: missing invariants and forbidden_actions in kernel_projection"
            )

    def test_select_projection_economics(self):
        """select_projection returns Economics with Social Science parent."""
        projections = select_projection("economics")
        assert len(projections) >= 1
        names = [p.name for p in projections]
        assert "social_science" in names, "Economics should inherit social_science"
        assert "economics" in names

    def test_select_projection_physics(self):
        """select_projection returns Physics with Natural Science parent."""
        projections = select_projection("physics")
        names = [p.name for p in projections]
        assert "natural_science" in names
        assert "physics" in names

    def test_select_projection_unknown(self):
        """select_projection returns empty for unknown discipline."""
        projections = select_projection("unknown_discipline")
        assert len(projections) == 0

    def test_get_projection_names(self):
        """get_projection_names returns all 9 names."""
        names = get_projection_names()
        assert len(names) == 9
        assert "economics" in names
        assert "physics" in names

    def test_get_projection_by_name_found(self):
        """get_projection_by_name returns the correct projection."""
        proj = get_projection_by_name("economics")
        assert proj is not None
        assert proj.name == "economics"
        assert proj.parent == "social_science"

    def test_get_projection_by_name_not_found(self):
        """get_projection_by_name returns None for unknown."""
        assert get_projection_by_name("nonexistent") is None

    def test_get_projection_by_natural_science(self):
        """get_projection_by_name returns natural_science."""
        proj = get_projection_by_name("natural_science")
        assert proj is not None
        assert proj.parent == ""

    def test_precedence_safety(self):
        """Safety precedence: universal_wins."""
        result = resolve_precedence("safety", "universal_rule", "local_rule")
        assert result == "universal_rule"

    def test_precedence_local_style(self):
        """Local style precedence: local_source_wins."""
        result = resolve_precedence("local_style", "universal_rule", "local_rule")
        assert result == "local_rule"

    def test_precedence_method_validity(self):
        """Method validity precedence: method_invariants_win."""
        result = resolve_precedence("method_validity", "universal_rule", "local_rule")
        assert result == "local_rule"

    def test_precedence_unknown_type(self):
        """Unknown rule type defaults to local_source_wins."""
        result = resolve_precedence("unknown_type", "universal_rule", "local_rule")
        assert result == "local_rule"

    @pytest.mark.parametrize(("rule_type", "expected"), [
        ("safety", "universal_rule"),
        ("ethics", "universal_rule"),
        ("local_style", "local_rule"),
        ("measurement_definition", "local_rule"),
        ("factual_claim", "universal_rule | local_rule"),
        ("method_validity", "local_rule"),
    ])
    def test_precedence_modes(self, rule_type, expected):
        """Each declared precedence mode resolves deterministically."""
        assert resolve_precedence(rule_type, "universal_rule", "local_rule") == expected

    def test_economics_native_vocabulary(self):
        """Economics has discipline-specific vocabulary."""
        eco = get_projection_by_name("economics")
        assert eco is not None
        vocab = eco.native_vocabulary or {}
        assert "entity_names" in vocab
        assert "market" in vocab["entity_names"]
        assert "method_names" in vocab
        assert "regression" in vocab["method_names"] or "iv" in vocab["method_names"]

    def test_history_has_evidence_hierarchy(self):
        """History has a specific evidence hierarchy (no experiments)."""
        hist = get_projection_by_name("history")
        assert hist is not None
        hierarchy = hist.evidence_hierarchy or []
        assert len(hierarchy) > 0
        assert hierarchy[0] == "authenticated_primary_evidence"

    def test_natural_science_invariants(self):
        """Natural science has units and dimensional analysis invariants."""
        ns = get_projection_by_name("natural_science")
        assert ns is not None
        inv = ns.kernel_projection.get("invariants", [])
        has_units = any("units" in i.lower() for i in inv)
        has_dimensional = any("dimensional" in i.lower() for i in inv)
        assert has_units, "Natural science must have units invariant"
        assert has_dimensional, "Natural science must have dimensional consistency invariant"


# ======================================================================
# PROMPT IR COMPILATION TESTS
# ======================================================================

class TestPromptIR:
    """Validate immutable namespace prefix IR compilation system."""

    def test_kernel_symbols_count(self):
        """_KERNEL_SYMBOLS has 10 entries."""
        assert len(_KERNEL_SYMBOLS) == 10

    def test_kernel_symbols_immutable(self):
        """_KERNEL_SYMBOLS should raise TypeError on mutation attempt."""
        with pytest.raises(TypeError):
            _KERNEL_SYMBOLS["_k_new"] = "new_field"  # type: ignore

    def test_all_prefixes_in_rule(self):
        """Every reserved prefix has a rule entry."""
        for prefix in RESERVED_PREFIXES:
            assert prefix in PREFIX_RULE, f"Missing prefix rule: {prefix}"

    def test_prefix_rules_not_mutable(self):
        """All prefix rules mark mutable=False."""
        for prefix, rule in PREFIX_RULE.items():
            assert rule["mutable"] is False, f"{prefix} marked as mutable"
            assert rule["redefinable"] is False, f"{prefix} marked as redefinable"

    def test_compile_to_ir_converts_invariants(self):
        """compile_to_ir converts 'invariants' to '_k_inv'."""
        result = compile_to_ir({"invariants": ["must balance"]})
        assert "_k_inv" in result
        assert result["_k_inv"] == ["must balance"]
        assert "invariants" not in result

    def test_compile_to_ir_converts_all_kernel_fields(self):
        """compile_to_ir converts all known kernel field names."""
        readable = {
            "objective": "test",
            "scope": "global",
            "constraints": ["c1"],
            "steps": ["s1"],
            "invariants": ["i1"],
            "evidence": ["e1"],
            "uncertainty": {"type": "sampling"},
            "falsifiers": ["f1"],
            "acceptance_tests": ["a1"],
            "forbidden_actions": ["b1"],
        }
        ir = compile_to_ir(readable)
        for ir_key in _KERNEL_SYMBOLS:
            assert ir_key in ir, f"Missing IR key: {ir_key}"

    def test_compile_to_ir_preserves_non_kernel_keys(self):
        """Non-kernel keys pass through unchanged."""
        result = compile_to_ir({"custom_key": "custom_value"})
        assert result["custom_key"] == "custom_value"

    def test_expand_from_ir_reverses_compile(self):
        """expand_from_ir reverses compile_to_ir."""
        original = {"invariants": ["must balance"], "constraints": ["must be safe"]}
        ir = compile_to_ir(original)
        expanded = expand_from_ir(ir)
        assert expanded == original

    def test_compile_expand_roundtrip_preserves_non_kernel(self):
        """Non-kernel keys survive compile→expand roundtrip."""
        original = {"language": "python", "version": "3.13"}
        ir = compile_to_ir(original)
        expanded = expand_from_ir(ir)
        assert expanded == original

    def test_validate_symbols_accepts_good_spec(self):
        """validate_symbols returns no errors for valid spec with matching values."""
        # Use canonical values that match _KERNEL_SYMBOLS
        spec = {"_k_inv": "invariants", "_k_obj": "objective"}
        errors = validate_symbols(spec, dict(_KERNEL_SYMBOLS))
        assert len(errors) == 0

    def test_validate_symbols_rejects_unknown(self):
        """validate_symbols rejects unknown reserved symbols."""
        spec = {"_k_unknown": "value"}
        errors = validate_symbols(spec, dict(_KERNEL_SYMBOLS))
        assert len(errors) > 0
        assert any("Unknown reserved" in e for e in errors)

    def test_validate_symbols_rejects_redefinition(self):
        """validate_symbols rejects redefinition of canonical symbols."""
        spec = {"_k_inv": "wrong_value"}
        canonical = {"_k_inv": "correct_value"}
        errors = validate_symbols(spec, canonical)
        assert len(errors) > 0
        assert any("redefined" in e for e in errors)

    def test_validate_ir_equivalence_pass(self):
        """Equivalent readable and IR pass validation."""
        readable = {"invariants": ["must balance"]}
        ir = compile_to_ir(readable)
        errors = validate_ir_equivalence(readable, ir)
        assert len(errors) == 0

    def test_validate_ir_equivalence_fail_on_mismatch(self):
        """Mismatched readable and IR fail validation."""
        readable = {"invariants": ["must balance"]}
        ir = {"_k_inv": ["different value"]}
        errors = validate_ir_equivalence(readable, ir)
        assert len(errors) > 0

    def test_projection_prefixes_immutable(self):
        """_PROJECTION_PREFIXES should raise TypeError on mutation."""
        with pytest.raises(TypeError):
            _PROJECTION_PREFIXES["new_ns"] = "_new_"

    def test_reserved_prefixes_in_symbols(self):
        """Every _k_* symbol in RESERVED_PREFIXES is in _KERNEL_SYMBOLS."""
        for key in _KERNEL_SYMBOLS:
            assert any(key.startswith(p) for p in RESERVED_PREFIXES), (
                f"{key} doesn't match any reserved prefix"
            )

    def test_field_to_ir_mapping(self):
        """_FIELD_TO_IR maps readable names to IR symbols."""
        assert _FIELD_TO_IR["invariants"] == "_k_inv"
        assert _FIELD_TO_IR["constraints"] == "_k_cst"
        assert _FIELD_TO_IR["forbidden_actions"] == "_k_ban"

    def test_compile_preserves_list_order(self):
        """IR compilation preserves list item order."""
        steps = ["inspect", "diagnose", "patch", "verify"]
        ir = compile_to_ir({"steps": steps})
        assert ir["_k_seq"] == steps

    def test_compile_empty_dict(self):
        """Compiling empty dict returns empty dict."""
        assert compile_to_ir({}) == {}

    def test_expand_empty_dict(self):
        """Expanding empty dict returns empty dict."""
        assert expand_from_ir({}) == {}

    def test_validate_symbols_empty(self):
        """validate_symbols on empty dict returns no errors."""
        assert validate_symbols({}) == []

    def test_validate_ir_equivalence_empty(self):
        """Empty readable and IR pass equivalence."""
        assert validate_ir_equivalence({}, {}) == []


class TestRuntimePromptCompiler:
    """Validate the compact Pythonic runtime dictionary."""

    def test_runtime_kernel_is_deterministic(self):
        first = render_runtime_kernel()
        assert first == render_runtime_kernel()
        assert runtime_kernel_digest()
        assert "\r" not in first

    def test_runtime_kernel_artifact_matches_generator(self):
        artifact = os.path.join(
            os.path.dirname(__file__), "..", "packages", "opencode", "src", "session", "prompt", "opencode_prompts_kernel.txt"
        )
        with open(artifact, encoding="utf-8", newline="") as generated:
            assert generated.read() == render_runtime_kernel()

    def test_runtime_kernel_contains_roots_not_source_only_harness(self):
        runtime = render_runtime_kernel()
        for root in ("PROMPT_ABI", "TERMS", "RULES", "WORKFLOWS", "PACKS", "CONTRACTS"):
            assert root in runtime
        # Source-only symbols must not appear in the Python dictionary section
        # (before the # SPECS marker), but spec names intentionally appear in
        # the rendered SPECS section as ## headers.
        dict_section = runtime.split("# SPECS")[0] if "# SPECS" in runtime else runtime
        for source_only in ("_ALL_SPECS", "DisciplineProjection", "run_conformance"):
            assert source_only not in dict_section

    def test_canonical_source_has_no_duplicate_literal_mapping_keys(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "opencode_prompts_kernel.py"), encoding="utf-8") as source:
            assert find_duplicate_mapping_keys(source.read()) == []

    def test_runtime_rules_have_no_unaliased_normalized_duplicates(self):
        rules = {**RUNTIME_TERMS, **RUNTIME_RULES}
        assert find_normalized_runtime_rule_duplicates(rules, RUNTIME_RULE_ALIASES) == []

    def test_normalized_duplicate_requires_explicit_alias(self):
        rules = {
            "EVIDENCE.ORDER": "Verified reference outranks inference.",
            "EVIDENCE.COPY": " verified-reference outranks inference ",
        }
        assert find_normalized_runtime_rule_duplicates(rules, {})
        assert find_normalized_runtime_rule_duplicates(rules, {"EVIDENCE.COPY": "EVIDENCE.ORDER"}) == []

    def test_normalized_duplicate_output_is_input_order_independent(self):
        first = {
            "B.CANONICAL": "Beta rule.",
            "B.COPY": "beta-rule",
            "A.CANONICAL": "Alpha rule.",
            "A.COPY": "alpha-rule",
        }
        second = dict(reversed(list(first.items())))
        assert find_normalized_runtime_rule_duplicates(first, {}) == find_normalized_runtime_rule_duplicates(second, {})

    def test_runtime_references_resolve_and_reach_every_term(self):
        assert validate_runtime_references(RUNTIME_TERMS, RUNTIME_RULES, RUNTIME_WORKFLOWS, RUNTIME_PACKS) == []

    def test_runtime_rule_ownership_is_complete_and_resolves(self):
        assert validate_runtime_rule_owners(RUNTIME_RULES, RUNTIME_RULE_OWNERS, RUNTIME_TERMS) == []

    def test_runtime_contracts_inventory_every_canonical_spec(self):
        assert validate_runtime_contracts(
            RUNTIME_CONTRACTS, SPEC_CONTRACT_IDS, set(_ALL_SPECS), RUNTIME_TERMS, RUNTIME_RULES,
        ) == []

    def test_runtime_pack_hierarchy_is_acyclic(self):
        assert validate_runtime_pack_hierarchy(RUNTIME_PACKS) == []

    def test_runtime_science_packs_reference_their_explicit_parents(self):
        assert RUNTIME_PACKS["domain.physics"] == ("domain.natural_science",)
        assert RUNTIME_PACKS["domain.chemistry"] == ("domain.natural_science",)
        assert RUNTIME_PACKS["domain.biology"] == ("domain.natural_science",)
        for discipline in ("economics", "psychology", "sociology", "history"):
            assert RUNTIME_PACKS[f"domain.{discipline}"] == ("domain.social_science",)

    def test_agent_prompt_files_reference_generated_contract_ids(self):
        prompts = {
            "coder.txt": "agent.coder", "compaction.txt": "agent.compaction", "explore.txt": "agent.explore",
            "general.txt": "agent.general", "media.txt": "agent.media", "orchestrator.txt": "agent.orchestrator",
            "researcher.txt": "agent.researcher", "summary.txt": "agent.summary", "title.txt": "agent.title",
        }
        prompt_dir = os.path.join(os.path.dirname(__file__), "..", "packages", "opencode", "src", "agent", "prompt")
        for filename, contract in prompts.items():
            with open(os.path.join(prompt_dir, filename), encoding="utf-8") as prompt:
                content = prompt.read()
            assert f'CONTRACT = CONTRACTS["{contract}"]' in content
            assert f'PACK = PACKS["{contract}"]' in content
            assert "from opencode_prompts_kernel import" not in content

    def test_runtime_reference_validator_reports_unknown_and_unreachable_entries(self):
        errors = validate_runtime_references(
            {"term": "defined", "orphan": "unreachable"},
            {"RULE": "defined", "ORPHAN.RULE": "unreachable"},
            {"workflow": ("term", "unknown"), "orphan_workflow": ("term",)},
            {"pack": ("workflow", "RULE", "unknown-pack")},
        )
        assert errors == [
            "declaration 'ORPHAN.RULE' is not reachable from a workflow or pack",
            "declaration 'orphan' is not reachable from a workflow or pack",
            "pack 'pack' references unknown declaration, workflow, or pack 'unknown-pack'",
            "workflow 'orphan_workflow' is not reachable from a pack",
            "workflow 'workflow' references unknown declaration 'unknown'",
        ]

    def test_runtime_reference_validator_rejects_duplicate_references(self):
        errors = validate_runtime_references(
            {"term": "defined"},
            {"RULE": "defined"},
            {"workflow": ("term", "term", "RULE", "RULE")},
            {"pack": ("workflow", "workflow")},
        )
        assert errors == [
            "pack 'pack' references 'workflow' more than once",
            "workflow 'workflow' references 'RULE' more than once",
            "workflow 'workflow' references 'term' more than once",
        ]

    def test_runtime_pack_hierarchy_rejects_cycles(self):
        packs = {"first": ("second",), "second": ("first",)}
        assert validate_runtime_pack_hierarchy(packs) == [
            "pack hierarchy cycle: first -> second -> first",
            "pack hierarchy cycle: second -> first -> second",
        ]

    def test_prompt_abi_precedence_is_safety_first(self):
        """Global policy order: safety > governance > task > domain > style."""
        assert PROMPT_ABI["precedence"] == ("safety", "governance", "task", "domain", "style")
        assert PROMPT_ABI["version"] == "4"
        assert PROMPT_ABI["line_endings"] == "LF"

    def test_discipline_packs_form_universal_to_domain_hierarchy(self):
        """universal → natural/social science → discipline packs."""
        assert RUNTIME_PACKS["domain.natural_science"][0] == "universal"
        assert RUNTIME_PACKS["domain.social_science"][0] == "universal"
        assert RUNTIME_PACKS["domain.physics"] == ("domain.natural_science",)
        assert RUNTIME_PACKS["domain.economics"] == ("domain.social_science",)
        # Parent chain reaches universal without cycles
        assert validate_runtime_pack_hierarchy(RUNTIME_PACKS) == []

    def test_contracts_only_reference_shared_keyword_vocabulary(self):
        """Agent/tool contracts compile through TERMS/RULES IDs only."""
        allowed = set(RUNTIME_TERMS) | set(RUNTIME_RULES)
        for contract, refs in RUNTIME_CONTRACTS.items():
            for ref in refs:
                assert ref in allowed, f"{contract} references non-keyword {ref!r}"

    def test_projection_precedence_safety_universal_wins(self):
        from opencode_prompts_kernel import resolve_precedence
        assert resolve_precedence("safety", "UNIVERSAL_SAFETY", "LOCAL_OVERRIDE") == "UNIVERSAL_SAFETY"
        assert resolve_precedence("local_style", "UNIVERSAL_STYLE", "LOCAL_STYLE") == "LOCAL_STYLE"

    def test_runtime_kernel_size_report(self):
        """Dictionary section stays compact; full artifact includes SPECS."""
        runtime = render_runtime_kernel()
        dict_section = runtime.split("# SPECS")[0]
        assert len(dict_section) < 12_000
        assert len(runtime) < 80_000
        assert "PROMPT_ABI" in dict_section
        assert "CONTRACTS" in dict_section


# ======================================================================
# INTEGRATION TESTS
# ======================================================================

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
            md5_msg_tag=md5_msg_tag("Read complete"),
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


# ======================================================================
# RUN DIRECTLY
# ======================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
