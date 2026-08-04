"""Kernel fragment: 13_bug_fix (former monofile L1072-1255)."""

# Depends on safe_truncate from 05_svm_anchor (shared kernel namespace).


class BugFixProtocol:
    """§XIV Formal verification procedure for bug fixes.
    Chain: error_test -> trial_fix -> real_fix -> verify. Each step gates the next.
    """

    def __init__(self, bug_description: str):
        self.bug_description = bug_description
        self._error_test_fn: Optional[Callable] = None
        self._trial_fix_fn: Optional[Callable] = None
        self._real_fix_fn: Optional[Callable] = None

    def create_error_test(self, test_fn: Callable) -> None:
        """Step 1: Create error test that exactly reproduces the bug (must FAIL)."""
        self._error_test_fn = test_fn
        result = test_fn()
        if result is not False:
            raise InvariantError("Error test must reproduce the bug (must FAIL on buggy code).")

    def create_trial_fix(self, fix_fn: Callable) -> None:
        """Step 2: Trial fix — must PASS the error test."""
        if self._error_test_fn is None:
            raise InvariantError("Must create error test before trial fix")
        self._trial_fix_fn = fix_fn
        fix_fn()
        if self._error_test_fn() is not True:
            raise InvariantError("Trial fix must pass the error test")

    def create_real_fix(self, fix_fn: Callable) -> None:
        """Step 3: Real fix — must still pass the error test."""
        if self._trial_fix_fn is None:
            raise InvariantError("Must create trial fix before real fix")
        self._real_fix_fn = fix_fn
        fix_fn()
        if self._error_test_fn() is not True:
            raise InvariantError("Real fix must pass the error test")

    def verify(self, full_test_suite: Callable) -> bool:
        """Step 4: Bug is fixed only after full verification suite passes."""
        if self._real_fix_fn is None:
            raise InvariantError("Must create real fix before verification")
        if full_test_suite() is not True:
            raise InvariantError("Full test suite must pass for bug fix to be verified")
        return True


@dataclass
class BugFixAttempt:
    """Single fix attempt with its own SV for drift detection."""
    attempt_number: int = 0
    sv: SemanticVector = field(default_factory=SemanticVector)
    approach: str = ""          # description of what was tried
    result: str = ""            # "PASS", "FAIL", "PARTIAL"
    delta_from_anchor: float = 0.0
    classification: str = ""    # "PROGRESS", "STUCK", "DIVERGING"
    information_mark: Optional[EpistemicStatus] = None


class BugFixSVMTracker:
    """§XIV-b SVM-anchored bug fix tracker — prevents fix deadloops.

    Anchors the bug fix SV at the start and compares each attempt's SV
    against the anchor. Detects STUCK patterns (same approach, no progress)
    and DIVERGENCE (drifting into unrelated changes).

    Real-world example (SGLang connection pool bug):
      Anchor: "Fix connection pool leak in v2.1.2"
      Attempt 1: same approach → STUCK
      Attempt 2: same approach → STUCK
      Attempt 3: same approach → STUCK + DEADLOOP
      → Escalate: search repo notes → found "fixed in beta v2.1.3"
      → Exit deadloop: upgrade version, don't fix unfixable code
    """

    MAX_ATTEMPTS_DEFAULT: int = 3
    STUCK_THRESHOLD: float = 0.3     # Δ_L1 ≤ DELTA_STABLE → same approach
    REFINING_THRESHOLD: float = 0.5  # Δ_L1 ≤ DELTA_SHIFT → converging

    def __init__(self, bug_description: str, max_attempts: int = 3):
        self.anchor = SVMAnchor(
            sv=build_semantic_vector(
                keywords=[w for w in bug_description.lower().split() if len(w) > 2][:5],
                weights=[0.2] * min(5, len(bug_description.split())),
                dominant=safe_truncate(bug_description, 100),
            ),
            phase="bug_fix",
            goal=bug_description,
        )
        self.max_attempts = max_attempts
        self.attempts: list[BugFixAttempt] = []
        self._deadloop: bool = False

    def record_attempt(self, approach: str, result: str,
                       sv_keywords: Optional[list[str]] = None) -> BugFixAttempt:
        """Record a fix attempt and classify its SV drift from anchor.

        Returns the classified attempt. Raises RuntimeError if deadloop detected.
        """
        n = len(self.attempts) + 1
        if sv_keywords:
            attempt_sv = build_semantic_vector(
                keywords=sv_keywords,
                weights=[1.0 / len(sv_keywords)] * len(sv_keywords),
                dominant=safe_truncate(approach, 100),
            )
        else:
            attempt_sv = build_semantic_vector(
                keywords=[safe_truncate(approach, 20)],
                weights=[1.0],
                dominant=safe_truncate(approach, 100),
            )

        d = delta_l1(
            dict(zip(self.anchor.sv.keywords, self.anchor.sv.weights)),
            dict(zip(attempt_sv.keywords, attempt_sv.weights)),
        )

        if d < self.STUCK_THRESHOLD:
            classification = "STUCK"
        elif d < self.REFINING_THRESHOLD:
            classification = "REFINING"
        else:
            classification = "DIVERGING"

        attempt = BugFixAttempt(
            attempt_number=n,
            sv=attempt_sv,
            approach=approach,
            result=result,
            delta_from_anchor=round(d, 4),
            classification=classification,
            information_mark=EpistemicStatus("Inferred"),
        )
        self.attempts.append(attempt)

        if self._detect_deadloop():
            self._deadloop = True
            raise RuntimeError(
                f"DEADLOOP DETECTED after {n} attempts. "
                f"Last {self._consecutive_stuck()} attempts classified STUCK "
                f"(Δ < {self.STUCK_THRESHOLD}). "
                f"Anchor: '{self.anchor.dominant}'. "
                f"ESCALATE: search external evidence (repo notes, version history, "
                f"beta releases, forums) before attempting another fix."
            )

        return attempt

    def _consecutive_stuck(self) -> int:
        """Count trailing STUCK attempts."""
        count = 0
        for a in reversed(self.attempts):
            if a.classification == "STUCK":
                count += 1
            else:
                break
        return count

    def _detect_deadloop(self) -> bool:
        """Deadloop: ≥2 STUCK in last 3 attempts (sliding window).

        Sliding window catches STUCK→REFINING→STUCK patterns that
        consecutive-only detection would miss. The agent is cycling
        through minor variations of the same broken approach.
        """
        if len(self.attempts) < self.max_attempts:
            return False
        recent = self.attempts[-3:]
        stuck_count = sum(1 for a in recent if a.classification == "STUCK")
        return stuck_count >= 2

    @property
    def is_deadloop(self) -> bool:
        return self._deadloop

    @property
    def summary(self) -> str:
        if not self.attempts:
            return f"No attempts yet. Anchor: '{self.anchor.dominant}'"
        last = self.attempts[-1]
        return (
            f"Bug fix: {len(self.attempts)}/{self.max_attempts} attempts. "
            f"Last: {last.classification} (Δ={last.delta_from_anchor:.3f}). "
            f"Deadloop: {self._deadloop}"
        )


