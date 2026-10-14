"""Owner 2026-10-15: missing knowledge and delegated work keep the task open."""

from dataclasses import replace

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS
from prompt_kernel.source import DELEGATION_FSM, G9_FSM


VARIANTS = {
    "product": (GATE_ADDONS, None),
    "claude": (CLAUDE_GATE_ADDONS, ()),
    "codex": (CODEX_GATE_ADDONS, ()),
    "cursor": (CURSOR_GATE_ADDONS, ()),
}


def _no_gap_terminal(kernel):
    assert set(kernel.terminals) == {"SUCCESS", "WAITING_APPROVAL", "OUT_OF_SCOPE"}
    assert not any(edge.target == "BLOCKED" for edge in kernel.edges)


def test_task_has_no_gap_terminal_and_mutation_is_detected():
    _no_gap_terminal(KERNEL)
    with pytest.raises(AssertionError):
        _no_gap_terminal(replace(KERNEL, terminals=(*KERNEL.terminals, "BLOCKED")))


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_every_host_removes_terminal_and_plan_lifecycle_ontology(variant):
    rendered = render_kernel(KERNEL, *VARIANTS[variant])
    assert "BLOCKED" not in rendered
    assert " = blocked;" not in rendered
    assert "«blocked»" not in rendered
    assert "plans/postponed/ = awaiting owner decision" in rendered
    assert "unfinished tasks remain active" in rendered.lower()


@pytest.mark.parametrize("oracle", ["FAIL", "Unknown", False, ""])
def test_recorded_non_pass_reaches_executable_continuation(oracle):
    context = {
        "oracle": oracle, "residual_defined": True, "next_action": "query indexed owner",
        "continuation_ref": "plans/task.md#probe", "continuation_route": "G1",
        "parent_task_open": True,
    }
    assert G9_FSM.is_valid_transition("CHECK_ORACLE", "EVALUATE_RESIDUAL", context)
    assert G9_FSM.is_valid_transition("EVALUATE_RESIDUAL", "CONTINUE_RESIDUAL", context)
    assert "CONTINUE_RESIDUAL" in G9_FSM.accepting_states
    assert not G9_FSM.is_valid_transition("CHECK_RISKS", "EMIT_SUCCESS", context)


@pytest.mark.parametrize("missing", ["residual_defined", "next_action", "continuation_ref",
                                     "continuation_route", "parent_task_open"])
def test_continuation_cannot_be_an_empty_label(missing):
    context = {"residual_defined": True, "next_action": "probe", "continuation_ref": "plan#probe",
               "continuation_route": "G2", "parent_task_open": True}
    assert G9_FSM.is_valid_transition("EVALUATE_RESIDUAL", "CONTINUE_RESIDUAL", context)
    context.pop(missing)
    assert not G9_FSM.is_valid_transition("EVALUATE_RESIDUAL", "CONTINUE_RESIDUAL", context)


def test_uncovered_acceptance_continues_and_invalid_route_is_rejected():
    assert G9_FSM.is_valid_transition("CHECK_ACCEPTANCE", "EVALUATE_RESIDUAL", {"acceptance_covered": False})
    assert not G9_FSM.is_valid_transition("EVALUATE_RESIDUAL", "CONTINUE_RESIDUAL", {
        "residual_defined": True, "next_action": "probe", "continuation_ref": "plan#probe",
        "continuation_route": "invented", "parent_task_open": True})


def test_denied_effect_has_a_permitted_continuation_without_authority_bypass():
    route = next(edge for edge in KERNEL.edges if edge.source == "G4" and edge.target == "G2")
    assert route.kind == "back"
    assert "preserves the denied effect" in route.condition
    assert "authorized executor" in route.condition


@pytest.mark.parametrize("terminal,decision", [("WAITING_APPROVAL", "user_decision_required"),
                                             ("OUT_OF_SCOPE", "exclusion_quoted")])
