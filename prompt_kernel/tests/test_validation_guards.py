"""K02/K03 validation guards — counterexamples measured by the audit probe.

The probe (experiments_history/2026-10-12_kernel-audit/probe.py, `probe-results.json`) recorded
`validate_kernel` accepting IR the declared map cannot carry:

- a `side` edge sourced from `*`, from `G0` and from `SUCCESS` — `errors == []`, `rendered: true`;
- a gate FSM whose `initial_state` sat outside its own `states` — `errors == []`, `same_render: true`.

The map's own `control_flow_rule` (render.py:262) says every deviation must use a declared move,
concern, interrupt, terminal or protocol return. So: the wildcard `*` belongs to the ONE interrupt
edge (a run can be interrupted at any active gate, and G9 is the only gate that records partial
state); a terminal is a run END and originates nothing; a `side` hop exists only as the declared
concern path G4 -> G5; a branch beside the spine exists only as the declared G6 -> G8 (the
read/plan-only deliverable — the deliberate branch pinned by test_architecture).

Each guard is observed to FIRE on a mutation built from the REAL dataclass instances (@ORACLE: a
guard that cannot fail proves nothing), and the canonical kernel is the positive control — a
repair that refuses the lawful graph is not a guard either. `fsm` is optional in the model and the
renderer never reads it, so a gate that declares no state machine stays legal; the guard applies
to declared FSMs only.
"""

from __future__ import annotations

from dataclasses import replace

from prompt_kernel import KERNEL
from prompt_kernel.validate import validate_kernel


def _with_mutated_edge(source: str, target: str, kind: str):
    """Append one edge to the real edge tuple; every other field stays canonical."""
    return replace(
        KERNEL,
        edges=(
            *KERNEL.edges,
            replace(KERNEL.edges[0], source=source, target=target, kind=kind, condition="mutation"),
        ),
    )


def _with_gate_fsm(gate_id: str, fsm):
    gates = tuple(replace(gate, fsm=fsm) if gate.id == gate_id else gate for gate in KERNEL.gates)
    return replace(KERNEL, gates=gates)


def test_canonical_kernel_still_validates_and_keeps_every_declared_route() -> None:
    """Positive control: the repair must not refuse the lawful map."""
    assert validate_kernel(KERNEL) == []
    routes = {(edge.source, edge.target, edge.kind) for edge in KERNEL.edges}
    assert ("G6", "G8", "forward") in routes
    assert ("G4", "G5", "side") in routes
    assert ("G5", "G2", "back") in routes
    assert ("G9", "SUCCESS", "terminal") in routes
    assert ("*", "G9", "interrupt") in routes


def test_validator_rejects_wildcard_outside_the_interrupt_edge() -> None:
    for kind in ("side", "forward", "back", "terminal"):
        errors = validate_kernel(_with_mutated_edge("*", "G7", kind))
        assert any("wildcard" in error for error in errors), (kind, errors)
    errors = validate_kernel(_with_mutated_edge("*", "G7", "interrupt"))
    assert any("interrupt edge must be * -> G9" in error for error in errors), errors


def test_validator_rejects_outgoing_edges_from_a_terminal() -> None:
    assert "SUCCESS" in KERNEL.terminals
    for terminal in KERNEL.terminals:
        errors = validate_kernel(_with_mutated_edge(terminal, "G7", "side"))
        assert any("no outgoing edges" in error for error in errors), (terminal, errors)


def test_validator_rejects_an_undeclared_side_edge() -> None:
    for source, target in (("G0", "G7"), ("G0", "G8")):
        errors = validate_kernel(_with_mutated_edge(source, target, "side"))
        assert any("side edge" in error for error in errors), (source, target, errors)


def test_validator_rejects_an_undeclared_forward_branch() -> None:
    # G3 -> G7 skips authorization (G4); G4 -> G8 skips grounding and implementation (G6, G7);
    # G0 -> G4 skips three gates. Only the declared read/plan-only branch G6 -> G8 may ride.
    for source, target in (("G3", "G7"), ("G4", "G8"), ("G0", "G4")):
        errors = validate_kernel(_with_mutated_edge(source, target, "forward"))
        assert any("undeclared forward branch" in error for error in errors), (source, target, errors)


def test_validator_rejects_fsm_initial_state_outside_its_declared_states() -> None:
    gate = KERNEL.gates[0]
    assert gate.fsm is not None
    errors = validate_kernel(_with_gate_fsm(gate.id, replace(gate.fsm, initial_state="UNDECLARED")))
    assert any("initial state" in error for error in errors), errors


def test_validator_rejects_fsm_accepting_state_outside_its_declared_states() -> None:
    gate = KERNEL.gates[0]
    assert gate.fsm is not None
    errors = validate_kernel(_with_gate_fsm(gate.id, replace(gate.fsm, accepting_states=("UNDECLARED",))))
    assert any("accepting state" in error for error in errors), errors


def test_validator_rejects_fsm_transition_endpoint_outside_its_declared_states() -> None:
    gate = KERNEL.gates[0]
    assert gate.fsm is not None
    broken = replace(
        gate.fsm,
        transitions=(replace(gate.fsm.transitions[0], to_state="UNDECLARED"), *gate.fsm.transitions[1:]),
    )
    errors = validate_kernel(_with_gate_fsm(gate.id, broken))
    assert any("transition endpoint" in error for error in errors), errors


def test_validator_rejects_fsm_id_that_disagrees_with_its_owner() -> None:
    gate = KERNEL.gates[0]
    assert gate.fsm is not None
    errors = validate_kernel(_with_gate_fsm(gate.id, replace(gate.fsm, id="G0_ORPHAN")))
    assert any("must match its owner" in error for error in errors), errors


def test_validator_applies_the_same_fsm_contract_to_protocols() -> None:
    protocol = KERNEL.protocols[0]
    assert protocol.fsm is not None
    broken = replace(protocol, fsm=replace(protocol.fsm, initial_state="UNDECLARED"))
    errors = validate_kernel(replace(KERNEL, protocols=(broken, *KERNEL.protocols[1:])))
    assert any("initial state" in error for error in errors), errors


def test_fsm_stays_optional_for_a_gate_that_declares_none() -> None:
    """The model declares `fsm: StateMachine | None` and nothing renders it: omission is legal."""
    assert validate_kernel(_with_gate_fsm("G0", None)) == []
