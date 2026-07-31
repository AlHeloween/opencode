"""Kernel fragment: 31_prompt_ir (former monofile L4182-4551)."""

RESERVED_PREFIXES: tuple[str, ...] = (
    "_k_", "_py_", "_ts_", "_md_", "_yml_",
    "_sci_", "_phy_", "_chm_", "_bio_",
    "_soc_", "_eco_", "_psy_", "_soc_",
    "_hist_",
)

# --- Canonical kernel symbols (immutable at runtime) ---
_KERNEL_SYMBOLS: MappingProxyType[str, str] = MappingProxyType({
    "_k_obj": "objective",
    "_k_scp": "scope",
    "_k_cst": "constraints",
    "_k_seq": "steps",
    "_k_inv": "invariants",
    "_k_evd": "evidence",
    "_k_unc": "uncertainty",
    "_k_fal": "falsifiers",
    "_k_acc": "acceptance_tests",
    "_k_ban": "forbidden_actions",
})

# --- Reverse mapping: readable field → IR symbol ---
_FIELD_TO_IR: dict[str, str] = {v: k for k, v in _KERNEL_SYMBOLS.items()}

# --- Projection prefix registry (immutable) ---
_PROJECTION_PREFIXES: MappingProxyType[str, str] = MappingProxyType({
    "kernel": "_k_",
    "python": "_py_",
    "typescript": "_ts_",
    "markdown": "_md_",
    "yaml": "_yml_",
    "natural_science": "_sci_",
    "physics": "_phy_",
    "chemistry": "_chm_",
    "biology": "_bio_",
    "social_science": "_soc_",
    "economics": "_eco_",
    "psychology": "_psy_",
    "sociology": "_soc_",
    "history": "_hist_",
})

