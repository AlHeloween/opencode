"""The Codex global install: the kernel ships as $CODEX_HOME/AGENTS.md only.

t64 (owner 2026-10-16): «developer_instructions писать не надо просто AGENTS.md
в ~\\.codex и все.» — reverses t54 (config.toml-only channel). The installer writes
AGENTS.md with the codex render, writes NO developer_instructions, and sweeps a
legacy ADID_MANAGED block left by the old installer (a foreign value is left
alone and reported, as before).

Every test runs against a temp CODEX_HOME. Nothing here writes the real ~/.codex —
that is the review step's job (Claude runs the real --codex-global install/doctor).
"""

from __future__ import annotations

import hashlib
import json
import tomllib
from pathlib import Path

from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.codex_install import (
    MANAGED_OPEN,
    agents_path,
    codex_kernel_text,
    config_path,
    doctor,
    install,
    managed_block,
    uninstall,
)
from prompt_kernel.render import render_kernel
from prompt_kernel.source import KERNEL


def _di_config(home: Path, value: str) -> Path:
    """A config.toml carrying exactly one developer_instructions value."""
    target = home / "config.toml"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"developer_instructions = {json.dumps(value)}\n", encoding="utf-8")
    return target


def _config_value(home: Path) -> str | None:
    target = home / "config.toml"
    if not target.is_file():
        return None
    with target.open("rb") as handle:
        data = tomllib.load(handle)
    value = data.get("developer_instructions")
    return value if isinstance(value, str) else None


def test_agents_body_is_the_codex_render() -> None:
    """The installed bytes are the codex variant render — no markers, LF, ends with newline."""
    body = codex_kernel_text()
    assert body == render_kernel(KERNEL, CODEX_GATE_ADDONS, ())
    assert body.startswith("## 0. WORKFLOW")
    assert MANAGED_OPEN not in body
    assert "\r" not in body
    assert body.endswith("\n")


def test_install_writes_agents_md_byte_equal(tmp_path: Path) -> None:
    report = install(home=tmp_path)
    assert report.status == "INSTALLED"
    target = agents_path(tmp_path)
    assert target == tmp_path / "AGENTS.md"
    assert target.read_bytes() == codex_kernel_text().encode("utf-8")


def test_install_writes_no_developer_instructions(tmp_path: Path) -> None:
    install(home=tmp_path)
    assert _config_value(tmp_path) is None


def test_install_is_byte_idempotent(tmp_path: Path) -> None:
    install(home=tmp_path)
    first = hashlib.sha256((tmp_path / "AGENTS.md").read_bytes()).hexdigest()
    second = install(home=tmp_path)
    assert second.status == "UNCHANGED"
    assert hashlib.sha256((tmp_path / "AGENTS.md").read_bytes()).hexdigest() == first


def test_install_removes_a_legacy_managed_block(tmp_path: Path) -> None:
    """The old (t54) installer left its kernel in config.toml — sweep it, keep AGENTS.md."""
    _di_config(tmp_path, managed_block("2.0.0-alpha.3"))
    report = install(home=tmp_path)
    assert report.status == "INSTALLED"
    assert (tmp_path / "AGENTS.md").read_bytes() == codex_kernel_text().encode("utf-8")
    assert _config_value(tmp_path) is None


def test_install_keeps_foreign_remainder_of_a_legacy_value(tmp_path: Path) -> None:
    """A composed legacy value (managed block + operator text) keeps the operator's text."""
    _di_config(tmp_path, managed_block("2.0.0-alpha.3") + "\n\nFOREIGN_X")
    install(home=tmp_path)
    remaining = _config_value(tmp_path)
    assert remaining is not None
    assert MANAGED_OPEN not in remaining
    assert "FOREIGN_X" in remaining


def test_install_leaves_a_foreign_value_alone_and_reports_it(tmp_path: Path) -> None:
    """A foreign developer_instructions is the operator's — never touched, but reported."""
    target = _di_config(tmp_path, "FOREIGN_X")
    before = target.read_bytes()
    report = install(home=tmp_path)
    assert target.read_bytes() == before
    assert report.detail and "foreign developer_instructions" in report.detail
    assert (tmp_path / "AGENTS.md").read_bytes() == codex_kernel_text().encode("utf-8")