def test_real_owner_decision_or_exclusion_can_end_run(terminal, decision):
    context = {"stop_reason": "owner decision", "residual_defined": True,
               "lawful_non_success_terminal": terminal, decision: True}
    assert G9_FSM.is_valid_transition("EVALUATE_STOP", "EMIT_CLOSURE", context)
    context.pop(decision)
    assert not G9_FSM.is_valid_transition("EVALUATE_STOP", "EMIT_CLOSURE", context)


def test_dispatch_requires_ticket_and_observable_receipt():
    context = {"ticket_ref": "org:ticket:1", "dispatch_receipt": "session:123"}
    assert DELEGATION_FSM.is_valid_transition("SEND_FALSIFIER", "DISPATCH_TASK", context)
    for missing in tuple(context):
        assert not DELEGATION_FSM.is_valid_transition("SEND_FALSIFIER", "DISPATCH_TASK",
                                                      {key: value for key, value in context.items() if key != missing})


def test_result_and_independent_verification_are_both_required():
    result = {"subagent_result": "artifact", "result_receipt": "artifact:sha256", "result_vector": "sv"}
    assert DELEGATION_FSM.is_valid_transition("OBSERVE_RESULT", "VERIFY_RESULT", result)
    assert not DELEGATION_FSM.is_valid_transition("OBSERVE_RESULT", "VERIFY_RESULT", {"ticket_closed": True})
    verified = {**result, "verification_pass": True, "verification_receipt": "oracle:1", "acceptance_covered": True}
    assert DELEGATION_FSM.is_valid_transition("VERIFY_RESULT", "VERIFIED_DONE", verified)
    for missing in ("subagent_result", "verification_pass", "verification_receipt", "acceptance_covered"):
        assert not DELEGATION_FSM.is_valid_transition("VERIFY_RESULT", "VERIFIED_DONE",
                                                      {key: value for key, value in verified.items() if key != missing})
    assert DELEGATION_FSM.accepting_states == ("VERIFIED_DONE",)
    assert next(p for p in KERNEL.protocols if p.id == "DELEGATION").returns_to == "SAME_GATE"


@pytest.mark.parametrize("signal", ["silence", "executor_failure"])
def test_silence_and_executor_failure_require_bounded_followup(signal):
    context = {signal: True, "followup_budget_remaining": 1, "envelope_valid": True}
    assert DELEGATION_FSM.is_valid_transition("OBSERVE_RESULT", "FOLLOW_UP", context)
    assert not DELEGATION_FSM.is_valid_transition("OBSERVE_RESULT", "FOLLOW_UP", {**context, "followup_budget_remaining": 0})
    assert not DELEGATION_FSM.is_valid_transition("OBSERVE_RESULT", "FOLLOW_UP", {**context, "envelope_valid": False})
    followup = {"followup_receipt": "message:2", "ticket_ref": "org:ticket:1", "envelope_valid": True}
    assert DELEGATION_FSM.is_valid_transition("FOLLOW_UP", "OBSERVE_RESULT", followup)
    assert not DELEGATION_FSM.is_valid_transition("FOLLOW_UP", "OBSERVE_RESULT", {**followup, "followup_receipt": ""})


def test_failed_verification_returns_to_followup_without_false_done():
    context = {"verification_pass": False, "followup_budget_remaining": 1, "envelope_valid": True}
    assert DELEGATION_FSM.is_valid_transition("VERIFY_RESULT", "FOLLOW_UP", context)
    assert not DELEGATION_FSM.is_valid_transition("VERIFY_RESULT", "VERIFIED_DONE", context)


def test_failed_attempts_or_dependencies_never_satisfy_done():
    rule = next(r for g in KERNEL.gates if g.id == "G9" for r in g.local_rules if r.id == "BOUNDED_STOP_CONDITIONS")
    for context in ({"status": "DONE", "failed_attempts": 3}, {"status": "DONE", "futile": True},
                    {"status": "DONE", "blocked_by_human": True}):
        assert not G9_FSM._eval_predicate(rule.predicate, context)
    assert "task stays open" in rule.text
    assert "3 failed corrective attempts" not in rule.text
