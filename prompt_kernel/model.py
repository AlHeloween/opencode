from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True, slots=True)
class Rule:
    id: str
    owner: str
    text: str


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


@dataclass(frozen=True, slots=True)
class Protocol:
    id: str
    objective: str
    observed_at: tuple[str, ...]
    returns_to: str
    authority: str
    local_rules: tuple[Rule, ...]


@dataclass(frozen=True, slots=True)
class Identity:
    id: str
    runtime: str
    kind: str
    scope: str
    gates: tuple[str, ...]
    may_mutate: bool


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
