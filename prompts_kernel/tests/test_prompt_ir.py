"""Targeted tests for prompts_kernel (prompt ir)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    PREFIX_RULE,
    RESERVED_PREFIXES,
    _FIELD_TO_IR,
    _KERNEL_SYMBOLS,
    _PROJECTION_PREFIXES,
    compile_to_ir,
    expand_from_ir,
    validate_ir_equivalence,
    validate_symbols,
)

class TestPromptIR:
    """Validate immutable namespace prefix IR compilation system."""

    def test_kernel_symbols_count(self):
        """_KERNEL_SYMBOLS has 10 entries."""
        assert len(_KERNEL_SYMBOLS) == 10

    def test_kernel_symbols_immutable(self):
        """_KERNEL_SYMBOLS should raise TypeError on mutation attempt."""
        with pytest.raises(TypeError):
            _KERNEL_SYMBOLS["_k_new"] = "new_field"  # type: ignore

    def test_all_prefixes_in_rule(self):
        """Every reserved prefix has a rule entry."""
        for prefix in RESERVED_PREFIXES:
            assert prefix in PREFIX_RULE, f"Missing prefix rule: {prefix}"

    def test_prefix_rules_not_mutable(self):
        """All prefix rules mark mutable=False."""
        for prefix, rule in PREFIX_RULE.items():
            assert rule["mutable"] is False, f"{prefix} marked as mutable"
            assert rule["redefinable"] is False, f"{prefix} marked as redefinable"

    def test_compile_to_ir_converts_invariants(self):
        """compile_to_ir converts 'invariants' to '_k_inv'."""
        result = compile_to_ir({"invariants": ["must balance"]})
        assert "_k_inv" in result
        assert result["_k_inv"] == ["must balance"]
        assert "invariants" not in result

    def test_compile_to_ir_converts_all_kernel_fields(self):
        """compile_to_ir converts all known kernel field names."""
        readable = {
            "objective": "test",
            "scope": "global",
            "constraints": ["c1"],
            "steps": ["s1"],
            "invariants": ["i1"],
            "evidence": ["e1"],
            "uncertainty": {"type": "sampling"},
            "falsifiers": ["f1"],
            "acceptance_tests": ["a1"],
            "forbidden_actions": ["b1"],
        }
        ir = compile_to_ir(readable)
        for ir_key in _KERNEL_SYMBOLS:
            assert ir_key in ir, f"Missing IR key: {ir_key}"

    def test_compile_to_ir_preserves_non_kernel_keys(self):
        """Non-kernel keys pass through unchanged."""
        result = compile_to_ir({"custom_key": "custom_value"})
        assert result["custom_key"] == "custom_value"

    def test_expand_from_ir_reverses_compile(self):
        """expand_from_ir reverses compile_to_ir."""
        original = {"invariants": ["must balance"], "constraints": ["must be safe"]}
        ir = compile_to_ir(original)
        expanded = expand_from_ir(ir)
        assert expanded == original

    def test_compile_expand_roundtrip_preserves_non_kernel(self):
        """Non-kernel keys survive compile→expand roundtrip."""
        original = {"language": "python", "version": "3.13"}
        ir = compile_to_ir(original)
        expanded = expand_from_ir(ir)
        assert expanded == original

    def test_validate_symbols_accepts_good_spec(self):
        """validate_symbols returns no errors for valid spec with matching values."""
        # Use canonical values that match _KERNEL_SYMBOLS
        spec = {"_k_inv": "invariants", "_k_obj": "objective"}
        errors = validate_symbols(spec, dict(_KERNEL_SYMBOLS))
        assert len(errors) == 0

    def test_validate_symbols_rejects_unknown(self):
        """validate_symbols rejects unknown reserved symbols."""
        spec = {"_k_unknown": "value"}
        errors = validate_symbols(spec, dict(_KERNEL_SYMBOLS))
        assert len(errors) > 0
        assert any("Unknown reserved" in e for e in errors)

    def test_validate_symbols_rejects_redefinition(self):
        """validate_symbols rejects redefinition of canonical symbols."""
        spec = {"_k_inv": "wrong_value"}
        canonical = {"_k_inv": "correct_value"}
        errors = validate_symbols(spec, canonical)
        assert len(errors) > 0
        assert any("redefined" in e for e in errors)

    def test_validate_ir_equivalence_pass(self):
        """Equivalent readable and IR pass validation."""
        readable = {"invariants": ["must balance"]}
        ir = compile_to_ir(readable)
        errors = validate_ir_equivalence(readable, ir)
        assert len(errors) == 0

    def test_validate_ir_equivalence_fail_on_mismatch(self):
        """Mismatched readable and IR fail validation."""
        readable = {"invariants": ["must balance"]}
        ir = {"_k_inv": ["different value"]}
        errors = validate_ir_equivalence(readable, ir)
        assert len(errors) > 0

    def test_projection_prefixes_immutable(self):
        """_PROJECTION_PREFIXES should raise TypeError on mutation."""
        with pytest.raises(TypeError):
            _PROJECTION_PREFIXES["new_ns"] = "_new_"

    def test_reserved_prefixes_in_symbols(self):
        """Every _k_* symbol in RESERVED_PREFIXES is in _KERNEL_SYMBOLS."""
        for key in _KERNEL_SYMBOLS:
            assert any(key.startswith(p) for p in RESERVED_PREFIXES), (
                f"{key} doesn't match any reserved prefix"
            )

    def test_field_to_ir_mapping(self):
        """_FIELD_TO_IR maps readable names to IR symbols."""
        assert _FIELD_TO_IR["invariants"] == "_k_inv"
        assert _FIELD_TO_IR["constraints"] == "_k_cst"
        assert _FIELD_TO_IR["forbidden_actions"] == "_k_ban"

    def test_compile_preserves_list_order(self):
        """IR compilation preserves list item order."""
        steps = ["inspect", "diagnose", "patch", "verify"]
        ir = compile_to_ir({"steps": steps})
        assert ir["_k_seq"] == steps

    def test_compile_empty_dict(self):
        """Compiling empty dict returns empty dict."""
        assert compile_to_ir({}) == {}

    def test_expand_empty_dict(self):
        """Expanding empty dict returns empty dict."""
        assert expand_from_ir({}) == {}

    def test_validate_symbols_empty(self):
        """validate_symbols on empty dict returns no errors."""
        assert validate_symbols({}) == []

    def test_validate_ir_equivalence_empty(self):
        """Empty readable and IR pass equivalence."""
        assert validate_ir_equivalence({}, {}) == []

