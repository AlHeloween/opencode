"""Actual G6/G9 consumers reject missing, stale or partial filesystem evidence."""
from copy import deepcopy
from pathlib import Path
import pytest
from prompt_kernel.source import G6_FSM, G9_FSM, KERNEL


def bind(context):
    return G6_FSM.is_valid_transition("RUN_IMPACT", "EMIT_BINDING", context)


def success(context):
    return G9_FSM.is_valid_transition("CHECK_RISKS", "EMIT_SUCCESS", context)


def test_valid_grounding_and_open_aligned_portfolio_are_admissible(evidence_context):
    assert bind(evidence_context)
    assert success(evidence_context)  # open backlog does not mean unaligned backlog


@pytest.mark.parametrize("missing", ["STRUCTURAL_EVIDENCE", "PLAN_STRATEGY"])
def test_g6_missing_required_evidence_cannot_bind(evidence_context, missing):
    evidence_context.pop(missing)
    assert not bind(evidence_context)


@pytest.mark.parametrize("field,value", [("scope", "other"), ("symbols", ["unrelated"]),
                                       ("owner", ""), ("query_or_reason", "")])
def test_irrelevant_graph_is_not_grounding(evidence_context, field, value):
    evidence_context["STRUCTURAL_EVIDENCE"][field] = value
    assert not bind(evidence_context)


def test_documentation_label_cannot_bypass_code_grounding(evidence_context):
    evidence_context["STRUCTURAL_EVIDENCE"]["method"] = "not_applicable"
    evidence_context["scope_kind"] = "documentation"
    assert not bind(evidence_context)


def test_source_divergence_invalidates_both_binding_and_closure(evidence_context):
    (Path(evidence_context["worktree"]) / "src/state.py").write_text("changed", encoding="utf-8")
    assert not bind(evidence_context)
    assert not success(evidence_context)


def test_filename_presence_without_strategy_cannot_close(evidence_context):
    evidence_context["PORTFOLIO_AUDIT"]["entries"][0].pop("contribution")
    assert not success(evidence_context)


@pytest.mark.parametrize("verdict", ["UNKNOWN", "UNALIGNED", "", None])
def test_each_plan_needs_an_explicit_supported_alignment_verdict(evidence_context, verdict):
    evidence_context["PLAN_STRATEGY"]["alignment_verdict"] = verdict
    assert not bind(evidence_context)
    assert not success(evidence_context)


def test_supported_checked_completion_and_verified_no_index_fallback(evidence_context):
    from hashlib import sha256
    record = evidence_context["PLAN_STRATEGY"]
    root = Path(evidence_context["worktree"])
    plan = root / record["plan_pin"]["path"]
    plan.write_text("state: ACTIVE\n- [x] T1 — verify state\n", encoding="utf-8")
    record["plan_pin"]["sha256"] = sha256(plan.read_bytes()).hexdigest()
    record["completion_checks"] = [{"box": "T1 — verify state", "source_pins": record["evidence_pins"],
                                     "oracle_pins": [evidence_context["STRUCTURAL_EVIDENCE"]["result_pin"]],
                                     "result": "PASS"}]
    assert success(evidence_context)
    receipt = evidence_context["STRUCTURAL_EVIDENCE"]
    receipt["method"] = "no_index"
    assert not bind(evidence_context)
    (root / ".codegraph").rmdir()
    assert bind(evidence_context)


def test_checked_completion_without_source_and_oracle_is_not_accepted(evidence_context):
    from hashlib import sha256
    record = evidence_context["PLAN_STRATEGY"]
    plan = Path(evidence_context["worktree"]) / record["plan_pin"]["path"]
    plan.write_text("state: ACTIVE\n- [x] T1 — verify state\n", encoding="utf-8")
    record["plan_pin"]["sha256"] = sha256(plan.read_bytes()).hexdigest()
    assert not success(evidence_context)


def test_empty_portfolio_needs_the_exhaustive_current_inventory_receipt(evidence_context):
    from hashlib import sha256
    root = Path(evidence_context["worktree"])
    (root / "plans/task.md").unlink()
    audit = evidence_context["PORTFOLIO_AUDIT"]
    audit["entries"] = []
    assert not success(evidence_context)
    audit["inventory_sha256"] = sha256(b"[]").hexdigest()
    assert success(evidence_context)


def test_rule_and_fsm_share_the_success_condition(evidence_context):
    from prompt_kernel.source import G9_SUCCESS
    gate = next(g for g in KERNEL.gates if g.id == "G9")
    rule = next(r for r in gate.local_rules if r.id == "CLOSURE_PROOF_RULE")
    assert rule.predicate.args[1] is G9_SUCCESS
    assert G9_FSM._eval_predicate(rule.predicate, {**evidence_context, "status": "SUCCESS"})
    assert not G9_FSM._eval_predicate(rule.predicate, {"status": "SUCCESS"})


@pytest.mark.parametrize("mutation", ["absent", "omitted", "unaligned", "no_parent", "same_identity"])
def test_portfolio_audit_is_mandatory_and_independently_verified(evidence_context, mutation):
    audit = evidence_context["PORTFOLIO_AUDIT"]
    if mutation == "absent":
        evidence_context.pop("PORTFOLIO_AUDIT")
    elif mutation == "omitted":
        audit["entries"] = []
    elif mutation == "unaligned":
        audit["unaligned"] = ["plans/task.md"]
    elif mutation == "no_parent":
        audit.pop("parent_verification_pin")
    else:
        audit["parent_id"] = audit["explorer_id"]
    assert not success(evidence_context)


def test_inventory_and_master_goal_are_re_read_at_closure(evidence_context):
    root = Path(evidence_context["worktree"])
    (root / "plans/new.md").write_text("unaccounted", encoding="utf-8")
    assert not success(evidence_context)
    (root / "plans/new.md").unlink()
    (root / "plans/MASTER_PLAN.md").write_text("## Goal — level 0\nDifferent target.\n", encoding="utf-8")
    assert not success(evidence_context)


def test_missing_audit_does_not_forbid_an_honest_non_success_stop():
    assert G9_FSM.is_valid_transition("EVALUATE_STOP", "EMIT_CLOSURE", {
        "stop_reason": "budget", "residual_defined": True, "lawful_non_success_terminal": "BLOCKED"})


def test_state_contracts_have_real_producers_and_consumers():
    gates = {gate.id: gate for gate in KERNEL.gates}
    assert "STRUCTURAL_EVIDENCE" in gates["G1"].outputs
    assert "STRUCTURAL_EVIDENCE" in gates["G6"].requires
    assert "PLAN_STRATEGY" in gates["G3"].outputs
    assert "PLAN_STRATEGY" in gates["G6"].requires
    assert "PORTFOLIO_AUDIT" in gates["G3"].outputs
    assert "PORTFOLIO_AUDIT" in gates["G9"].requires
