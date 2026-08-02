"""Targeted tests for prompts_kernel (syntax)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    SYNTAX_FORMATS,
    SYNTAX_PROJECTION,
    TREESITTER_GRAMMARS,
    _SPEC_FIELDS,
    render_field_to_format,
    resolve_syntax,
)

class TestSyntaxProjection:
    """Validate the kernel-to-format syntax projection layer."""

    def test_all_seven_fields_have_projections(self):
        """All 7 spec fields must have entries in SYNTAX_PROJECTION."""
        for field in _SPEC_FIELDS:
            assert field in SYNTAX_PROJECTION, f"Missing projection for field: {field}"

    def test_all_fields_have_kernel_syntax(self):
        """Every projected field must have a 'kernel' entry."""
        for field in _SPEC_FIELDS:
            assert "kernel" in SYNTAX_PROJECTION[field], (
                f"{field} missing kernel syntax template"
            )

    def test_all_fields_have_agent_txt(self):
        """Every projected field must have an '.agent.txt' entry."""
        for field in _SPEC_FIELDS:
            assert ".agent.txt" in SYNTAX_PROJECTION[field], (
                f"{field} missing .agent.txt syntax template"
            )

    def test_all_fields_have_session_txt(self):
        """Every projected field must have an '.session.txt' entry."""
        for field in _SPEC_FIELDS:
            assert ".session.txt" in SYNTAX_PROJECTION[field], (
                f"{field} missing .session.txt syntax template"
            )

    def test_all_fields_have_mdc(self):
        """Every projected field must have an '.mdc' entry."""
        for field in _SPEC_FIELDS:
            assert ".mdc" in SYNTAX_PROJECTION[field], (
                f"{field} missing .mdc syntax template"
            )

    def test_all_fields_have_agents_md(self):
        """Every projected field must have an 'AGENTS.md' entry."""
        for field in _SPEC_FIELDS:
            assert "AGENTS.md" in SYNTAX_PROJECTION[field], (
                f"{field} missing AGENTS.md syntax template"
            )

    def test_inverse_map_completeness(self):
        """SYNTAX_FORMATS inverse map must contain all formats."""
        expected_formats = {"kernel", ".agent.txt", ".session.txt", ".mdc",
                           "AGENTS.md", ".txt.plan"}
        for fmt in expected_formats:
            assert fmt in SYNTAX_FORMATS, (
                f"Missing format in SYNTAX_FORMATS: {fmt}"
            )

    def test_all_fields_have_agents_md(self):
        """Every projected field must have an 'AGENTS.md' entry."""
        for field in _SPEC_FIELDS:
            assert "AGENTS.md" in SYNTAX_PROJECTION[field], (
                f"{field} missing AGENTS.md syntax template"
            )

    def test_inverse_map_completeness(self):
        """SYNTAX_FORMATS inverse map must contain all formats."""
        expected_formats = {"kernel", ".agent.txt", ".session.txt", ".mdc",
                           "AGENTS.md", ".txt.plan"}
        for fmt in expected_formats:
            assert fmt in SYNTAX_FORMATS, (
                f"Missing format in SYNTAX_FORMATS: {fmt}"
            )

    def test_inverse_map_field_count(self):
        """Each format in SYNTAX_FORMATS must have all 7 fields."""
        # .txt.plan is a minimal format (plan mode only needs intent)
        exempt = {".txt.plan"}
        for fmt, fields in SYNTAX_FORMATS.items():
            if fmt in exempt:
                continue
            missing = _SPEC_FIELDS - set(fields.keys())
            assert not missing, (
                f"Format '{fmt}' missing fields: {missing}"
            )

    def test_tree_sitter_grammars_defined(self):
        """Tree-sitter grammar mapping must have entries for all key formats."""
        required = {".agent.txt", ".session.txt", ".mdc",
                    "AGENTS.md", "kernel", "agent.ts"}
        for fmt in required:
            assert fmt in TREESITTER_GRAMMARS, (
                f"Missing tree-sitter grammar for format: {fmt}"
            )

    def test_grammar_names_valid(self):
        """Tree-sitter grammar names should be known parsers."""
        valid = {"markdown", "yaml", "python", "typescript", "json"}
        for fmt, grammar in TREESITTER_GRAMMARS.items():
            assert grammar in valid, (
                f"Unknown grammar '{grammar}' for format '{fmt}'. "
                f"Valid: {valid}"
            )

    def test_resolve_syntax_found(self):
        """resolve_syntax() returns correct template for known field+format."""
        template = resolve_syntax("intent", ".agent.txt")
        assert template is not None
        assert "intent:" in template

    def test_resolve_syntax_not_found(self):
        """resolve_syntax() returns None for unknown field."""
        assert resolve_syntax("nonexistent_field", ".agent.txt") is None

    def test_resolve_syntax_unknown_format(self):
        """resolve_syntax() returns None for unknown format."""
        assert resolve_syntax("intent", ".unknown.format") is None

    def test_render_field_string(self):
        """render_field_to_format() renders string values."""
        field = "intent"
        value = "Test intent description"
        # Get the .session.txt template
        template = resolve_syntax(field, ".session.txt")
        assert template is not None
        # Should contain value somewhere
        result = render_field_to_format(field, value, ".session.txt")
        assert result is not None
        assert value in result

    def test_render_field_list(self):
        """render_field_to_format() renders list values."""
        result = render_field_to_format("forbidden_actions",
                                         ["no x", "no y", "no z"],
                                         ".session.txt")
        assert result is not None
        assert "- no x" in result
        assert "- no y" in result
        assert "- no z" in result

    def test_render_unknown_field(self):
        """render_field_to_format() returns None for unknown field."""
        result = render_field_to_format("unknown", ["test"], ".session.txt")
        assert result is None

    def test_render_unknown_format(self):
        """render_field_to_format() returns None for unknown format."""
        result = render_field_to_format("intent", "test", ".unknown")
        assert result is None

