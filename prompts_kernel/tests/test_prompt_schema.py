"""
test_prompt_schema.py — Validate all prompt/instruction files against PromptSpec schema.

Ensures every AI instruction file in the project uses the structured spec format
(intent/state/scope/constraints/invariants/forbidden_actions/acceptance_tests)
instead of unstructured prose. Prevents the compaction-style template-drift bug.
"""

import os
import re
import sys
import pytest

# Add project root to path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

from prompts_kernel import (
    validate_prompt_file,
    _SPEC_FIELDS,
)
from prompts_kernel import build_conformance_suite

# ======================================================================
# Paths
# ======================================================================

SESSION_PROMPT_DIR = os.path.join(PROJECT_ROOT, "packages/opencode/src/session/prompt")
AGENT_PROMPT_DIR = os.path.join(PROJECT_ROOT, "packages/opencode/src/agent/prompt")
SKILL_DIRS = [
    os.path.join(PROJECT_ROOT, "packages/opencode/src/skill"),
]
RULE_DIRS: list[str] = []

# Files to exclude from validation
# Pocket protocols / mode synthetics use algorithm-with-comments density, not PromptSpec YAML.
EXCLUDED_FILES = {
    "prompts_kernel.txt",  # Generated Pythonic SPECS — not a prompt file
    "reasoning.txt",                # Lean REASONING PROTOCOL (algorithm + comments)
    "algorithm_card.txt",           # ALGORITHM_CARD task geometry (algorithm + comments)
    "build.txt",                    # Build mode conversation-tail synthetic (KV-safe)
    "reasoning-mode.txt",           # Reasoning mode conversation-tail synthetic (KV-safe)
    "max-steps.txt",                # Trivial mode switch
    "build-switch.txt",             # Plan→build conversation-tail synthetic
    "test_agent.txt",               # Test fixture
    "generate.txt",                 # Agent generation prompt
    "deepseek.txt",                 # Intentional no-override family stub (empty body after frontmatter)
}

# Session pocket protocols that must exist and bind to kernel / each other
POCKET_PROTOCOL_FILES = {
    # Agentic pocket grew with gates + claim_ledger + research ladder (still algorithm density).
    "reasoning.txt": (
        "REASONING PROTOCOL",
        "ALGORITHM_CARD",
        "claim_ledger",
        "REUSE_BEFORE",
        "universalsearch",
        "GATE 4",
        "oracle_stamp",
    ),
    "algorithm_card.txt": ("ALGORITHM_CARD", "run_task_geometry", "select_fractal_model"),
    "build.txt": ("Build mode", "ALGORITHM_CARD", "conversation tail"),
}

# Soft budget for pocket protocol files (bytes). reasoning includes full gates + InfoMark.
# v6: raised to accommodate ExecutionEnvelope, inference_stamp, COLLAPSED_DUPLICATES,
# action_class expansion, adaptive_depth evidence_coverage formula.
# v6.0: raised 36_000→42_000 for envelope schema, classifier rewrite, fractal dispatcher
# orthogonality_score, CLARA bound, adaptive_k edge cases, Gate 9 expansion,
# canonical serialization note, UNKNOWN_ACTIVITY fail-closed, capability principals.
POCKET_PROTOCOL_MAX_BYTES = {
    "reasoning.txt": 42_000,
    "algorithm_card.txt": 14_000,
    "build.txt": 12_000,
}

# Rule files are external package docs (ADID framework) synced from upstream —
# not authored in this repo, not subject to internal PromptSpec schema.
EXCLUDED_RULES = {
    "adid-framework-and-adm.mdc",
    "adid-rag.mdc",
    "semantic-coding-agent-drop-in.mdc",
}

# ======================================================================
# Helpers
# ======================================================================


