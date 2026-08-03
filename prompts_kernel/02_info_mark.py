"""Kernel fragment: 02_info_mark — Epistemic DAG model.

Core rules:
  State before reasoning. Decompose before expansion.
  Reference outranks inference. Preserve provenance.
  Do not promote claims without verification.
  Use the weakest dependency as the conclusion ceiling.
  Separate incompatible standards.
  Emit the cleanest verified next state.

Node types:
  Unknown      = empty node
  Guess        = candidate node
  Hypothetical = externally supported phantom node
  Inferred     = dependency-linked derived node
  Exact        = scope-bounded verified node
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

# ---------------------------------------------------------------------------
# EpistemicStatus — single enum for epistemic level
# ---------------------------------------------------------------------------

class EpistemicStatus(str):
    """Epistemic level of a piece of information.

    Order: Unknown < Guess < Hypothetical < Inferred < Exact
    """

    UNKNOWN = "Unknown"
    GUESS = "Guess"
    HYPOTHETICAL = "Hypothetical"
    INFERRED = "Inferred"
    EXACT = "Exact"

    _values = frozenset({UNKNOWN, GUESS, HYPOTHETICAL, INFERRED, EXACT})

    def __new__(cls, value: str) -> "EpistemicStatus":
        if value not in cls._values:
            raise ValueError(f"Invalid EpistemicStatus: {value!r}. Must be one of {sorted(cls._values)}")
        return str.__new__(cls, value)  # type: ignore[call-overload]

    def __eq__(self, other: object) -> bool:
        if isinstance(other, EpistemicStatus):
            return str(self) == str(other)
        if isinstance(other, str):
            return str(self) == other
        return NotImplemented

    def __hash__(self) -> int:
        return hash(str(self))

    def __lt__(self, other: "EpistemicStatus") -> bool:
        return _STATUS_ORDER[str(self)] < _STATUS_ORDER[str(other)]

    def __le__(self, other: "EpistemicStatus") -> bool:
        return _STATUS_ORDER[str(self)] <= _STATUS_ORDER[str(other)]


_STATUS_ORDER: dict[str, int] = {
    "Unknown": 0,
    "Guess": 1,
    "Hypothetical": 2,
    "Inferred": 3,
    "Exact": 4,
}


# ---------------------------------------------------------------------------
# ClaimNode — a single epistemic node
# ---------------------------------------------------------------------------

@dataclass
class ClaimNode:
    """Epistemic node in a dependency DAG.

    A claim is Exact only within its declared scope and only while its
    verification holds. A failed oracle demotes Exact → Guess.
    """

    id: str = ""
    text: str = ""
    status: EpistemicStatus = field(default_factory=lambda: EpistemicStatus("Unknown"))
    scope: str = ""                      # what this claim is bounded to
    dependencies: list[str] = field(default_factory=list)  # IDs this depends on
    evidence: str = ""                   # what supports this claim
    falsifier: str = ""                  # what would disprove it
    source: str = ""                     # "oracle" | "code_search" | "web_search" | "inference"
    verified_at: str = ""                # ISO timestamp
    label: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = uuid.uuid4().hex[:12]
        if isinstance(self.status, str) and not isinstance(self.status, EpistemicStatus):
            self.status = EpistemicStatus(self.status)


# ---------------------------------------------------------------------------
# EpistemicDAG — the graph
# ---------------------------------------------------------------------------

@dataclass
class EpistemicDAG:
    """Collection of ClaimNodes with dependency edges."""

    nodes: dict[str, ClaimNode] = field(default_factory=dict)

    def add(self, node: ClaimNode) -> None:
        self.nodes[node.id] = node

    def remove(self, node_id: str) -> None:
        self.nodes.pop(node_id, None)

    def dependencies_of(self, node_id: str) -> list[ClaimNode]:
        """Direct dependencies of a node."""
        node = self.nodes.get(node_id)
        if node is None:
            return []
        return [self.nodes[dep] for dep in node.dependencies if dep in self.nodes]

    def dependents_of(self, node_id: str) -> list[ClaimNode]:
        """All nodes that depend on node_id."""
        return [n for n in self.nodes.values() if node_id in n.dependencies]

    def roots(self) -> list[ClaimNode]:
        """Nodes with no dependencies (externally sourced)."""
        return [n for n in self.nodes.values() if not n.dependencies]

    def derived(self) -> list[ClaimNode]:
        """Nodes with at least one dependency."""
        return [n for n in self.nodes.values() if n.dependencies]


# ---------------------------------------------------------------------------
# CORE RULE: weakest-link ceiling
# ---------------------------------------------------------------------------

def effective_status(node: ClaimNode, dag: EpistemicDAG,
                     _visited: Optional[set[str]] = None) -> EpistemicStatus:
    """A claim is at most as strong as its weakest dependency.

    Exact derived from Guess → at most Guess.
    Cycles are detected and treated as Unknown (circular dependency = broken).
    """
    if _visited is None:
        _visited = set()
    if node.id in _visited:
        return EpistemicStatus("Unknown")
    _visited.add(node.id)

    if not node.dependencies:
        return node.status

    dep_statuses: list[EpistemicStatus] = []
    for dep_id in node.dependencies:
        dep = dag.nodes.get(dep_id)
        if dep is None:
            dep_statuses.append(EpistemicStatus("Unknown"))
        else:
            dep_statuses.append(effective_status(dep, dag, _visited.copy()))

    weakest_dep = min(dep_statuses)
    return min(node.status, weakest_dep)


# ---------------------------------------------------------------------------
# Promotion / demotion gates
# ---------------------------------------------------------------------------

PROMOTION_GATES: dict[tuple[str, str], str] = {
    ("Unknown", "web_search_found"): "Guess",
    ("Guess", "code_search_verified"): "Hypothetical",
    ("Hypothetical", "dependencies_inferred"): "Inferred",
    ("Inferred", "oracle_pass"): "Exact",
}


def promote_claim(node: ClaimNode, dag: EpistemicDAG, new_status: EpistemicStatus,
                  evidence: str = "") -> ClaimNode:
    """Gated promotion. Returns the (possibly promoted) node.

    Promotion only allowed through defined gates. Direct Unknown→Exact
    without verification is forbidden.
    """
    from_s = str(node.status)
    to_s = str(new_status)

    valid = False
    for (f, gate), t in PROMOTION_GATES.items():
        if f == from_s and t == to_s:
            valid = True
            break

    if not valid and _STATUS_ORDER[to_s] > _STATUS_ORDER[from_s]:
        return node

    node.status = new_status
    if evidence:
        node.evidence = evidence
    node.verified_at = datetime.now(timezone.utc).isoformat()
    return node


def demote_claim(node: ClaimNode, dag: EpistemicDAG, reason: str = "",
                 new_status: Optional[EpistemicStatus] = None) -> ClaimNode:
    """Demote a claim and cascade to dependents via weakest-link."""
    if new_status is None:
        if str(node.status) == "Exact":
            new_status = EpistemicStatus("Guess")
        else:
            new_status = EpistemicStatus("Unknown")

    node.status = new_status
    if reason:
        node.evidence = f"DEMOTED: {reason}"

    for dependent in dag.dependents_of(node.id):
        new_effective = effective_status(dependent, dag)
        if str(new_effective) != str(dependent.status):
            dependent.status = new_effective

    return node


def verify_claim(node: ClaimNode, dag: EpistemicDAG,
                 oracle_pass: bool, scope: str = "") -> ClaimNode:
    """Oracle gate: PASS → promote to Exact (scoped). FAIL → demote to Guess."""
    if oracle_pass:
        node.status = EpistemicStatus("Exact")
        node.scope = scope or node.scope
        node.source = "oracle"
        node.verified_at = datetime.now(timezone.utc).isoformat()
    else:
        node = demote_claim(node, dag, reason="oracle FAIL", new_status=EpistemicStatus("Guess"))
    return node


# ---------------------------------------------------------------------------
# classify_claim_status — standalone claim classifier (no DAG)
# ---------------------------------------------------------------------------

def classify_claim_status(
    *,
    has_unresolved_contradiction: bool = False,
    freshness: float = 1.0,
    has_direct_evidence: bool = False,
    all_premises_exact: bool = False,
    derivation_nonempty: bool = False,
    falsifier_specified: bool = False,
    has_any_evidence: bool = False,
    parametric_confidence: float = 0.0,
) -> EpistemicStatus:
    """Classify a standalone claim without dependency context.

    Direct evidence → Exact.
    All premises Exact + derivation → Inferred.
    Falsifier specified → Hypothetical.
    Any evidence → Guess.
    Otherwise → Unknown.

    For dependency-aware classification, use effective_status() with a DAG.
    """
    try:
        fresh = float(freshness)
    except (TypeError, ValueError):
        fresh = 0.0

    if has_unresolved_contradiction or fresh <= 0.0:
        return EpistemicStatus("Unknown")
    if has_direct_evidence and fresh > 0.0:
        return EpistemicStatus("Exact")
    if all_premises_exact and derivation_nonempty:
        return EpistemicStatus("Inferred")
    if falsifier_specified:
        return EpistemicStatus("Hypothetical")
    if has_any_evidence or parametric_confidence > 0.0:
        return EpistemicStatus("Guess")
    return EpistemicStatus("Unknown")


def status_after_oracle_pass(*, claim_scope_ok: bool = True, freshness: float = 1.0) -> EpistemicStatus:
    """Oracle PASS promotes the verified claim to Exact (scoped)."""
    try:
        fresh = float(freshness)
    except (TypeError, ValueError):
        fresh = 0.0
    if not claim_scope_ok or fresh <= 0.0:
        return EpistemicStatus("Unknown")
    return EpistemicStatus("Exact")


# ---------------------------------------------------------------------------
# Confusion matrix — statistical evidence gate
# ---------------------------------------------------------------------------

def confusion_matrix_validation(tp: int, fp: int, tn: int, fn: int) -> dict[str, Any]:
    """Statistical evidence: Hypothetical → Inferred when F1 ≥ 0.8, precision ≥ 0.85."""
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0)
    promoted = (f1 >= 0.8 and precision >= 0.85)
    return {
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4),
        "promoted": promoted,
        "new_level": "Inferred" if promoted else "Hypothetical",
    }


# ---------------------------------------------------------------------------
# Salience — attention only, never epistemic status
# ---------------------------------------------------------------------------

def salience_from_mention_ratio(mention_ratio: float) -> float:
    """Salience S(c) ∈ [0,1] from recurrence — attention only, never epistemic."""
    try:
        r = float(mention_ratio)
    except (TypeError, ValueError):
        return 0.0
    if r < 0.0:
        return 0.0
    if r > 1.0:
        return 1.0
    return r


# ---------------------------------------------------------------------------
# Reverse search
# ---------------------------------------------------------------------------

def reverse_search(claims: list[dict[str, Any]], query: str,
                   min_level: str = "Inferred") -> list[dict[str, Any]]:
    """Only Exact and Inferred claims participate in grounding set."""
    level_order = {"Exact": 4, "Inferred": 3, "Hypothetical": 2, "Guess": 1, "Unknown": 0}
    min_val = level_order.get(min_level, 3)
    return [c for c in claims
            if level_order.get(c.get("level", "Unknown"), 0) >= min_val
            and query.lower() in c.get("text", "").lower()]


# ---------------------------------------------------------------------------
# inference_stamp — system-stamped Inferred claims (v6)
# ---------------------------------------------------------------------------
# Previously: only oracle_stamp existed (→ Exact). Inferred had no system
# stamp, making it formally unreachable as a Grounding Set member.
# v6 adds inference_stamp: when all dependencies are grounded (Exact|Inferred)
# AND a derivation rule is declared AND the derivation hash matches,
# the claim is system-stamped Inferred — valid for G (grounding set).


@dataclass
class InferenceStamp:
    """System stamp that promotes a claim to Inferred via validated derivation.

    Unlike oracle_stamp (which requires external PASS/FAIL),
    inference_stamp validates that all dependencies are grounded and
    the derivation is reproducible.
    """
    claim_id: str = ""
    derivation_rule: str = ""        # e.g. "R17", "transitive_closure", "type_inference"
    dependencies: list[str] = field(default_factory=list)
    dependency_effective_status: str = ""  # weakest among deps (must be ≥ Inferred)
    derivation_hash: str = ""        # deterministic hash of derivation inputs
    stamped_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    result: str = ""                 # "VALID" | "INVALID"

    def is_valid(self, dag: EpistemicDAG) -> bool:
        """Check that all dependencies are grounded and derivation is sound."""
        if not self.dependencies:
            return False
        if not self.derivation_rule:
            return False
        if self.result != "VALID":
            return False

        # All dependencies must be ≥ Inferred (grounded)
        dep_statuses: list[EpistemicStatus] = []
        for dep_id in self.dependencies:
            dep = dag.nodes.get(dep_id)
            if dep is None:
                return False
            eff = effective_status(dep, dag)
            dep_statuses.append(eff)

        weakest = min(dep_statuses)
        if str(weakest) not in ("Inferred", "Exact"):
            return False

        self.dependency_effective_status = str(weakest)
        return True


def stamp_inferred(
    node: ClaimNode,
    dag: EpistemicDAG,
    stamp: InferenceStamp,
) -> ClaimNode:
    """Apply inference_stamp → promote to Inferred if valid.

    Preconditions (all must hold):
      1. All dependencies are grounded (≥ Inferred effective_status)
      2. A derivation rule is declared
      3. The derivation hash matches
      4. stamp.result == "VALID"

    This is the missing piece: system-stamped Inferred claims can now
    participate in Grounding Set G alongside Exact claims.
    """
    if not stamp.is_valid(dag):
        return node

    stamp.claim_id = node.id
    stamp.stamped_at = datetime.now(timezone.utc).isoformat()

    node.status = EpistemicStatus("Inferred")
    node.source = f"inference::{stamp.derivation_rule}"
    node.evidence = f"stamp:{stamp.derivation_hash[:12]}"
    node.verified_at = stamp.stamped_at

    return node


def compute_inference_hash(
    dependencies: list[str],
    rule: str,
    inputs: dict[str, Any],
) -> str:
    """Deterministic hash of inference inputs for reproducibility."""
    import hashlib
    import json
    canonical = json.dumps({
        "deps": sorted(dependencies),
        "rule": rule,
        "inputs": dict(sorted(inputs.items())),
    }, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]
