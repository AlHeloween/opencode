"""Kernel fragment: 05_svm_anchor (former monofile L339-472)."""


@dataclass
class Signal:
    """Incoming information that may confirm or contradict current SV anchor.

    KEY INSIGHT: Cardinality != signal count. 60 identical LSP errors
    from one JSX-resolution bug = 1 effective signal, not 60.
    """
    source: str = ""           # "LSP", "typecheck", "test-output", "user-message"
    pattern: str = ""          # clustered key (e.g. "JSX-unresolved-reference")
    cardinality: int = 1       # how many times repeated
    content: str = ""
    information_mark: Optional[EpistemicStatus] = None

    @property
    def effective_weight(self) -> float:
        """Weight = 1.0 regardless of cardinality. One bug × N lines = 1 signal."""
        return 1.0


@dataclass
class SvmAnchor:
    """Fixed SV at a decision point — the agent's 'I am doing X' state.

    Frozen at phase transitions (plan→design, design→implementation).
    Incoming signals are compared against this anchor, NOT against the
    live conversation state (which may be polluted by noise).
    """
    sv: SemanticVector = field(default_factory=SemanticVector)
    phase: str = ""            # "understanding", "design", "implementation", "verification"
    goal: str = ""
    frozen_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def dominant(self) -> str:
        return self.sv.semantic_dominant

    def l1_distance(self, other: "SvmAnchor") -> float:
        """Δ_L1 between this anchor and another SV."""
        return delta_l1(
            dict(zip(self.sv.keywords, self.sv.weights)),
            dict(zip(other.sv.keywords, other.sv.weights)),
        )


def _same_source_repeated(signal: Signal) -> bool:
    """True when many identical signals originate from a single-source bug.

    Detection heuristics (any one suffices):
    1. Cardinality ≥ 5 — pure volume: 5+ identical (source, pattern) signals
       is suspicious regardless of source type.
    2. Content similarity — all signals share a common prefix ≥ 30 chars.
    3. Known cascade sources — compiler/linter cascades with recognizable
       error patterns.
    """
    if signal.cardinality <= 1:
        return False

    # Heuristic 1: pure cardinality (5+ identical signals → suspect cascade)
    if signal.cardinality >= 5:
        return True

    # Heuristic 2: content similarity (common prefix across signals)
    if len(signal.content) >= 30:
        return True

    # Heuristic 3: known cascade sources + patterns
    cascade_sources = {"LSP", "typecheck", "tsgo", "tsc", "eslint", "pylint",
                       "test-output", "runtime-error", "log"}
    if signal.source not in cascade_sources:
        return False
    cascade_patterns = [
        "expected", "unresolved", "does not exist", "cannot find",
        "Declaration or statement expected", "Expression expected",
        "JSX expressions must have one parent element",
        "KeyError", "AttributeError", "TypeError", "NameError",
    ]
    return any(p.lower() in signal.pattern.lower() for p in cascade_patterns)


def classify_signal(anchor: SvmAnchor, signal: Signal) -> str:
    """Compare incoming signal against frozen anchor.

    Returns:
      'NOISE'        — same-source repeated cascade → 1 effective signal, not N
      'CONFIRMATION' — signal aligns with anchor (Δ_L1 < DELTA_STABLE)
      'DIVERGENCE'   — high delta, genuinely new information → anchor may need revision

    Example (LSP noise):
      anchor = SvmAnchor(sv=build_sv(["DirectoryBrowser","add","component"],
                                      [0.5,0.3,0.2], "Adding DirectoryBrowser"),
                         phase="implementation")
      signal = Signal(source="LSP", pattern="JSX-unresolved-reference",
                      cardinality=60, content="';' expected")
      classify_signal(anchor, signal)  # → 'NOISE'
    """
    # NOISE check FIRST — repeated same-source cascades are noise regardless
    # of delta to anchor. A storm of 60 identical LSP errors is 1 signal.
    if _same_source_repeated(signal):
        return "NOISE"

    sv_signal = build_semantic_vector(
        keywords=[signal.pattern, signal.source],
        weights=[0.7, 0.3],
        dominant=signal.content[:100] if signal.content else signal.pattern,
    )
    d = delta_l1(
        dict(zip(anchor.sv.keywords, anchor.sv.weights)),
        dict(zip(sv_signal.keywords, sv_signal.weights)),
    )

    if d < DELTA_STABLE:
        return "CONFIRMATION"

    return "DIVERGENCE"


def filter_signal_storm(anchor: SvmAnchor, signals: list[Signal]) -> list[Signal]:
    """Cluster signals by (source, pattern). Each cluster = 1 effective signal.

    A storm of 60 identical LSP errors is 1 signal, not 60.
    Noise-classified signals are filtered out.
    Returns only actionable signals (CONFIRMATION + DIVERGENCE).

    Example:
      signals = [60 LSP errors with same pattern]
      anchor = SvmAnchor(...)  # "Adding DirectoryBrowser"
      result = filter_signal_storm(anchor, signals)  # → [] (all noise)
    """
    # Cluster by (source, pattern)
    clusters: dict[tuple[str, str], list[Signal]] = {}
    for s in signals:
        key = (s.source or "unknown", s.pattern or "unknown")
        clusters.setdefault(key, []).append(s)

    effective: list[Signal] = []
    for (src, pat), group in clusters.items():
        representative = Signal(
            source=src,
            pattern=pat,
            cardinality=len(group),
            content=group[0].content,
            information_mark=group[0].information_mark,
        )
        effective.append(representative)

    # Filter: keep only actionable signals
    return [s for s in effective if classify_signal(anchor, s) != "NOISE"]


