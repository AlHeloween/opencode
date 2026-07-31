"""Kernel fragment: 02_info_mark — Epistemic DAG model.

Replaces the legacy 5-float coefficient InformationMark with a dependency-graph
model where each claim is a node with a single ClaimStatus.

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
# ClaimStatus — single enum, not a float distribution
# ---------------------------------------------------------------------------

class ClaimStatus(str):
    """Epistemic status of a claim node. Not a numeric coefficient.

    Order: Unknown < Guess < Hypothetical < Inferred < Exact
    """

    UNKNOWN = "Unknown"
    GUESS = "Guess"
    HYPOTHETICAL = "Hypothetical"
    INFERRED = "Inferred"
    EXACT = "Exact"

    _values = frozenset({UNKNOWN, GUESS, HYPOTHETICAL, INFERRED, EXACT})

    @classmethod
    def from_accuracy(cls, acc: float) -> "ClaimStatus":
        """DEPRECATED: numeric accuracy → status. Use ClaimNode/DAG gates instead.

        Kept for backward compat with old InfoMarkLevel.from_accuracy.
        """
        if acc >= 1.00:
            return cls("Exact")
        elif acc >= 0.75:
            return cls("Inferred")
        elif acc >= 0.50:
            return cls("Hypothetical")
        elif acc >= 0.25:
            return cls("Guess")
        else:
            return cls("Unknown")

    def __new__(cls, value: str) -> "ClaimStatus":
        if value not in cls._values:
            raise ValueError(f"Invalid ClaimStatus: {value!r}. Must be one of {sorted(cls._values)}")
        return str.__new__(cls, value)  # type: ignore[call-overload]

    def __eq__(self, other: object) -> bool:
        if isinstance(other, ClaimStatus):
            return str(self) == str(other)
        if isinstance(other, str):
            return str(self) == other
        return NotImplemented

    def __hash__(self) -> int:
        return hash(str(self))

    def __lt__(self, other: "ClaimStatus") -> bool:
        return _STATUS_ORDER[str(self)] < _STATUS_ORDER[str(other)]

    def __le__(self, other: "ClaimStatus") -> bool:
        return _STATUS_ORDER[str(self)] <= _STATUS_ORDER[str(other)]


_STATUS_ORDER: dict[str, int] = {
    "Unknown": 0,
    "Guess": 1,
    "Hypothetical": 2,
    "Inferred": 3,
    "Exact": 4,
}

# Keep InfoMarkLevel as alias for backward compat
InfoMarkLevel = ClaimStatus


# ---------------------------------------------------------------------------
# ClaimNode — a single epistemic node (replaces InformationMark floats)
# ---------------------------------------------------------------------------

@dataclass
class ClaimNode:
    """Epistemic node in a dependency DAG. Not a float distribution.

    A claim is Exact only within its declared scope and only while its
    verification holds. A failed oracle demotes Exact → Guess.
    """

    id: str = ""
    text: str = ""
    status: ClaimStatus = field(default_factory=lambda: ClaimStatus("Unknown"))
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
        if isinstance(self.status, str) and not isinstance(self.status, ClaimStatus):
            self.status = ClaimStatus(self.status)

    # -- backward-compat: allow destructuring into old float fields --

    @property
    def exact(self) -> float:
        """Backward compat: 1.0 if Exact, else 0.0."""
        return 1.0 if str(self.status) == "Exact" else 0.0

    @property
    def inferred(self) -> float:
        return 1.0 if str(self.status) == "Inferred" else 0.0

    @property
    def hypothetical(self) -> float:
        return 1.0 if str(self.status) == "Hypothetical" else 0.0

    @property
    def guess(self) -> float:
        return 1.0 if str(self.status) == "Guess" else 0.0

    @property
    def unknown(self) -> float:
        return 1.0 if str(self.status) == "Unknown" else 0.0

    @property
    def dominant_level(self) -> ClaimStatus:
        """Backward compat: the status itself."""
        return self.status

    @property
    def accuracy(self) -> float:
        """Backward compat: ordinal rank / max rank."""
        return _STATUS_ORDER[str(self.status)] / 4.0

    # -- legacy dict unpacking compat --

    def as_legacy_dict(self) -> dict[str, Any]:
        """Return a dict compatible with old InformationMark asdict()."""
        return {
            "exact": self.exact,
            "inferred": self.inferred,
            "hypothetical": self.hypothetical,
            "guess": self.guess,
            "unknown": self.unknown,
            "label": self.label,
        }


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
                     _visited: Optional[set[str]] = None) -> ClaimStatus:
    """A claim is at most as strong as its weakest dependency.

    Exact derived from Guess → at most Guess.
    Inferred derived from Hypothetical → at most Hypothetical.

    Cycles are detected and treated as Unknown (circular dependency = broken).
    """
    if _visited is None:
        _visited = set()
    if node.id in _visited:
        # Circular dependency → weakest possible
        return ClaimStatus("Unknown")
    _visited.add(node.id)

    if not node.dependencies:
        return node.status

    dep_statuses: list[ClaimStatus] = []
    for dep_id in node.dependencies:
        dep = dag.nodes.get(dep_id)
        if dep is None:
            # Missing dependency → Unknown
            dep_statuses.append(ClaimStatus("Unknown"))
        else:
            dep_statuses.append(effective_status(dep, dag, _visited.copy()))

    weakest_dep = min(dep_statuses)
    return min(node.status, weakest_dep)


# ---------------------------------------------------------------------------
# Promotion / demotion gates
# ---------------------------------------------------------------------------

PROMOTION_GATES: dict[tuple[str, str], str] = {
    # (from_status, gate) → to_status
    ("Unknown", "web_search_found"): "Guess",
    ("Guess", "code_search_verified"): "Hypothetical",
    ("Hypothetical", "dependencies_inferred"): "Inferred",
    ("Inferred", "oracle_pass"): "Exact",
}


def promote_claim(node: ClaimNode, dag: EpistemicDAG, new_status: ClaimStatus,
                  evidence: str = "") -> ClaimNode:
    """Gated promotion. Returns the (possibly promoted) node.

    Promotion only allowed through defined gates. Direct Unknown→Exact
    without verification is forbidden — always returns Unknown.
    """
    from_s = str(node.status)
    to_s = str(new_status)

    # Find if there's a valid gate
    valid = False
    for (f, gate), t in PROMOTION_GATES.items():
        if f == from_s and t == to_s:
            valid = True
            break

    if not valid and _STATUS_ORDER[to_s] > _STATUS_ORDER[from_s]:
        # Invalid promotion attempt — keep current status
        return node

    node.status = new_status
    if evidence:
        node.evidence = evidence
    node.verified_at = datetime.now(timezone.utc).isoformat()
    return node


def demote_claim(node: ClaimNode, dag: EpistemicDAG, reason: str = "",
                 new_status: Optional[ClaimStatus] = None) -> ClaimNode:
    """Demote a claim and cascade to dependents via weakest-link."""
    if new_status is None:
        # Default demotion: Exact→Guess, anything else→Unknown
        if str(node.status) == "Exact":
            new_status = ClaimStatus("Guess")
        else:
            new_status = ClaimStatus("Unknown")

    node.status = new_status
    if reason:
        node.evidence = f"DEMOTED: {reason}"

    # Cascade: recompute all dependents via weakest-link
    for dependent in dag.dependents_of(node.id):
        new_effective = effective_status(dependent, dag)
        if str(new_effective) != str(dependent.status):
            dependent.status = new_effective

    return node


def verify_claim(node: ClaimNode, dag: EpistemicDAG,
                 oracle_pass: bool, scope: str = "") -> ClaimNode:
    """Oracle gate: PASS → promote to Exact (scoped). FAIL → demote to Guess."""
    if oracle_pass:
        node.status = ClaimStatus("Exact")
        node.scope = scope or node.scope
        node.source = "oracle"
        node.verified_at = datetime.now(timezone.utc).isoformat()
    else:
        # Oracle FAIL — verification broken, demote
        node = demote_claim(node, dag, reason="oracle FAIL", new_status=ClaimStatus("Guess"))
    return node


# ---------------------------------------------------------------------------
# Legacy compatibility: classify_claim_status (adapted to DAG)
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
) -> ClaimStatus:
    """Canonical ADID claim classifier (adapted for DAG model).

    Direct evidence → Exact.
    All premises Exact + derivation → Inferred.
    Falsifier specified → Hypothetical.
    Any evidence → Guess.
    Otherwise → Unknown.

    Weakest-link rule is applied by effective_status() when used within a DAG.
    This function classifies a standalone claim without dependencies.
    """
    try:
        fresh = float(freshness)
    except (TypeError, ValueError):
        fresh = 0.0
    try:
        p_theta = float(parametric_confidence)
    except (TypeError, ValueError):
        p_theta = 0.0

    if has_unresolved_contradiction or fresh <= 0.0:
        return ClaimStatus("Unknown")
    if has_direct_evidence and fresh > 0.0:
        return ClaimStatus("Exact")
    if all_premises_exact and derivation_nonempty:
        return ClaimStatus("Inferred")
    if falsifier_specified:
        return ClaimStatus("Hypothetical")
    if has_any_evidence or p_theta > 0.0:
        return ClaimStatus("Guess")
    return ClaimStatus("Unknown")


def status_after_oracle_pass(*, claim_scope_ok: bool = True, freshness: float = 1.0) -> ClaimStatus:
    """Oracle PASS promotes the verified claim to Exact (scoped).

    Does not promote unrelated claims. Fail / timeout → not Exact (caller demotes).
    """
    try:
        fresh = float(freshness)
    except (TypeError, ValueError):
        fresh = 0.0
    if not claim_scope_ok or fresh <= 0.0:
        return ClaimStatus("Unknown")
    return ClaimStatus("Exact")


# ---------------------------------------------------------------------------
# Confusion matrix — statistical evidence gate (Hypothetical → Inferred)
# ---------------------------------------------------------------------------

def confusion_matrix_validation(tp: int, fp: int, tn: int, fn: int) -> dict[str, Any]:
    """Statistical evidence gate: Hypothetical → Inferred when F1 ≥ 0.8, precision ≥ 0.85.

    Requires real predictive evidence (TP/FP/FN from tests), not mention frequency.
    """
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
    """Salience S(c) ∈ [0,1] from recurrence — attention only, never epistemic status.

    ADID: Salience != Evidence. Mention ratio must not mint Exact/Inferred.
    """
    try:
        r = float(mention_ratio)
    except (TypeError, ValueError):
        return 0.0
    if r < 0.0:
        return 0.0
    if r > 1.0:
        return 1.0
    return r


def promote_information_mark(mention_ratio: float) -> ClaimStatus:
    """DEPRECATED legacy name — mention ratio is salience only.

    Never returns Exact or Inferred. High mention → Guess; zero → Unknown.
    """
    r = salience_from_mention_ratio(mention_ratio)
    if r <= 0.0:
        return ClaimStatus("Unknown")
    return ClaimStatus("Guess")


# ---------------------------------------------------------------------------
# Reverse search
# ---------------------------------------------------------------------------

def reverse_search(claims: list[dict[str, Any]], query: str,
                   min_level: str = "Inferred") -> list[dict[str, Any]]:
    """§I.2 Reverse Search — only Exact and Inferred claims participate (grounding set)."""
    LEVEL_ORDER = {"Exact": 4, "Inferred": 3, "Hypothetical": 2, "Guess": 1, "Unknown": 0}
    min_val = LEVEL_ORDER.get(min_level, 3)
    return [c for c in claims
            if LEVEL_ORDER.get(c.get("level", "Unknown"), 0) >= min_val
            and query.lower() in c.get("text", "").lower()]


# ---------------------------------------------------------------------------
# Legacy InformationMark — backward-compat shim
# ---------------------------------------------------------------------------

@dataclass
class InformationMark:
    """DEPRECATED: use ClaimNode for new code.

    Kept for backward compatibility with existing consumers that unpack
    .exact / .inferred / .hypothetical / .guess / .unknown floats.
    Internally delegates to a ClaimNode.
    """

    exact: float = 0.0
    inferred: float = 0.0
    hypothetical: float = 0.0
    guess: float = 0.0
    unknown: float = 0.0
    label: str = ""

    def __post_init__(self):
        total = self.exact + self.inferred + self.hypothetical + self.guess + self.unknown
        if total > 0:
            self.exact = round(self.exact / total, 4)
            self.inferred = round(self.inferred / total, 4)
            self.hypothetical = round(self.hypothetical / total, 4)
            self.guess = round(self.guess / total, 4)
            self.unknown = round(self.unknown / total, 4)

    @property
    def dominant_level(self) -> ClaimStatus:
        if self.exact == self.inferred == self.hypothetical == self.guess == self.unknown == 0.0:
            return ClaimStatus("Unknown")
        coeffs = [
            (self.exact, ClaimStatus("Exact")), (self.inferred, ClaimStatus("Inferred")),
            (self.hypothetical, ClaimStatus("Hypothetical")), (self.guess, ClaimStatus("Guess")),
            (self.unknown, ClaimStatus("Unknown")),
        ]
        return max(coeffs, key=lambda x: x[0])[1]

    @property
    def accuracy(self) -> float:
        return (
            self.exact * 1.00 + self.inferred * 0.75 + self.hypothetical * 0.50
            + self.guess * 0.25 + self.unknown * 0.00
        )

    def to_claim_node(self) -> ClaimNode:
        """Convert legacy float distribution to a ClaimNode."""
        status = self.dominant_level
        return ClaimNode(
            status=status,
            label=self.label,
        )
