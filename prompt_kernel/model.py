from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Literal


@dataclass(frozen=True, slots=True)
class Rule:
    id: str
    owner: str
    text: str
    predicate: BooleanPredicate | None = None

    def render(self) -> str:
        """Render the canonical rule; a predicate cannot replace its qualifications."""
        return self.text


@dataclass(frozen=True, slots=True)
class BooleanPredicate:
    """Structured boolean predicate replacing conditional prose.

    Examples:
        - BooleanPredicate("AND", [BooleanPredicate("HAS", ["evidence"]), BooleanPredicate("NOT", [BooleanPredicate("HAS", ["divergence"])])])
        - BooleanPredicate("IMPLIES", [BooleanPredicate("HAS", ["plan"]), BooleanPredicate("HAS", ["binding"])])
    """
    op: Literal["AND", "OR", "NOT", "IMPLIES", "IFF", "HAS", "EQ", "GT", "GE", "LT", "LE", "EXISTS"]
    args: tuple["BooleanPredicate", ...] = ()
    value: object = None

    def __init__(self, op: Literal["AND", "OR", "NOT", "IMPLIES", "IFF", "HAS", "EQ", "GT", "GE", "LT", "LE", "EXISTS"], *args, value: object = None):
        leaf = ("HAS", "EXISTS", "EQ", "GT", "GE", "LT", "LE")
        branch = ("AND", "OR", "NOT", "IMPLIES", "IFF")
        if op not in leaf + branch:
            raise ValueError(f"unknown predicate operator: {op}")
        if op in leaf:
            if args:
                if len(args) != 1 or value is not None:
                    raise ValueError(f"{op} needs exactly one operand")
                value = args[0]
            if isinstance(value, list) and len(value) == 1:
                value = value[0]
            if value is None:
                raise ValueError(f"{op} needs an operand")
            if op not in ("HAS", "EXISTS") and (not isinstance(value, tuple) or len(value) != 2):
                raise ValueError(f"{op} needs a (key, expected) operand")
            children = ()
        else:
            if value is not None:
                raise ValueError(f"{op} accepts child predicates, not a value")
            children = tuple(args[0]) if len(args) == 1 and isinstance(args[0], (list, tuple)) else args
            expected = 1 if op == "NOT" else 2
            if len(children) < expected or (op in ("NOT", "IMPLIES", "IFF") and len(children) != expected):
                raise ValueError(f"{op} needs {expected} child predicates")
            if not all(isinstance(child, BooleanPredicate) for child in children):
                raise ValueError(f"{op} accepts only predicate children")
        object.__setattr__(self, "op", op)
        object.__setattr__(self, "args", children)
        object.__setattr__(self, "value", value)

    def __str__(self) -> str:
        if self.op == "HAS":
            return f"HAS({self.value})"
        elif self.op in ("EQ", "GT", "GE", "LT", "LE"):
            return f"{self.value[0]} {self.op} {self.value[1]}"
        elif self.op == "NOT":
            return f"NOT({self.args[0]})"
        elif self.op in ("AND", "OR"):
            return f"{self.op}({', '.join(str(a) for a in self.args)})"
        elif self.op == "IMPLIES":
            return f"{self.args[0]} => {self.args[1]}"
        elif self.op == "IFF":
            return f"{self.args[0]} <=> {self.args[1]}"
        elif self.op == "EXISTS":
            return f"EXISTS({self.value})"
        return self.op



@dataclass(frozen=True, slots=True)
class FSMTransition:
    from_state: str
    to_state: str
    predicate: BooleanPredicate
    description: str = ""


