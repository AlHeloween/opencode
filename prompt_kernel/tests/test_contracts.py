from __future__ import annotations

from dataclasses import replace

from prompt_kernel import (
    KERNEL,
    REQUIRED_NEXT_SEMANTICS,
    REQUIRED_SEMANTICS,
    compatibility_report,
    next_kernel_contract_gaps,
    render_kernel,
    validate_kernel,
)
from prompt_kernel.source import LEGACY_DOMAIN_DISCIPLINES


def test_sv_contract_is_serializable_and_normalized() -> None:
    contract = KERNEL.sv_contract
    assert contract.tag == "SV_FORMAT"
    assert contract.keyword_min == 3
    assert contract.keyword_max == 9
    assert contract.weight_sum == 1.0
    assert contract.digest_fields == ("md5", "prev-md5", "parent-goal-md5")
    assert contract.first_prev_md5 == "0" * 32
    assert len(contract.first_prev_md5) == 32
    assert all(char in "0123456789abcdef" for char in contract.first_prev_md5)


def test_source_routing_covers_legacy_disciplines_with_primary_routes() -> None:
    routes = {route.discipline: route for route in KERNEL.source_routing.routes}
    assert KERNEL.source_routing.tag == "SOURCE_ROUTING"
    assert KERNEL.source_routing.alias == "DOMAIN_SOURCES"
    for name in LEGACY_DOMAIN_DISCIPLINES:
        assert name in routes
        assert routes[name].primary
        assert routes[name].constraint_class in KERNEL.source_routing.classes
    assert "software" in routes
    assert routes["software"].primary


def test_generic_web_cannot_reach_inferred_without_stamp() -> None:
    rule = KERNEL.source_routing.generic_web_rule
    assert "Inferred" in rule
    assert "source_stamp" in rule
    assert "never becomes Inferred" in rule
    ladder = dict(KERNEL.source_routing.ladder)
    assert ladder["unverified neighbor / search snippet"] == "Guess"
    assert ladder["web hit, fetched page included"] == "Hypothetical"
    assert ladder["primary authority or local code (git, codegraph, universalsearch source code)"] == "Inferred"
    assert ladder["reproduced smoke / PoC PASS"] == "Exact"
    assert ladder["failed proof or irreconcilable conflict"] == "Unknown"


def test_abi_establishes_status_sv_and_routing_before_state() -> None:
    text = render_kernel(KERNEL)
    offsets = (
        text.index("1.1 @INFOMARK"),
        text.index("1.2 @SV_FORMAT"),
        text.index("1.3 @SOURCE_ROUTING"),
        text.index("1.4 state_contract:"),
        text.index("1.5 action_classes:"),
        text.index("## 2. SHARED_RULES"),
    )
    assert offsets == tuple(sorted(offsets))
    assert text.index("## 0. KERNEL_MAP") < offsets[0]


def test_rendered_kernel_keeps_sv_and_source_markers() -> None:
    report = compatibility_report("", render_kernel(KERNEL))
    assert "SV_FORMAT" not in report["missing_from_next"]
    assert "DOMAIN_SOURCES" not in report["missing_from_next"]
    assert "PREV_MD5" not in report["missing_from_next"]
    assert "PARENT_GOAL_MD5" not in report["missing_from_next"]
    assert report["missing_next_only"] == ()
    assert next_kernel_contract_gaps(KERNEL) == ()
    assert "SV_FORMAT" in REQUIRED_SEMANTICS
    assert "SOURCE_ROUTING" in REQUIRED_NEXT_SEMANTICS


def test_validator_rejects_sv_contract_without_digest_chain() -> None:
    broken = replace(KERNEL.sv_contract, digest_fields=("md5",))
    errors = validate_kernel(replace(KERNEL, sv_contract=broken))
    assert any("digest chain" in error for error in errors)


def test_validator_rejects_source_route_without_primary() -> None:
    first = KERNEL.source_routing.routes[0]
    broken_route = replace(first, primary=())
    broken = replace(
        KERNEL.source_routing,
        routes=(broken_route, *KERNEL.source_routing.routes[1:]),
    )
    errors = validate_kernel(replace(KERNEL, source_routing=broken))
    assert any("no primary authority route" in error for error in errors)


def test_validator_rejects_generic_web_inferred_without_stamp() -> None:
    broken = replace(KERNEL.source_routing, generic_web_rule="Prefer official docs.")
    errors = validate_kernel(replace(KERNEL, source_routing=broken))
    assert any("source_stamp" in error for error in errors)