def test_doctor_reports_the_agents_channel(tmp_path: Path) -> None:
    install(home=tmp_path)
    rows = dict((check, (status, detail)) for check, status, detail in doctor(home=tmp_path))
    assert rows["agents path"][0] == "PASS"
    assert rows["agents content current"][0] == "PASS"
    assert not any(status == "FAIL" for status, _ in rows.values())


def test_doctor_fails_on_two_channels(tmp_path: Path) -> None:
    """AGENTS.md kernel + a managed block in config.toml = two kernel channels → FAIL."""
    install(home=tmp_path)
    _di_config(tmp_path, managed_block("2.0.0-alpha.3"))
    rows = dict((check, (status, detail)) for check, status, detail in doctor(home=tmp_path))
    assert any(status == "FAIL" for status, _ in rows.values())


def test_doctor_reports_a_missing_home(tmp_path: Path) -> None:
    rows = dict((check, (status, detail)) for check, status, detail in doctor(home=tmp_path / "nope"))
    assert rows["agents path"][0] == "NOT_CONFIGURED"


def test_uninstall_removes_only_what_it_wrote(tmp_path: Path) -> None:
    install(home=tmp_path)
    report = uninstall(home=tmp_path)
    assert report.status == "UNINSTALLED"
    assert not (tmp_path / "AGENTS.md").exists()


def test_uninstall_leaves_a_foreign_agents_md_alone(tmp_path: Path) -> None:
    target = tmp_path / "AGENTS.md"
    target.write_text("operator notes\n", encoding="utf-8")
    before = target.read_bytes()
    report = uninstall(home=tmp_path)
    assert target.read_bytes() == before
    assert report.status == "NOT_CONFIGURED"


def test_uninstall_sweeps_the_legacy_block_and_keeps_foreign_text(tmp_path: Path) -> None:
    install(home=tmp_path)
    _di_config(tmp_path, managed_block("2.0.0-alpha.3") + "\n\nFOREIGN_X")
    report = uninstall(home=tmp_path)
    assert report.status == "UNINSTALLED"
    assert not (tmp_path / "AGENTS.md").exists()
    remaining = _config_value(tmp_path)
    assert remaining is not None and "FOREIGN_X" in remaining and MANAGED_OPEN not in remaining


def test_uninstall_on_an_empty_home_changes_nothing(tmp_path: Path) -> None:
    assert uninstall(home=tmp_path).status == "NOT_CONFIGURED"
    assert config_path(tmp_path).exists() is False


def _override_rows(home: Path) -> dict:
    return dict((check, (status, detail)) for check, status, detail in doctor(home=home))


def test_doctor_passes_on_absent_override(tmp_path: Path) -> None:
    """No AGENTS.override.md — Codex reads our AGENTS.md."""
    install(home=tmp_path)
    status, _ = _override_rows(tmp_path)["agents override"]
    assert status == "PASS"


def test_doctor_passes_on_empty_override(tmp_path: Path) -> None:
    """Whitespace-only override is skipped by Codex (trimmed.is_empty), like an absent one."""
    install(home=tmp_path)
    (tmp_path / "AGENTS.override.md").write_bytes(b"  \n")
    status, _ = _override_rows(tmp_path)["agents override"]
    assert status == "PASS"


def test_doctor_fails_on_nonempty_override(tmp_path: Path) -> None:
    """A non-empty AGENTS.override.md shadows AGENTS.md entirely (mod.rs:41-43)."""
    install(home=tmp_path)
    override = tmp_path / "AGENTS.override.md"
    override.write_bytes(b"operator override\n")
    status, detail = _override_rows(tmp_path)["agents override"]
    assert status == "FAIL"
    assert str(override) in detail


def test_uninstall_leaves_the_override_alone(tmp_path: Path) -> None:
    """The override is the operator's file — never ours to delete."""
    install(home=tmp_path)
    override = tmp_path / "AGENTS.override.md"
    override.write_bytes(b"operator override\n")
    uninstall(home=tmp_path)
    assert override.read_bytes() == b"operator override\n"
    assert not (tmp_path / "AGENTS.md").exists()
