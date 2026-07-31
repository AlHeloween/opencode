"""Kernel fragment: 03_semantic_vector (former monofile L259-297)."""


@dataclass
class SemanticVector:
    """§III Keyword-weight pairs with normalized weights.
    Two hash domains: md5_msg_tag (content provenance), md5_sv_tag (semantic anchor).
    """
    keywords: list[str] = field(default_factory=list)
    weights: list[float] = field(default_factory=list)
    semantic_dominant: str = ""

    def __post_init__(self):
        if self.weights and sum(self.weights) > 0:
            total = sum(self.weights)
            self.weights = [round(w / total, 4) for w in self.weights]

    def canonical_string(self) -> str:
        """Canonical SV: dominant=<d>|k1:w1|k2:w2|... (keys sorted)."""
        pairs = sorted(zip(self.keywords, self.weights), key=lambda x: x[0])
        parts = [f"dominant={self.semantic_dominant}"]
        parts.extend(f"{k}:{w}" for k, w in pairs)
        return "|".join(parts)

    def md5_sv_tag(self) -> str:
        """Semantic anchor checksum from canonical SV string."""
        return hashlib.md5(self.canonical_string().encode("utf-8")).hexdigest()


def build_semantic_vector(keywords: list[str], weights: list[float],
                          dominant: str = "") -> SemanticVector:
    """Build and auto-normalize a SemanticVector."""
    return SemanticVector(keywords=keywords, weights=weights, semantic_dominant=dominant)


def md5_msg_tag(content: str) -> str:
    """Message provenance hash — TAB, LF, CR, SPACE stripped before hash."""
    stripped = "".join(c for c in content if c not in "\t\n\r ")
    return hashlib.md5(stripped.encode("utf-8")).hexdigest()


