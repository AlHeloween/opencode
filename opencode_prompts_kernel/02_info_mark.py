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
    """§I.2 Promotion: Hypothetical -> Inferred when precision, recall, F1 meet thresholds."""
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


def promote_information_mark(mention_ratio: float) -> InfoMarkLevel:
    """§I.2 Promotion by mention frequency r(c)."""
    if mention_ratio >= 0.4: return InfoMarkLevel.EXACT
    elif mention_ratio >= 0.3: return InfoMarkLevel.INFERRED
    elif mention_ratio >= 0.2: return InfoMarkLevel.HYPOTHETICAL
    elif mention_ratio >= 0.1: return InfoMarkLevel.GUESS
    else: return InfoMarkLevel.UNKNOWN


def reverse_search(claims: list[dict[str, Any]], query: str,
                   min_level: str = "Inferred") -> list[dict[str, Any]]:
    """§I.2 Reverse Search — only Exact and Inferred claims participate."""
    LEVEL_ORDER = {"Exact": 4, "Inferred": 3, "Hypothetical": 2, "Guess": 1, "Unknown": 0}
    min_val = LEVEL_ORDER.get(min_level, 3)
    return [c for c in claims
            if LEVEL_ORDER.get(c.get("level", "Unknown"), 0) >= min_val
            and query.lower() in c.get("text", "").lower()]


