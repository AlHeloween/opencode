"""Targeted tests for opencode_prompts_kernel (runtime)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    DisciplineProjection,
    PROMPT_ABI,
    RUNTIME_CONTRACTS,
    RUNTIME_PACKS,
    RUNTIME_RULES,
    RUNTIME_RULE_ALIASES,
    RUNTIME_RULE_OWNERS,
    RUNTIME_TERMS,
    RUNTIME_WORKFLOWS,
    SPEC_CONTRACT_IDS,
    _ALL_SPECS,
    find_duplicate_mapping_keys,
    find_normalized_runtime_rule_duplicates,
    render_runtime_kernel,
    resolve_precedence,
    runtime_kernel_digest,
    validate_runtime_contracts,
    validate_runtime_pack_hierarchy,
    validate_runtime_references,
    validate_runtime_rule_owners,
)

class TestRuntimePromptCompiler:
    """Validate the compact Pythonic runtime dictionary."""

    def test_runtime_kernel_is_deterministic(self):
        first = render_runtime_kernel()
        assert first == render_runtime_kernel()
        assert runtime_kernel_digest()
        assert "\r" not in first

    def test_runtime_kernel_artifact_matches_generator(self):
        root = Path(__file__).resolve().parents[2]
        artifact = root / "packages" / "opencode" / "src" / "session" / "prompt" / "opencode_prompts_kernel.txt"
        if not artifact.is_file():
            pytest.skip("runtime kernel txt not generated (gitignored) — run --render-runtime")
        with open(artifact, encoding="utf-8", newline="") as generated:
            assert generated.read() == render_runtime_kernel()

    def test_runtime_kernel_contains_roots_not_source_only_harness(self):
        runtime = render_runtime_kernel()
        for root in ("PROMPT_ABI", "TERMS", "RULES", "WORKFLOWS", "PACKS", "CONTRACTS"):
            assert root in runtime
        # Source-only symbols must not appear in the Python dictionary section
        # (before the # SPECS marker), but spec names intentionally appear in
        # the rendered SPECS section as ## headers.
        dict_section = runtime.split("# SPECS")[0] if "# SPECS" in runtime else runtime
        for source_only in ("_ALL_SPECS", "DisciplineProjection", "run_conformance"):
            assert source_only not in dict_section

    def test_canonical_source_has_no_duplicate_literal_mapping_keys(self):
        # Scan package fragments (monofile is a CLI shim only).
        pkg = Path(__file__).resolve().parents[2] / "opencode_prompts_kernel"
        combined = "\n".join(p.read_text(encoding="utf-8") for p in sorted(pkg.glob("*.py")))
        assert find_duplicate_mapping_keys(combined) == []

    def test_runtime_rules_have_no_unaliased_normalized_duplicates(self):
        rules = {**RUNTIME_TERMS, **RUNTIME_RULES}
        assert find_normalized_runtime_rule_duplicates(rules, RUNTIME_RULE_ALIASES) == []

    def test_normalized_duplicate_requires_explicit_alias(self):
        rules = {
            "EVIDENCE.ORDER": "Verified reference outranks inference.",
            "EVIDENCE.COPY": " verified-reference outranks inference ",
        }
        assert find_normalized_runtime_rule_duplicates(rules, {})
        assert find_normalized_runtime_rule_duplicates(rules, {"EVIDENCE.COPY": "EVIDENCE.ORDER"}) == []

    def test_normalized_duplicate_output_is_input_order_independent(self):
        first = {
            "B.CANONICAL": "Beta rule.",
            "B.COPY": "beta-rule",
            "A.CANONICAL": "Alpha rule.",
            "A.COPY": "alpha-rule",
        }
        second = dict(reversed(list(first.items())))
        assert find_normalized_runtime_rule_duplicates(first, {}) == find_normalized_runtime_rule_duplicates(second, {})

    def test_runtime_references_resolve_and_reach_every_term(self):
        assert validate_runtime_references(RUNTIME_TERMS, RUNTIME_RULES, RUNTIME_WORKFLOWS, RUNTIME_PACKS) == []

    def test_runtime_rule_ownership_is_complete_and_resolves(self):
        assert validate_runtime_rule_owners(RUNTIME_RULES, RUNTIME_RULE_OWNERS, RUNTIME_TERMS) == []

    def test_runtime_contracts_inventory_every_canonical_spec(self):
        assert validate_runtime_contracts(
            RUNTIME_CONTRACTS, SPEC_CONTRACT_IDS, set(_ALL_SPECS), RUNTIME_TERMS, RUNTIME_RULES,
        ) == []

    def test_runtime_pack_hierarchy_is_acyclic(self):
        assert validate_runtime_pack_hierarchy(RUNTIME_PACKS) == []

    def test_runtime_science_packs_reference_their_explicit_parents(self):
        assert RUNTIME_PACKS["domain.physics"] == ("domain.natural_science",)
        assert RUNTIME_PACKS["domain.chemistry"] == ("domain.natural_science",)
        assert RUNTIME_PACKS["domain.biology"] == ("domain.natural_science",)
        for discipline in ("economics", "psychology", "sociology", "history"):
            assert RUNTIME_PACKS[f"domain.{discipline}"] == ("domain.social_science",)

    def test_agent_prompt_files_reference_generated_contract_ids(self):
        prompts = {
            "coder.txt": "agent.coder", "explore.txt": "agent.explore",
            "general.txt": "agent.general", "media.txt": "agent.media", "orchestrator.txt": "agent.orchestrator",
            "researcher.txt": "agent.researcher", "summary.txt": "agent.summary", "title.txt": "agent.title",
        }
        prompt_dir = (
            Path(__file__).resolve().parents[2] / "packages" / "opencode" / "src" / "agent" / "prompt"
        )
        for filename, contract in prompts.items():
            with open(prompt_dir / filename, encoding="utf-8") as prompt:
                content = prompt.read()
            assert f'CONTRACT = CONTRACTS["{contract}"]' in content
            assert f'PACK = PACKS["{contract}"]' in content
            assert "from opencode_prompts_kernel import" not in content

    def test_runtime_reference_validator_reports_unknown_and_unreachable_entries(self):
        errors = validate_runtime_references(
            {"term": "defined", "orphan": "unreachable"},
            {"RULE": "defined", "ORPHAN.RULE": "unreachable"},
            {"workflow": ("term", "unknown"), "orphan_workflow": ("term",)},
            {"pack": ("workflow", "RULE", "unknown-pack")},
        )
        assert errors == [
            "declaration 'ORPHAN.RULE' is not reachable from a workflow or pack",
            "declaration 'orphan' is not reachable from a workflow or pack",
            "pack 'pack' references unknown declaration, workflow, or pack 'unknown-pack'",
            "workflow 'orphan_workflow' is not reachable from a pack",
            "workflow 'workflow' references unknown declaration 'unknown'",
        ]

    def test_runtime_reference_validator_rejects_duplicate_references(self):
        errors = validate_runtime_references(
            {"term": "defined"},
            {"RULE": "defined"},
            {"workflow": ("term", "term", "RULE", "RULE")},
            {"pack": ("workflow", "workflow")},
        )
        assert errors == [
            "pack 'pack' references 'workflow' more than once",
            "workflow 'workflow' references 'RULE' more than once",
            "workflow 'workflow' references 'term' more than once",
        ]

    def test_runtime_pack_hierarchy_rejects_cycles(self):
        packs = {"first": ("second",), "second": ("first",)}
        assert validate_runtime_pack_hierarchy(packs) == [
            "pack hierarchy cycle: first -> second -> first",
            "pack hierarchy cycle: second -> first -> second",
        ]

    def test_prompt_abi_precedence_is_safety_first(self):
        """Global policy order: safety > governance > task > domain > style."""
        assert PROMPT_ABI["precedence"] == ("safety", "governance", "task", "domain", "style")
        assert PROMPT_ABI["version"] == "5"
        assert PROMPT_ABI["line_endings"] == "LF"
        assert PROMPT_ABI["identity_tier"] == "A"
        assert PROMPT_ABI["identity_max_bytes"] == 48_000

    def test_discipline_packs_form_universal_to_domain_hierarchy(self):
        """universal → natural/social science → discipline packs."""
        assert RUNTIME_PACKS["domain.natural_science"][0] == "universal"
        assert RUNTIME_PACKS["domain.social_science"][0] == "universal"
        assert RUNTIME_PACKS["domain.physics"] == ("domain.natural_science",)
        assert RUNTIME_PACKS["domain.economics"] == ("domain.social_science",)
        # Parent chain reaches universal without cycles
        assert validate_runtime_pack_hierarchy(RUNTIME_PACKS) == []

    def test_contracts_only_reference_shared_keyword_vocabulary(self):
        """Agent/tool contracts compile through TERMS/RULES IDs only."""
        allowed = set(RUNTIME_TERMS) | set(RUNTIME_RULES)
        for contract, refs in RUNTIME_CONTRACTS.items():
            for ref in refs:
                assert ref in allowed, f"{contract} references non-keyword {ref!r}"

    def test_projection_precedence_safety_universal_wins(self):
        from opencode_prompts_kernel import resolve_precedence
        assert resolve_precedence("safety", "UNIVERSAL_SAFETY", "LOCAL_OVERRIDE") == "UNIVERSAL_SAFETY"
        assert resolve_precedence("local_style", "UNIVERSAL_STYLE", "LOCAL_STYLE") == "LOCAL_STYLE"

    def test_runtime_kernel_size_report(self):
        """Tier A identity stays within budget; dict section stays compact."""
        runtime = render_runtime_kernel(tier="A")
        dict_section = runtime.split("# SPECS")[0]
        assert len(dict_section) < 12_000
        assert len(runtime.encode("utf-8")) <= PROMPT_ABI["identity_max_bytes"]
        assert "PROMPT_ABI" in dict_section
        assert "CONTRACTS" in dict_section
        assert "MEMORY.RANK" in runtime
        assert "infomark" in runtime
        # Tier A excludes skill/command SPECS bodies (Tier B surfaces)
        assert "--- Skill Specs" not in runtime
        assert "--- Command Specs" not in runtime
        # Full tier still available offline
        full = render_runtime_kernel(tier="full")
        assert "--- Command Specs" in full