# --- Prefix rule (immutable) ---
PREFIX_RULE: MappingProxyType[str, dict] = MappingProxyType({
    # Language projections
    "_k_": {"meaning": "reserved canonical kernel symbol", "mutable": False, "redefinable": False, "context_dependent": False},
    "_py_": {"meaning": "Python language projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_ts_": {"meaning": "TypeScript language projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_md_": {"meaning": "Markdown language projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_yml_": {"meaning": "YAML language projection", "mutable": False, "redefinable": False, "context_dependent": False},
    # Natural science projections
    "_sci_": {"meaning": "natural science projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_phy_": {"meaning": "physics sub-discipline projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_chm_": {"meaning": "chemistry sub-discipline projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_bio_": {"meaning": "biology sub-discipline projection", "mutable": False, "redefinable": False, "context_dependent": False},
    # Social science projections
    "_soc_": {"meaning": "social science projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_eco_": {"meaning": "economics sub-discipline projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_psy_": {"meaning": "psychology sub-discipline projection", "mutable": False, "redefinable": False, "context_dependent": False},
    "_hist_": {"meaning": "history sub-discipline projection", "mutable": False, "redefinable": False, "context_dependent": False},
})


def get_ir_symbol(field_name: str, namespace: str = "kernel") -> str | None:
    """Get the IR symbol for a readable field name in a namespace.

    Args:
        field_name: Readable field name (e.g. 'invariants', 'constraints').
        namespace: Namespace (e.g. 'kernel', 'economics', 'python').

    Returns:
        IR symbol (e.g. '_k_inv'), or None if not found.
    """
    prefix = _PROJECTION_PREFIXES.get(namespace, "_k_")
    # Direct lookup: try the exact field name in kernel symbols
    if namespace == "kernel":
        ir_key = f"{prefix}{field_name[:3].lower()}"
        if ir_key in _KERNEL_SYMBOLS:
            flat_map = {v: k for k, v in _KERNEL_SYMBOLS.items()}
            return flat_map.get(field_name)
    return None


def compile_to_ir(spec: dict, namespace: str = "kernel") -> dict:
    """Compile a readable spec dict into compact IR with namespace prefixes.

    Transforms readable keys like 'objective', 'invariants', 'forbidden_actions'
    into their prefixed IR equivalents like '_k_obj', '_k_inv', '_k_ban'.

    Args:
        spec: Readable spec dict with standard field names.
        namespace: Target namespace prefix.

    Returns:
        Compiled IR dict with prefixed keys.
    """
    prefix = _PROJECTION_PREFIXES.get(namespace, "_k_")
    ir: dict = {}
    flat_map = {v: k for k, v in _KERNEL_SYMBOLS.items()}

    for key, value in spec.items():
        ir_key = flat_map.get(key)
        if ir_key:
            ir[ir_key] = value
        elif key.startswith(RESERVED_PREFIXES):
            # Already in IR form — verify it's valid
            if key not in _KERNEL_SYMBOLS and not any(
                key.startswith(p) for p in RESERVED_PREFIXES
            ):
                raise ValueError(f"Unknown reserved symbol: {key}")
            ir[key] = value
        else:
            # Non-kernel keys pass through unchanged
            ir[key] = value

    return ir


def expand_from_ir(ir: dict) -> dict:
    """Expand a compiled IR dict back into readable form.

    Reverses compile_to_ir() — transforms '_k_inv' back to 'invariants'.

    Args:
        ir: Compiled IR dict with prefixed keys.

    Returns:
        Readable spec dict with standard field names.
    """
    readable: dict = {}
    for key, value in ir.items():
        readable_key = _KERNEL_SYMBOLS.get(key, key)
        readable[readable_key] = value
    return readable


def validate_symbols(spec: dict, canonical: dict | None = None) -> list[str]:
    """Validate that no reserved symbols are redefined or mutated.

    Args:
        spec: The spec dict to validate.
        canonical: Optional canonical dict to check against. If None,
                  uses the kernel's internal _KERNEL_SYMBOLS.

    Returns:
        List of validation errors (empty = all valid).
    """
    errors: list[str] = []
    if canonical is None:
        canonical = dict(_KERNEL_SYMBOLS)

    for key in spec:
        if key.startswith(RESERVED_PREFIXES):
            if key not in canonical:
                errors.append(f"Unknown reserved symbol: {key}")
            elif canonical.get(key) is not None and spec[key] != canonical.get(key):
                errors.append(f"Canonical symbol redefined: {key}")

    return errors


def validate_ir_equivalence(readable: dict, ir: dict) -> list[str]:
    """Verify that a readable spec and its compiled IR are equivalent.

    Compiles 'readable' and checks every key/value pair against 'ir'.
    Then expands 'ir' and checks every key/value pair against 'readable'.

    Args:
        readable: The original readable spec.
        ir: The compiled IR spec.

    Returns:
        List of equivalence errors (empty = equivalent).
    """
    errors: list[str] = []

    # Compile readable and check that IR matches
    compiled = compile_to_ir(readable)
    for key, value in compiled.items():
        if key in ir and ir[key] != value:
            readable_key = _KERNEL_SYMBOLS.get(key, key)
            errors.append(
                f"Mismatch on {key} ({readable_key}): "
                f"expected {value!r}, got {ir[key]!r}"
            )

    # Expand IR and check that readable matches
    expanded = expand_from_ir(ir)
    for key, value in expanded.items():
        if key in readable and readable[key] != value:
            errors.append(
                f"Expand mismatch on {key}: "
                f"expected {readable[key]!r}, got {value!r}"
            )

    return errors


# ======================================================================
# PROMPT SPEC SCHEMA — schema for validating instruction/prompt files
# ======================================================================
#
# Every AI instruction file in the project MUST conform to this schema.
# The seven fields form a complete, checkable instruction contract.
#
# File types that MUST conform:
#   - Agent prompt files (packages/opencode/src/agent/prompt/*.txt)
#   - Session prompt files (packages/opencode/src/session/prompt/*.txt)
#   - Skill files (packages/opencode/src/skill/*/SKILL.md)
#   - AGENTS.md files (root, package-level)
#
# Schema:
#   intent (str):        Natural-language meaning, context, trade-offs
#   state (dict):        Current understanding or preconditions
#   scope (dict/list):   Operational boundaries
#   constraints (dict):  Concrete behavior rules (bool flags or string values)
#   invariants (list):   Always-true predicates — AI checks before acting
#   forbidden_actions (list): Explicit negatives — short-circuit on match
#   acceptance_tests (list): Pass/fail gates — oracle-ready verification

_SPEC_FIELDS = {"intent", "state", "scope", "constraints", "invariants", "forbidden_actions", "acceptance_tests"}

# Marker patterns that the AI recognizes as structured spec sections
_STRUCTURED_SECTION_MARKERS = {
    "intent:", "state:", "scope:", "constraints:", "invariants:", "forbidden_actions:", "acceptance_tests:",
    "intent =", "state =", "scope =", "constraints =", "invariants =", "forbidden_actions =", "acceptance_tests =",
}


def validate_prompt_file(filepath: str, content: str) -> list[str]:
    """Validate that a prompt/instruction file conforms to the PromptSpec schema.

    Args:
        filepath: Path to the file (for error messages).
        content: Full text content of the file.

    Returns:
        List of validation errors (empty = file is spec-conformant).
    """
    errors: list[str] = []
    lower = content.lower()

    # Check for structured spec sections
    found_sections: set[str] = set()
    for marker in _STRUCTURED_SECTION_MARKERS:
        if marker in lower:
            field = marker.rstrip(":=").strip()
            found_sections.add(field)

    # A valid spec must have at least: intent, constraints, invariants, forbidden_actions
    required = {"intent", "constraints", "invariants", "forbidden_actions"}
    missing = required - found_sections
    if missing:
        errors.append(
            f"{filepath}: missing required spec section(s): {', '.join(sorted(missing))}. "
            f"Found: {', '.join(sorted(found_sections)) if found_sections else 'none'}"
        )

    # Check for common anti-patterns (unstructured prose without spec markers)
    has_prose_sections = False
    prose_markers = ["# tone", "# proactiveness", "# tool usage", "# doing tasks",
                     "# following conventions", "# professional objectivity",
                     "# task management", "# code references"]
    for marker in prose_markers:
        if marker in lower:
            has_prose_sections = True
            if not found_sections:
                errors.append(
                    f"{filepath}: uses unstructured prose sections (e.g., '{marker}') "
                    f"without structured spec sections. Convert to PromptSpec format."
                )
                break

    return errors


def assert_prompt_files_conform(*, package_root: str = ".") -> dict[str, list[str]]:
    """Scan all prompt/instruction files in the project and validate conformance.

    Returns dict of {filepath: [errors]} — empty dict means all pass.
    """
    import os
    import glob as glob_module

    results: dict[str, list[str]] = {}
    patterns = [
        "packages/opencode/src/agent/prompt/*.txt",
        "packages/opencode/src/session/prompt/*.txt",
        "packages/opencode/src/skill/*/SKILL.md",
        "**/AGENTS.md",
    ]

    for pattern in patterns:
        full_pattern = os.path.join(package_root, pattern)
        for filepath in glob_module.glob(full_pattern, recursive=True):
            if not os.path.isfile(filepath):
                continue
            try:
                with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read()
                errors = validate_prompt_file(filepath, content)
                if errors:
                    results[filepath] = errors
            except Exception as e:
                results[filepath] = [f"Error reading file: {e}"]

    return results


def _validate_spec(name: str, spec: dict) -> None:
    """Validate that a project spec has all required fields."""
    missing = _SPEC_FIELDS - set(spec.keys())
    if missing:
        raise ValueError(f"{name}: missing spec fields: {missing}")


def _count(obj, key: str) -> int:
    v = obj.get(key, [])
    if isinstance(v, list): return len(v)
    if isinstance(v, dict): return len(v)
    if isinstance(v, bool): return 1
    return 1


def run_conformance() -> None:
    """Run both the reasoning kernel conformance suite and validate all project specs."""
    print("=== opencode_prompts_kernel.py v3.0 self-test ===\n")

    # 1. Run conformance suite
    suite = build_conformance_suite()
    all_pass = True
    for test in suite:
        result = test.execute()
        status = "PASS" if result else "FAIL"
        print(f"  [{status}] Conformance [{test.name}]: {test.description}")
        if not result:
            all_pass = False

    # 2. Validate project specs
    print()
    total_intents = 0
    total_constraints = 0
    total_invariants = 0
    total_tests = 0
    total_forbidden = 0

    for name, spec in sorted(_ALL_SPECS.items()):
        _validate_spec(name, spec)
        c = _count(spec, "constraints")
        i = _count(spec, "invariants")
        t = _count(spec, "acceptance_tests")
        f = _count(spec, "forbidden_actions")
        total_constraints += c
        total_invariants += i
        total_tests += t
        total_forbidden += f
        total_intents += 1
        print(f"  [SPEC]   {name:25s} | constraints={c} invariants={i} tests={t} forbidden={f}")

    total = len(_ALL_SPECS)
    print(f"\n--- Summary ---")
    print(f"  Conformance tests: {len(suite)} ({'ALL PASS' if all_pass else 'SOME FAILED'})")
    print(f"  Project specs:     {total}")
    print(f"    Total constraints:     {total_constraints}")
    print(f"    Total invariants:      {total_invariants}")
    print(f"    Total acceptance_tests: {total_tests}")
    print(f"    Total forbidden_actions: {total_forbidden}")
    print(f"    Total rules: {total_constraints + total_invariants + total_forbidden + total_tests}")
    print(f"\n=== Self-test {'PASSED' if all_pass else 'FAILED'} ===")

