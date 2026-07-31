"""Kernel fragment: 02_info_mark (former monofile L181-255)."""


@dataclass
class InformationMark:
    """
    §I.2 Epistemic status with coefficient distribution.
    Every claim carries its verifiability level as a normalized 5-vector.
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
    def dominant_level(self) -> InfoMarkLevel:
        if self.exact == self.inferred == self.hypothetical == self.guess == self.unknown == 0.0:
            return InfoMarkLevel.UNKNOWN
        coeffs = [
            (self.exact, InfoMarkLevel.EXACT), (self.inferred, InfoMarkLevel.INFERRED),
            (self.hypothetical, InfoMarkLevel.HYPOTHETICAL), (self.guess, InfoMarkLevel.GUESS),
            (self.unknown, InfoMarkLevel.UNKNOWN),
        ]
        return max(coeffs, key=lambda x: x[0])[1]

    @property
    def accuracy(self) -> float:
        return (
            self.exact * 1.00 + self.inferred * 0.75 + self.hypothetical * 0.50
            + self.guess * 0.25 + self.unknown * 0.00
        )


def confusion_matrix_validation(tp: int, fp: int, tn: int, fn: int) -> dict[str, Any]:
    """§I.2 Promotion: Hypothetical -> Inferred when precision, recall, F1 meet thresholds.

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


def promote_information_mark(mention_ratio: float) -> InfoMarkLevel:
    """DEPRECATED legacy name — mention ratio is **salience only**.

    Never returns Exact or Inferred (parametric/recurrence is not evidence).
    High mention → Guess at most; zero/negative → Unknown.
    Prefer: classify_claim_status(...), confusion_matrix_validation(...),
    status_after_oracle_pass() for real promotion.
    """
    r = salience_from_mention_ratio(mention_ratio)
    if r <= 0.0:
        return InfoMarkLevel.UNKNOWN
    return InfoMarkLevel.GUESS


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
) -> InfoMarkLevel:
    """Canonical ADID claim classifier (evidence + freshness; no salience argument).

    Direct evidence kinds: measurement, reproducible test/oracle, terminal output,
    primary source, inspected source code — in declared scope and freshness > 0.
    Parametric confidence alone never yields Exact or Inferred.
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
        return InfoMarkLevel.UNKNOWN
    if has_direct_evidence and fresh > 0.0:
        return InfoMarkLevel.EXACT
    if all_premises_exact and derivation_nonempty:
        return InfoMarkLevel.INFERRED
    if falsifier_specified:
        return InfoMarkLevel.HYPOTHETICAL
    if has_any_evidence or p_theta > 0.0:
        return InfoMarkLevel.GUESS
    return InfoMarkLevel.UNKNOWN


def status_after_oracle_pass(*, claim_scope_ok: bool = True, freshness: float = 1.0) -> InfoMarkLevel:
    """Oracle PASS promotes the **verified claim** to Exact (scoped).

    Does not promote unrelated claims. Fail / timeout → not Exact (caller demotes).
    claim_scope_ok=False or stale freshness → Unknown (do not mint Exact).
    """
    try:
        fresh = float(freshness)
    except (TypeError, ValueError):
        fresh = 0.0
    if not claim_scope_ok or fresh <= 0.0:
        return InfoMarkLevel.UNKNOWN
    return InfoMarkLevel.EXACT


def reverse_search(claims: list[dict[str, Any]], query: str,
                   min_level: str = "Inferred") -> list[dict[str, Any]]:
    """§I.2 Reverse Search — only Exact and Inferred claims participate (grounding set)."""
    LEVEL_ORDER = {"Exact": 4, "Inferred": 3, "Hypothetical": 2, "Guess": 1, "Unknown": 0}
    min_val = LEVEL_ORDER.get(min_level, 3)
    return [c for c in claims
            if LEVEL_ORDER.get(c.get("level", "Unknown"), 0) >= min_val
            and query.lower() in c.get("text", "").lower()]


