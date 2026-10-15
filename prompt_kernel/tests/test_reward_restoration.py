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
    # 2026-10-15 (t44 B5, owner corrections 1-2): the completion term is PORTFOLIO-wide —
    # plans_completed/(101 − pct)^2 with pct over completed + in-progress plans — plus a
    # linear abandoned penalty at the critical-risk weight; postponed plans count in neither.
    " Add plans_completed/(101 − pct)^2 to R: pct = "
    "100·plans_completed/(plans_completed + plans_in_progress); in progress = plan "
    "whose open tasks carry next action + continuation receipt, abandoned = one lacking "
    "either; completed = acceptance (intention -> to_state) oracle-confirmed, ticked "
    "boxes alone do not complete it; subtract 0.05·plans_abandoned (critical-risk "
    "weight), vanishing once the plan finishes, continued with a receipt, or moved by "
    "its outcome; postponed (owner decision + resume condition) counts in neither; "
    "finish plans, not open and drop them."
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
    "pct = 100·plans_completed/(plans_completed + plans_in_progress);",
    "in progress = plan whose open tasks carry next action + continuation receipt,",
    "abandoned = one lacking either;",
    "completed = acceptance (intention -> to_state) oracle-confirmed,",
    "ticked boxes alone do not complete it;",
    "subtract 0.05·plans_abandoned (critical-risk weight),",
    "vanishing once the plan finishes, continued with a receipt, or moved by its outcome;",
    "postponed (owner decision + resume condition) counts in neither;",
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


def test_reward_restoration_budget_accepts_declared_66000_ceiling() -> None:
    assert validate_kernel(replace(KERNEL, utf8_budget=66_000)) == []


def test_reward_restoration_budget_rejects_66001_above_finite_ceiling() -> None:
    errors = validate_kernel(replace(KERNEL, utf8_budget=66_001))
    assert any("66_000" in error or "66000" in error for error in errors), errors


# 2026-10-15 (t44 B5, owner corrections 1-2): the completion term is PORTFOLIO-wide with a
# linear abandoned penalty. The rejected shapes are mutation controls: a per-plan percentage
# (correction 1), abandoned plans inside pct, a total that excludes open plans, a penalty
# weight off the critical-risk weight, and postponed plans counted.
PER_PLAN_COMPLETION_TERM = (
    " Add Σ over plans p of done_p/(101 − pct_p)^2 to R: done_p = oracle-confirmed "
    "completed tasks of plan p, pct_p = 100·done_p/total_p. "
    "Omit an undefined completion term."
)

PORTFOLIO_FORMULA = "plans_completed/(101 − pct)^2"
PCT_DEFINITION = "pct = 100·plans_completed/(plans_completed + plans_in_progress)"
PENALTY_CLAUSE = "subtract 0.05·plans_abandoned (critical-risk weight)"
POSTPONED_CLAUSE = "postponed (owner decision + resume condition) counts in neither"


def test_completion_guard_rejects_per_plan_percentage() -> None:
    rendered = _render_reward(KERNEL, "product")
    assert PORTFOLIO_FORMULA in rendered
    assert "done_p" not in rendered
    mutant = _with_reward_text(HISTORICAL_REWARD_TEXT + PER_PLAN_COMPLETION_TERM)
    with pytest.raises(AssertionError):
        assert PORTFOLIO_FORMULA in _render_reward(mutant, "product")


def test_completion_guard_rejects_abandoned_plans_inside_pct() -> None:
    assert PCT_DEFINITION in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(
        EXPECTED_REWARD_TEXT.replace(
            PCT_DEFINITION,
            "pct = 100·plans_completed/(plans_completed + plans_in_progress + plans_abandoned)",
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


def test_completion_guard_rejects_postponed_plans_counted() -> None:
    assert POSTPONED_CLAUSE in _render_reward(KERNEL, "product")
    mutant = _with_reward_text(
        EXPECTED_REWARD_TEXT.replace(
            POSTPONED_CLAUSE,
            "postponed (owner decision + resume condition) counts in plans_in_progress",
        )
    )
    with pytest.raises(AssertionError):
        assert POSTPONED_CLAUSE in _render_reward(mutant, "product")
