"""t42 global invariants — every status that steers the work is a claim (owner, 2026-10-14).

Written BEFORE the implementation (tests first). Encodes the approved invariants:
(1) a FIRST shared rule @STATUS_CLAIM, short text incl. «Unknown does not stop the work»;
(2) every terminal exit edge and every stop rule demands scope + receipts + falsifier;
(3) no stop/descend and no predict/unpredictable contradiction remains;
(4) every run-holding identity reaches a closing gate — PLAN_MODE included;
(5) the @KAIZEN split carries the falsifiability gates (defect = reproducer fails NOW;
    improvement = before/after on one predicate), both per @STATUS_CLAIM.
K2 review additions: (B1) an untried route must state why it is out of reach — a reachable
untried route is no BLOCKED; (B3) @STATUS_CLAIM covers every terminal, WAITING_APPROVAL and
OUT_OF_SCOPE included; (B5) the STALL fixed point carries receipts, plural.
Size stays with test_dedup / test_addons_* (the caps).
"""
from __future__ import annotations

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS

VARIANTS = {
    "product": render_kernel(KERNEL, GATE_ADDONS),
    "claude": render_kernel(KERNEL, CLAUDE_GATE_ADDONS, ()),
    "codex": render_kernel(KERNEL, CODEX_GATE_ADDONS, ()),
    "cursor": render_kernel(KERNEL, CURSOR_GATE_ADDONS, ()),
}


def _shared() -> dict[str, str]:
    return {rule.id: rule.text for rule in KERNEL.shared_rules}


def _gate_rule(gate_id: str, rule_id: str) -> str:
    return next(
        rule.text for gate in KERNEL.gates if gate.id == gate_id for rule in gate.local_rules if rule.id == rule_id
    )


def test_status_claim_is_first_shared_rule_and_renders_in_every_variant() -> None:
    assert KERNEL.shared_rules[0].id == "STATUS_CLAIM"
    text = KERNEL.shared_rules[0].text
    # B3: every terminal — WAITING_APPROVAL and OUT_OF_SCOPE were missing from the closed list.
    for terminal in ("SUCCESS, DEFECT, IMPROVED, WAITING_APPROVAL, OUT_OF_SCOPE",):
        assert terminal in text
    assert "checkable refutation conditions and their observations" in text
    assert "Unknown does not stop the work" in text
    for name, rendered in VARIANTS.items():
        assert "#### @STATUS_CLAIM" in rendered, name
        assert "Unknown does not stop the work" in rendered, name


def test_every_terminal_edge_carries_its_claim() -> None:
    terminal_edges = [edge for edge in KERNEL.edges if edge.kind == "terminal"]
    assert terminal_edges
    for edge in terminal_edges:
        assert "claim" in edge.condition, f"{edge.source}->{edge.target}: {edge.condition}"
    assert not any(edge.target == "BLOCKED" for edge in terminal_edges)
    assert any(edge.source == "G9" and edge.target == "G1" for edge in KERNEL.edges)
    assert any(edge.source == "G9" and edge.target == "G2" for edge in KERNEL.edges)
    success = next(edge for edge in terminal_edges if edge.target == "SUCCESS")
    assert "control receipt" in success.condition
    assert "delivered revision" in success.condition


def test_every_stop_rule_demands_scope_and_falsifier() -> None:
    stop = _gate_rule("G9", "BOUNDED_STOP_CONDITIONS")
    assert "unfinished task + next action + receipt" in stop
    assert "task stays open" in stop
    assert "SUCCESS still requires @CLOSURE_PROOF" in stop
    assert "routes tried with receipts" in _shared()["TOOLCHAIN_QUALIFICATION"]
    ledger = dict(KERNEL.state_fields)["CLAIM_LEDGER"]
    for field in ("scope", "receipts", "falsifier", "reopen_when", "allowed_residual"):
        assert field in ledger, field


def test_no_stop_or_descend_contradiction() -> None:
    info = _shared()["INFORMATION_STATUS"]
    # 2026-10-15: the ladder restatement moved to §1.3 (third copy cut, owner: «меньше пиздежа»);
    # the continuation norm the test guards lives in the descend clause.
    assert "descend while a split adds observability" in info
    assert "failed proof is Unknown — stop" not in info


def test_no_predict_unpredictable_contradiction() -> None:
    oracle = _gate_rule("G8", "ORACLE")
    assert "written without running it" in oracle
    assert "predictable beforehand" not in oracle
    assert "Predict each case before the run" in _gate_rule("G3", "SMOKE_BEFORE")


def test_run_holding_identities_reach_a_closing_gate() -> None:
    """Ownership chain, not map reachability: PLAN_MODE's only owned exit was G6 → the owner door."""
    forward = {(edge.source, edge.target) for edge in KERNEL.edges if edge.kind == "forward"}
    for identity in KERNEL.identities:
        if identity.kind == "subagent" or identity.id == "REASONING_MODE":
            continue  # subagents report to a parent; REASONING_MODE sits outside the spine
        owned = {gate.id for gate in KERNEL.gates if identity.id in gate.identities}
        assert owned, identity.id
        reachable = set(owned)
        frontier = set(owned)
        while frontier:
            step = {
                target
                for (source, target) in forward
                if source in frontier and target in owned and target not in reachable
            }
            reachable |= step
            frontier = step
        assert "G9" in reachable, f"{identity.id} cannot reach a closing gate: owned={sorted(owned)}"


def test_kaizen_split_carries_falsifiability_gates() -> None:
    shared = _shared()
    jidoka = shared["JIDOKA"]
    assert "A defect stops the line — tool or process" in jidoka
    assert "its reproducer fails NOW (@ANTI_CHURN)" in jidoka
    assert "per @STATUS_CLAIM" in jidoka
    assert "a check beats a caution" in jidoka
    kaizen = shared["KAIZEN"]
    assert "updates the standard it ran under" in kaizen
    assert "before/after on one predicate (@SMOKE_BEFORE)" in kaizen
    assert "per @STATUS_CLAIM" in kaizen
    assert "A tool defect stops the line" not in kaizen


def test_stall_fixed_point_carries_receipts() -> None:
    # B5: the fixed point was singular and receipt-free.
    stall = next(
        edge for edge in KERNEL.edges if edge.source == "G9" and edge.target == "WAITING_APPROVAL"
    )
    assert "splits tried with receipts" in stall.condition