def find_all_prompt_files():
    """Yield all prompt/instruction files that should conform to PromptSpec."""
    found = []
    excluded_dirs = {".git", ".opencode", "external", "node_modules", ".temp", "temp", "dist", "coverage"}

    # Session prompt files
    if os.path.isdir(SESSION_PROMPT_DIR):
        for f in sorted(os.listdir(SESSION_PROMPT_DIR)):
            if f.endswith(".txt") and f not in EXCLUDED_FILES:
                found.append(("session_prompt", os.path.join(SESSION_PROMPT_DIR, f)))

    # Agent prompt files
    if os.path.isdir(AGENT_PROMPT_DIR):
        for f in sorted(os.listdir(AGENT_PROMPT_DIR)):
            if f.endswith(".txt") and f not in EXCLUDED_FILES:
                found.append(("agent_prompt", os.path.join(AGENT_PROMPT_DIR, f)))

    # Skill files (SKILL.md)
    for skill_dir in SKILL_DIRS:
        if os.path.isdir(skill_dir):
            for root, dirs, files in os.walk(skill_dir):
                dirs[:] = [directory for directory in dirs if directory not in excluded_dirs]
                if "SKILL.md" in files:
                    fp = os.path.join(root, "SKILL.md")
                    if "node_modules" not in fp:
                        found.append(("skill", fp))

    # Rule files (.mdc) — skip external ADID framework docs
    for rule_dir in RULE_DIRS:
        if os.path.isdir(rule_dir):
            for f in sorted(os.listdir(rule_dir)):
                if f.endswith(".mdc") and f not in EXCLUDED_RULES:
                    found.append(("rule", os.path.join(rule_dir, f)))

    # AGENTS.md files
    for root, dirs, files in os.walk(PROJECT_ROOT):
        dirs[:] = [directory for directory in dirs if directory not in excluded_dirs]
        if "AGENTS.md" in files:
            fp = os.path.join(root, "AGENTS.md")
            if (
                "node_modules" not in fp
                and ".opencode" not in fp
                and "external" not in fp
                and ".temp" not in fp
                and os.sep + "temp" + os.sep not in fp
            ):
                found.append(("agents_md", fp))

    return found


def file_has_spec_sections(content):
    """Quick check if content contains structured spec sections."""
    markers = [
        "intent:", "state:", "scope:", "constraints:",
        "invariants:", "forbidden_actions:", "acceptance_tests:",
    ]
    lower = content.lower()
    return sum(1 for m in markers if m in lower)


def file_is_structured(content):
    """Check if file has at least 4 of the 7 required spec sections."""
    markers = [
        "intent:", "state:", "scope:", "constraints:",
        "invariants:", "forbidden_actions:", "acceptance_tests:",
    ]
    lower = content.lower()
    count = sum(1 for m in markers if m in lower)
    return count >= 4


# ======================================================================
# Tests
# ======================================================================


