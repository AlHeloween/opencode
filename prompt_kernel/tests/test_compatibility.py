from __future__ import annotations

from pathlib import Path
import hashlib

import pytest

from prompt_kernel import (
    KERNEL,
    LEGACY_RULE_MIGRATION,
    LEGACY_RUNTIME_RULES,
    REQUIRED_NEXT_SEMANTICS,
    REQUIRED_SEMANTICS,
    compatibility_report,
    next_kernel_contract_gaps,
    render_kernel,
    validate_migration,
    write_artifacts,
)
from prompt_kernel.cutover import cutover, install_production


ROOT = Path(__file__).resolve().parents[2]
PRODUCTION = ROOT / "packages" / "opencode" / "src" / "session" / "prompt" / "reasoning_prompt.txt"


def test_next_kernel_covers_required_runtime_semantics() -> None:
    report = compatibility_report(PRODUCTION.read_text(encoding="utf-8"), render_kernel())
    assert report["missing_from_current"] == ()
    assert report["missing_from_next"] == ()
    assert report["missing_next_only"] == ()
    assert next_kernel_contract_gaps(KERNEL) == ()
    assert tuple(REQUIRED_SEMANTICS) == tuple(sorted(REQUIRED_SEMANTICS))
    assert tuple(REQUIRED_NEXT_SEMANTICS) == tuple(sorted(REQUIRED_NEXT_SEMANTICS))


def test_production_prompt_matches_next_kernel_renderer() -> None:
    current = PRODUCTION.read_text(encoding="utf-8")
    assert current.lstrip().startswith("## 0. KERNEL_MAP")
    assert current == render_kernel()


def test_normal_build_preserves_current_kernel_hash_boundary() -> None:
    from prompt_kernel import assert_current_kernel_unchanged

    assert assert_current_kernel_unchanged() == []


def test_legacy_rule_migration_is_exhaustive_and_resolved() -> None:
    assert validate_migration(LEGACY_RUNTIME_RULES, KERNEL) == []
    assert set(LEGACY_RULE_MIGRATION) == set(LEGACY_RUNTIME_RULES)


def test_delegated_rudiments_name_their_external_owner() -> None:
    delegated = [decision for decision in LEGACY_RULE_MIGRATION.values() if decision.disposition == "delegated"]
    assert delegated
    assert all(decision.boundary not in {"", "kernel"} for decision in delegated)
    assert all(decision.rationale for decision in delegated)


def test_no_legacy_rule_is_silently_retired() -> None:
    assert all(decision.disposition != "retired" for decision in LEGACY_RULE_MIGRATION.values())


def test_cutover_requires_explicit_approval(tmp_path: Path) -> None:
    target = tmp_path / "reasoning_prompt.txt"
    target.write_text("current", encoding="utf-8")
    with pytest.raises(PermissionError, match="explicit approval"):
        cutover(target, expected_current_sha256="unused", approve=False, dist=tmp_path)


def test_cutover_rejects_stale_expected_hash(tmp_path: Path) -> None:
    target = tmp_path / "reasoning_prompt.txt"
    target.write_text("current", encoding="utf-8")
    with pytest.raises(RuntimeError, match="hash mismatch"):
        cutover(target, expected_current_sha256="0" * 64, approve=True, dist=tmp_path)


def test_cutover_succeeds_only_with_matching_hash_and_compatible_kernel(tmp_path: Path) -> None:
    target = tmp_path / "reasoning_prompt.txt"
    current = PRODUCTION.read_text(encoding="utf-8")
    target.write_text(current, encoding="utf-8", newline="\n")
    expected = hashlib.sha256(target.read_bytes()).hexdigest()
    installed = cutover(target, expected_current_sha256=expected, approve=True, dist=tmp_path)
    assert target.read_text(encoding="utf-8") == render_kernel()
    assert installed == hashlib.sha256(render_kernel().encode("utf-8")).hexdigest()


def test_cutover_copies_a_reviewed_stamped_artifact(tmp_path: Path) -> None:
    _, runtime_path = write_artifacts(dist=tmp_path, stamp="2026-09-01_19-27-54")
    target = tmp_path / "reasoning_prompt.txt"
    current = PRODUCTION.read_text(encoding="utf-8")
    target.write_text(current, encoding="utf-8", newline="\n")
    expected = hashlib.sha256(target.read_bytes()).hexdigest()
    cutover(
        target,
        expected_current_sha256=expected,
        approve=True,
        source=runtime_path,
        dist=tmp_path,
    )
    assert target.read_text(encoding="utf-8") == runtime_path.read_text(encoding="utf-8")


def test_install_production_writes_renderer_output(tmp_path: Path) -> None:
    target = tmp_path / "reasoning_prompt.txt"
    digest = install_production(production_path=target, dist=tmp_path)
    assert target.read_text(encoding="utf-8") == render_kernel()
    assert digest == hashlib.sha256(render_kernel().encode("utf-8")).hexdigest()
