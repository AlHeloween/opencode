"""Owner-requested restoration of REWARD_FUNCTION from ff4e679fa3^.

The historical literal is the independent requirement fixture; current source and
all four renderers must preserve it. These tests do not invent a reward calculator.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS
from prompt_kernel.model import BooleanPredicate as BP
from prompt_kernel.validate import validate_kernel


HISTORICAL_REWARD_TEXT = (
    "R := weighted_mean(1 − dSV/2, 1 − FLOPs_token/FLOPs_baseline, "
    "Exact_medoids_pinned/total_medoids, stamped_claims/total_claims) "
    "− 0.05·critical_risks_open; weights [0.35, 0.20, 0.25, 0.15] "
    "renormalized over measured terms. dSV: aligned normalized vectors, in [0,2]. "
    "FLOPs: measured and positive-baselined, never estimated from token count. "
    "An undefined term is omitted; no terms → Unknown. "
    "Freeze terms, baseline and scope for delta_R. Advisory telemetry, never authority: "
    "REWARDED iff comparable delta_R > 0 and @LOOP_PROGRESS holds; "
    "an uncontained critical risk vetoes execution whatever the score; "
    "a refutation stays progress even when R falls."
)

COMPLETION_TERM = (
    # 2026-10-15 (t44 B6, Claude's review of a0e15e87b5): abandoned plans ENTER the pct
    # denominator (the abandon-exploit closed), the continuation receipt is read back from a
    # result, the postpone decision is QUOTED.
    " Add plans_completed/(101 − pct)^2 to R: pct = "
    "100·plans_completed/(plans_completed + plans_in_progress + plans_abandoned); in progress "
    "= plan whose open tasks carry next action + a continuation receipt read back from a result "
    "(ticket, dispatch or run id — a note is not a receipt), abandoned = one lacking either; "
    "completed = acceptance (intention -> to_state) oracle-confirmed, ticked boxes alone do not "
    "complete it; subtract 0.05·plans_abandoned (critical-risk weight), vanishing once the plan "
    "finishes, is continued with such a receipt, or is moved by its outcome; postponed (a QUOTED "
    "owner decision + resume condition) counts in neither; finish plans, not open and drop them."
)
EXPECTED_REWARD_TEXT = HISTORICAL_REWARD_TEXT + COMPLETION_TERM

SHORTENED_REWARD_TEXT = (
    "Advisory telemetry, never authority: REWARDED iff the evidence measure rose "
    "on frozen terms and @LOOP_PROGRESS holds; a critical risk vetoes; "
    "a refutation stays progress."
)

VARIANTS = {
    "product": (GATE_ADDONS, None),
    "claude": (CLAUDE_GATE_ADDONS, ()),
    "codex": (CODEX_GATE_ADDONS, ()),
    "cursor": (CURSOR_GATE_ADDONS, ()),
}

CONTRACT_CLAUSES = (
    "R := weighted_mean(1 − dSV/2, 1 − FLOPs_token/FLOPs_baseline, "
    "Exact_medoids_pinned/total_medoids, stamped_claims/total_claims) "
    "− 0.05·critical_risks_open;",
    "weights [0.35, 0.20, 0.25, 0.15] renormalized over measured terms.",
    "dSV: aligned normalized vectors, in [0,2].",
    "FLOPs: measured and positive-baselined, never estimated from token count.",
    "An undefined term is omitted; no terms → Unknown.",
    "Freeze terms, baseline and scope for delta_R.",
    "Advisory telemetry, never authority:",
    "REWARDED iff comparable delta_R > 0 and @LOOP_PROGRESS holds;",
    "an uncontained critical risk vetoes execution whatever the score;",
    "a refutation stays progress even when R falls.",
)

COMPLETION_CLAUSES = (
    "Add plans_completed/(101 − pct)^2 to R:",
    "pct = 100·plans_completed/(plans_completed + plans_in_progress + plans_abandoned);",
    "in progress = plan whose open tasks carry next action + a continuation receipt read back from a result",
    "(ticket, dispatch or run id — a note is not a receipt),",
    "abandoned = one lacking either;",
    "completed = acceptance (intention -> to_state) oracle-confirmed,",
    "ticked boxes alone do not complete it;",
    "subtract 0.05·plans_abandoned (critical-risk weight),",
    "vanishing once the plan finishes, is continued with such a receipt, or is moved by its outcome;",
    "postponed (a QUOTED owner decision + resume condition) counts in neither;",
    "finish plans, not open and drop them.",
)


def _reward_rule():
    return next(rule for rule in KERNEL.shared_rules if rule.id == "REWARD_FUNCTION")


def _with_reward_text(text):
    return replace(
        KERNEL,
        shared_rules=tuple(
            replace(rule, text=text) if rule.id == "REWARD_FUNCTION" else rule
            for rule in KERNEL.shared_rules
        ),
    )


def _render_reward(kernel, variant):
    addons, identity_addons = VARIANTS[variant]
    rendered = render_kernel(kernel, addons, identity_addons)
    return rendered.split("#### @REWARD_FUNCTION\n", 1)[1].split("\n\n", 1)[0]


def test_reward_source_restores_historical_text_and_preserves_predicate() -> None:
    rule = _reward_rule()
    assert rule.text == EXPECTED_REWARD_TEXT
    assert rule.predicate == BP(
        "AND", BP("GT", value=("reward", 0)), BP("HAS", "loop_progress_holds")
    )


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_every_host_renders_historical_reward_contract(variant) -> None:
    assert _render_reward(KERNEL, variant) == EXPECTED_REWARD_TEXT


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_reward_guard_rejects_actual_shortened_rule(variant) -> None:
    assert _render_reward(KERNEL, variant) == EXPECTED_REWARD_TEXT
    mutant = _with_reward_text(SHORTENED_REWARD_TEXT)
    with pytest.raises(AssertionError):
        assert _render_reward(mutant, variant) == EXPECTED_REWARD_TEXT


@pytest.mark.parametrize("clause", CONTRACT_CLAUSES)
def test_reward_guard_discriminates_each_lost_contract_clause(clause) -> None:
    assert clause in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(EXPECTED_REWARD_TEXT.replace(clause, ""))
    with pytest.raises(AssertionError):
        assert clause in _render_reward(mutant, "product")


@pytest.mark.parametrize("clause", COMPLETION_CLAUSES)
def test_completion_guard_discriminates_each_lost_completion_clause(clause) -> None:
    assert clause in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(EXPECTED_REWARD_TEXT.replace(clause, ""))
    with pytest.raises(AssertionError):
        assert clause in _render_reward(mutant, "product")


def test_reward_restoration_budget_accepts_declared_69000_ceiling() -> None:
    # 2026-10-17 (t82 review): four SV-lineage fixes step utf8_budget AND the
    # validate.py hard ceiling to the next band, 69_000 (owner standing word: raise, never cut).
    assert validate_kernel(replace(KERNEL, utf8_budget=69_000)) == []


def test_reward_restoration_budget_rejects_69001_above_finite_ceiling() -> None:
    errors = validate_kernel(replace(KERNEL, utf8_budget=69_001))
    assert any("69_000" in error or "69000" in error for error in errors), errors


# 2026-10-15 (t44 B6, Claude's review of a0e15e87b5): the rejected shapes are mutation controls:
# a per-plan percentage (correction 1), a pct denominator WITHOUT plans_abandoned (the
# abandon-exploit), a receipt not read back from a result, an unquoted owner decision, a total
# that excludes open plans, a penalty weight off the critical-risk weight, postponed counted.
PER_PLAN_COMPLETION_TERM = (
    " Add Σ over plans p of done_p/(101 − pct_p)^2 to R: done_p = oracle-confirmed "
    "completed tasks of plan p, pct_p = 100·done_p/total_p. "
    "Omit an undefined completion term."
)

PORTFOLIO_FORMULA = "plans_completed/(101 − pct)^2"
PCT_DEFINITION = "pct = 100·plans_completed/(plans_completed + plans_in_progress + plans_abandoned)"
RECEIPT_CLAUSE = "a continuation receipt read back from a result (ticket, dispatch or run id — a note is not a receipt)"
PENALTY_CLAUSE = "subtract 0.05·plans_abandoned (critical-risk weight)"
POSTPONED_CLAUSE = "postponed (a QUOTED owner decision + resume condition) counts in neither"


def test_completion_guard_rejects_per_plan_percentage() -> None:
    rendered = _render_reward(KERNEL, "product")
    assert PORTFOLIO_FORMULA in rendered
    assert "done_p" not in rendered
    mutant = _with_reward_text(HISTORICAL_REWARD_TEXT + PER_PLAN_COMPLETION_TERM)
    with pytest.raises(AssertionError):
        assert PORTFOLIO_FORMULA in _render_reward(mutant, "product")


def test_completion_guard_rejects_pct_denominator_without_abandoned() -> None:
    # Claude's review finding 1: leaving abandoned plans out of the denominator lets abandoning an
    # in-progress plan LIFT pct (9 completed + 1 in progress → abandon the one: 9/(101−100)² −
    # 0.05 = 8.95). SUPERSEDES test_completion_guard_rejects_abandoned_plans_inside_pct, whose
    # premise (abandoned excluded from pct) the review refuted.
    assert PCT_DEFINITION in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(
        EXPECTED_REWARD_TEXT.replace(
            PCT_DEFINITION,
            "pct = 100·plans_completed/(plans_completed + plans_in_progress)",
        )
    )
    with pytest.raises(AssertionError):
        assert PCT_DEFINITION in _render_reward(mutant, "product")


def test_completion_guard_rejects_total_excluding_open_plans() -> None:
    mutant = _with_reward_text(
        EXPECTED_REWARD_TEXT.replace(PCT_DEFINITION, "pct = 100·plans_completed/plans_completed")
    )
    with pytest.raises(AssertionError):
        assert PCT_DEFINITION in _render_reward(mutant, "product")


def test_completion_guard_rejects_penalty_weight_off_the_critical_risk_weight() -> None:
    assert PENALTY_CLAUSE in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(
        EXPECTED_REWARD_TEXT.replace(PENALTY_CLAUSE, "subtract 0.10·plans_abandoned (critical-risk weight)")
    )
    with pytest.raises(AssertionError):
        assert PENALTY_CLAUSE in _render_reward(mutant, "product")


def test_completion_guard_rejects_a_receipt_not_read_back_from_a_result() -> None:
    # Claude's review finding 2: a one-line «resuming later» note must not erase the penalty —
    # the continuation receipt is READ BACK from a result (ticket, dispatch or run id).
    assert RECEIPT_CLAUSE in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(EXPECTED_REWARD_TEXT.replace(RECEIPT_CLAUSE, "a continuation receipt"))
    with pytest.raises(AssertionError):
        assert RECEIPT_CLAUSE in _render_reward(mutant, "product")


def test_completion_guard_rejects_an_unquoted_owner_decision() -> None:
    # Claude's review finding 3: a vague remark is not the owner decision — it is QUOTED, like
    # OUT_OF_SCOPE's quoted exclusion.
    assert POSTPONED_CLAUSE in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(
        EXPECTED_REWARD_TEXT.replace(POSTPONED_CLAUSE, "postponed (an owner decision + resume condition) counts in neither")
    )
    with pytest.raises(AssertionError):
        assert POSTPONED_CLAUSE in _render_reward(mutant, "product")


def test_completion_guard_rejects_postponed_plans_counted() -> None:
    assert POSTPONED_CLAUSE in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(
        EXPECTED_REWARD_TEXT.replace(
            POSTPONED_CLAUSE,
            "postponed (a QUOTED owner decision + resume condition) counts in plans_in_progress",
        )
    )
    with pytest.raises(AssertionError):
        assert POSTPONED_CLAUSE in _render_reward(mutant, "product")