@dataclass(frozen=True, slots=True)
class StateMachine:
    """Finite State Machine for a gate or protocol."""
    id: str
    states: tuple[str, ...]
    initial_state: str
    accepting_states: tuple[str, ...]
    transitions: tuple[FSMTransition, ...]

    def is_valid_transition(self, from_state: str, to_state: str, context: dict) -> bool:
        """Check if transition is valid given context."""
        for t in self.transitions:
            if t.from_state == from_state and t.to_state == to_state:
                return self._eval_predicate(t.predicate, context)
        return False

    def _eval_predicate(self, pred: BooleanPredicate, context: dict) -> bool:
        if pred.op == "HAS":
            return bool(context.get(pred.value))
        elif pred.op == "NOT":
            return not self._eval_predicate(pred.args[0], context)
        elif pred.op == "AND":
            return all(self._eval_predicate(a, context) for a in pred.args)
        elif pred.op == "OR":
            return any(self._eval_predicate(a, context) for a in pred.args)
        elif pred.op == "IMPLIES":
            return (not self._eval_predicate(pred.args[0], context)) or self._eval_predicate(pred.args[1], context)
        elif pred.op == "IFF":
            return self._eval_predicate(pred.args[0], context) == self._eval_predicate(pred.args[1], context)
        elif pred.op == "EQ":
            return context.get(pred.value[0]) == pred.value[1]
        elif pred.op == "GT":
            return pred.value[0] in context and context[pred.value[0]] > pred.value[1]
        elif pred.op == "GE":
            return pred.value[0] in context and context[pred.value[0]] >= pred.value[1]
        elif pred.op == "LT":
            return pred.value[0] in context and context[pred.value[0]] < pred.value[1]
        elif pred.op == "LE":
            return pred.value[0] in context and context[pred.value[0]] <= pred.value[1]
        elif pred.op == "EXISTS":
            return pred.value in context
        raise ValueError(f"unknown predicate operator: {pred.op}")


@dataclass(frozen=True, slots=True)
class SemanticVectorContract:
    tag: str
    keyword_min: int
    keyword_max: int
    weight_sum: float
    digest_fields: tuple[str, ...]
    first_prev_md5: str
    trivial_emission: str


@dataclass(frozen=True, slots=True)
class SourceRoute:
    discipline: str
    constraint_class: str
    primary: tuple[str, ...]
    secondary: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SourceRoutingContract:
    tag: str
    alias: str
    ladder: tuple[tuple[str, str], ...]
    generic_web_rule: str
    classes: Mapping[str, str]
    routes: tuple[SourceRoute, ...]


@dataclass(frozen=True, slots=True)
class Edge:
    source: str
    target: str
    kind: str
    condition: str


@dataclass(frozen=True, slots=True)
class Gate:
    id: str
    anchor: str
    name: str
    objective: str
    identities: tuple[str, ...]
    requires: tuple[str, ...]
    outputs: tuple[str, ...]
    shared_rules: tuple[str, ...]
    local_rules: tuple[Rule, ...]
    fsm: StateMachine | None = None


@dataclass(frozen=True, slots=True)
class Protocol:
    id: str
    objective: str
    observed_at: tuple[str, ...]
    returns_to: str
    authority: str
    local_rules: tuple[Rule, ...]
    fsm: StateMachine | None = None


@dataclass(frozen=True, slots=True)
class Identity:
    id: str
    runtime: str
    kind: str
    scope: str


@dataclass(frozen=True, slots=True)
class Kernel:
    name: str
    version: str
    precedence: tuple[str, ...]
    utf8_budget: int
    terms: Mapping[str, str]
    sv_contract: SemanticVectorContract
    source_routing: SourceRoutingContract
    state_fields: Mapping[str, str]
    action_classes: Mapping[str, str]
    initial_state: tuple[str, ...]
    terminals: tuple[str, ...]
    spine: tuple[str, ...]
    edges: tuple[Edge, ...]
    shared_rules: tuple[Rule, ...]
    gates: tuple[Gate, ...]
    protocols: tuple[Protocol, ...]
    identities: tuple[Identity, ...]
    # Outputs that legitimately end the chain — emitted for the user or the record
    # rather than consumed by a later gate. Everything else must have a consumer;
    # see validate_kernel's reverse-reachability check.
    terminal_outputs: frozenset[str] = frozenset()
    # Rules no SELF_MODIFY level may weaken. Marked in place at render time —
    # a separate list in the prose would be a second copy able to drift.
    constitution_core: frozenset[str] = frozenset()