def test_all_prompt_files_have_structure():
    """Every prompt/instruction file must have structured spec sections."""
    failures = []
    for ftype, fp in find_all_prompt_files():
        with open(fp, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        errors = validate_prompt_file(fp, content)
        if errors:
            failures.append((fp, errors))

    if failures:
        msg_parts = []
        for fp, errs in failures:
            rel = os.path.relpath(fp, PROJECT_ROOT)
            msg_parts.append(f"\n  {rel}:")
            for e in errs:
                msg_parts.append(f"    - {e}")
        pytest.fail("\n".join(msg_parts))


@pytest.mark.parametrize("ftype,fp", find_all_prompt_files(), ids=lambda x: os.path.basename(x) if isinstance(x, str) else x)
def test_individual_prompt_file(ftype, fp):
    """Each prompt file individually must pass schema validation."""
    with open(fp, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    errors = validate_prompt_file(fp, content)
    rel = os.path.relpath(fp, PROJECT_ROOT)
    assert not errors, f"{rel}: {'; '.join(errors)}"


def test_session_prompt_files_structured():
    """Session prompt files (loaded into every conversation) MUST be structured."""
    session_dir = SESSION_PROMPT_DIR
    if not os.path.isdir(session_dir):
        pytest.skip("Session prompt directory not found")

    failures = []
    for f in sorted(os.listdir(session_dir)):
        if not f.endswith(".txt") or f in EXCLUDED_FILES:
            continue
        fp = os.path.join(session_dir, f)
        with open(fp, "r", encoding="utf-8", errors="replace") as content_file:
            content = content_file.read()
        if not file_is_structured(content):
            failures.append(f)

    assert not failures, (
        f"Session prompt files missing structure: {failures}. "
        "Convert to PromptSpec format (intent/state/scope/constraints/invariants/"
        "forbidden_actions/acceptance_tests)."
    )


@pytest.mark.parametrize("ftype,fp", [
    (ftype, fp) for ftype, fp in find_all_prompt_files()
    if ftype == "skill"
], ids=lambda x: os.path.basename(x) if isinstance(x, str) else x)
def test_skill_files_structured(ftype, fp):
    """SKILL.md files must follow structured spec format."""
    with open(fp, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()
    errors = validate_prompt_file(fp, content)
    rel = os.path.relpath(fp, PROJECT_ROOT)
    assert not errors, f"{rel}: {'; '.join(errors)}"


def test_no_orphaned_agent_prompts():
    """Every file in agent/prompt/ must be referenced by an agent definition."""
    if not os.path.isdir(AGENT_PROMPT_DIR):
        pytest.skip("Agent prompt directory not found")

    prompt_files = set()
    for f in os.listdir(AGENT_PROMPT_DIR):
        if f.endswith(".txt") and f not in EXCLUDED_FILES:
            prompt_files.add(f)

    agent_def_path = os.path.join(PROJECT_ROOT, "packages/opencode/src/agent/agent.ts")
    if not os.path.isfile(agent_def_path):
        agent_def_path = os.path.join(PROJECT_ROOT, "packages/opencode/src/agent/agent-registry.ts")

    if os.path.isfile(agent_def_path):
        with open(agent_def_path, "r", encoding="utf-8") as f:
            agent_src = f.read()

        # Find all PROMPT_ references
        prompt_refs = set(re.findall(r'prompt:\s*(PROMPT_\w+)', agent_src))
        # Map PROMPT_XXX to xxx.txt
        referenced_files = set()
        for ref in prompt_refs:
            name = ref.replace("PROMPT_", "").lower()
            referenced_files.add(f"{name}.txt")
            referenced_files.add(name + ".txt")

        orphans = prompt_files - referenced_files
        assert not orphans, (
            f"Orphaned agent prompt files (in agent/prompt/ but not referenced "
            f"by any agent): {orphans}. Each prompt file must have a corresponding "
            f"PROMPT_ import and assignment in agent.ts."
        )
    else:
        pytest.skip("agent.ts not found, skipping import test")


def test_build_has_no_agent_prompt_system_bind():
    """plan/build mode text must not live in agent.prompt (KV: conversation tail only)."""
    agent_def_path = os.path.join(PROJECT_ROOT, "packages/opencode/src/agent/agent.ts")
    if not os.path.isfile(agent_def_path):
        pytest.skip("agent.ts not found")
    with open(agent_def_path, "r", encoding="utf-8") as f:
        src = f.read()
    assert "PROMPT_BUILD" not in src
    # build agent block must not set prompt: (mode text is session/prompt/build.txt synthetic)
    # Match the build: { ... } object without pulling later agents
    m = re.search(r"build:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}", src, re.DOTALL)
    assert m, "build agent definition not found"
    assert "prompt:" not in m.group(1)


def test_pocket_protocol_files_exist_and_markers():
    """REASONING / ALGORITHM_CARD / build synthetic are pocket density, not PromptSpec."""
    for name, markers in POCKET_PROTOCOL_FILES.items():
        fp = os.path.join(SESSION_PROMPT_DIR, name)
        assert os.path.isfile(fp), f"missing pocket protocol: {name}"
        with open(fp, "r", encoding="utf-8") as f:
            content = f.read()
        max_bytes = POCKET_PROTOCOL_MAX_BYTES.get(name, 12_000)
        assert len(content) < max_bytes, f"{name} grew past pocket size ({len(content)} bytes; max {max_bytes})"
        for marker in markers:
            assert marker in content, f"{name} missing marker {marker!r}"


def test_algorithm_card_binds_to_kernel_symbols():
    """ALGORITHM_CARD names must resolve on prompts_kernel (hybrid bind)."""
    import prompts_kernel as kernel

    card_path = os.path.join(SESSION_PROMPT_DIR, "algorithm_card.txt")
    with open(card_path, "r", encoding="utf-8") as f:
        card = f.read()

    # Symbols the card must name; no Mode-1 / select_planning_mode
    implemented = [
        "k_medoids_modifications",
        "select_fractal_model",
        "select_medoids_tasks",
        "lsystem_rewrite",
    ]
    planned = [
        "run_task_geometry",
    ]
    for name in implemented:
        assert name in card, f"algorithm_card.txt should name {name}"
        assert hasattr(kernel, name) and callable(getattr(kernel, name)), (
            f"kernel missing callable {name}"
        )
    for name in planned:
        assert name in card, f"algorithm_card.txt should name {name}"
    assert "select_planning_mode" not in card
    assert "linear_seeds" not in card
    assert 'mode == "mode_1"' not in card
    assert "PLANNING" in card and "PLANNING" in kernel._ALL_SPECS
    assert kernel._ALL_SPECS["PLANNING"]["constraints"].get("linear_mode_1_forbidden") is True
    assert kernel._ALL_SPECS["PLANNING"]["constraints"].get("fractal_geometry_required") is True


def test_algorithm_card_matches_renderer():
    """On-disk algorithm_card.txt must match render_algorithm_card() output."""
    import prompts_kernel as kernel

    card_path = os.path.join(SESSION_PROMPT_DIR, "algorithm_card.txt")
    with open(card_path, "r", encoding="utf-8") as f:
        on_disk = f.read()

    generated = kernel.render_algorithm_card()
    assert on_disk == generated, (
        "algorithm_card.txt is stale. Run:\n"
        "  python -c \"from prompts_kernel import write_algorithm_card; "
        'write_algorithm_card(\'packages/opencode/src/session/prompt/algorithm_card.txt\')\"'
    )



def test_kernel_conformance_suite():
    """The reasoning kernel conformance suite must pass."""
    suite = build_conformance_suite()
    failures = []
    for test in suite:
        if not test.execute():
            failures.append(f"{test.name}: {test.description}")
    assert not failures, f"Conformance failures: {'; '.join(failures)}"


def test_kernel_specs_conformant():
    """All kernel project specs must validate."""
    # This validates the _ALL_SPECS dict has all required fields
    # Import and run the conformance function
    from prompts_kernel import run_conformance
    # run_conformance prints but doesn't raise — we just check no ValueError
    try:
        run_conformance()
    except ValueError as e:
        pytest.fail(f"Kernel spec validation failed: {e}")


def test_prompt_file_count():
    """At minimum, certain key prompt files must exist and be structured."""
    session_dir = SESSION_PROMPT_DIR
    agent_dir = AGENT_PROMPT_DIR

    required_session = {"default.txt", "anthropic.txt", "gemini.txt", "gpt.txt"}
    required_agent = {"coder.txt", "explore.txt", "orchestrator.txt"}

    missing_session = set()
    for f in required_session:
        fp = os.path.join(session_dir, f)
        if not os.path.isfile(fp):
            missing_session.add(f)
        else:
            with open(fp, "r", encoding="utf-8", errors="replace") as content_file:
                content = content_file.read()
            if not file_is_structured(content):
                missing_session.add(f"{f} (unstructured)")

    missing_agent = set()
    for f in required_agent:
        fp = os.path.join(agent_dir, f)
        if not os.path.isfile(fp):
            missing_agent.add(f)

    msg = []
    if missing_session:
        msg.append(f"Session prompts missing/structuring required: {missing_session}")
    if missing_agent:
        msg.append(f"Agent prompts missing: {missing_agent}")

    assert not msg, "; ".join(msg)
