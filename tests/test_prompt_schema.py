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
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from opencode_prompts_kernel import (
    validate_prompt_file,
    _SPEC_FIELDS,
)
from opencode_prompts_kernel import build_conformance_suite

# ======================================================================
# Paths
# ======================================================================

SESSION_PROMPT_DIR = os.path.join(PROJECT_ROOT, "packages/opencode/src/session/prompt")
AGENT_PROMPT_DIR = os.path.join(PROJECT_ROOT, "packages/opencode/src/agent/prompt")
SKILL_DIRS = [
    os.path.join(PROJECT_ROOT, "packages/opencode/src/skill"),
    os.path.join(PROJECT_ROOT, ".cursor/skills"),
]
RULE_DIRS = [
    os.path.join(PROJECT_ROOT, ".opencode/rules"),
    os.path.join(PROJECT_ROOT, ".cursor/rules"),
]

# Files to exclude from validation
EXCLUDED_FILES = {
    "opencode_prompts_kernel.txt",  # Python kernel — not a prompt file
    "reasoning.txt",                 # Reference document, not instructions
    "max-steps.txt",                 # Trivial mode switch
    "build-switch.txt",             # Trivial mode switch
    "test_agent.txt",               # Test fixture
    "generate.txt",                 # Agent generation prompt
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
    excluded_dirs = {".git", ".opencode", "external", "node_modules"}

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
            if "node_modules" not in fp and ".opencode" not in fp and "external" not in fp:
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

        # Special: compaction.txt is not referenced
        orphans = prompt_files - referenced_files - {"compaction.txt"}
        assert not orphans, (
            f"Orphaned agent prompt files (in agent/prompt/ but not referenced "
            f"by any agent): {orphans}. Each prompt file must have a corresponding "
            f"PROMPT_ import and assignment in agent.ts."
        )
    else:
        pytest.skip("agent.ts not found, skipping import test")


def test_compaction_prompt_is_wired():
    """Compaction agent must have a prompt field pointing to compaction.txt."""
    agent_def_path = os.path.join(PROJECT_ROOT, "packages/opencode/src/agent/agent.ts")
    if not os.path.isfile(agent_def_path):
        agent_def_path = os.path.join(PROJECT_ROOT, "packages/opencode/src/agent/agent-registry.ts")

    if os.path.isfile(agent_def_path):
        with open(agent_def_path, "r", encoding="utf-8") as f:
            agent_src = f.read()

        # Find compaction agent definition
        # Check if PROMPT_COMPACTION is imported
        has_import = "PROMPT_COMPACTION" in agent_src
        # Check if compaction agent uses this prompt
        has_prompt = "compaction" in agent_src and "prompt:" in agent_src or "prompt" in agent_src and "compaction" in agent_src

        # More precise: find the compaction agent block using brace depth
        # (Simple regex doesn't handle nested braces from Permission.merge(...))
        match = re.search(r'compaction\s*:', agent_src)
        if match:
            start = match.start()
            # Scan forward, tracking brace depth to find the full block
            depth = 0
            i = start
            in_block = False
            while i < len(agent_src):
                if agent_src[i] == '{':
                    depth += 1
                    in_block = True
                elif agent_src[i] == '}':
                    depth -= 1
                    if in_block and depth == 0:
                        block = agent_src[start:i+1]
                        has_prompt = "prompt:" in block
                        break
                i += 1

        # If compaction agent exists but has no prompt field, fail
        if "compaction" in agent_src and not has_prompt:
            pytest.fail(
                "Compaction agent has no prompt field. Add 'prompt: PROMPT_COMPACTION' "
                "to the compaction agent definition in agent.ts, and import "
                "PROMPT_COMPACTION from './prompt/compaction.txt'."
            )
    else:
        pytest.skip("agent.ts not found, skipping")


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
    from opencode_prompts_kernel import run_conformance
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
    required_agent = {"coder.txt", "explore.txt", "orchestrator.txt", "compaction.txt"}

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
