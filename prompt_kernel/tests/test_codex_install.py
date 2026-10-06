"""The Codex global install: what it owns, what it refuses to touch, what it rolls back.

Every test runs against a temp config. Nothing here writes a real CODEX_HOME —
that is the smoke suite's job (T1/T2/T8/T9/T12), and it is the only place allowed
to touch the operator's ~/.codex.
"""

from __future__ import annotations

import hashlib
import tomllib
from pathlib import Path

import pytest

from prompt_kernel.codex_install import (
    FOREIGN_OPEN,
    MANAGED_CLOSE,
    MANAGED_OPEN,
    doctor,
    install,
    managed_block,
    root_instructions,
    uninstall,
)


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _value(path: Path) -> str:
    with path.open("rb") as handle:
        return tomllib.load(handle)["developer_instructions"]


def test_root_instructions_are_core_plus_adapter() -> None:
    text = root_instructions()
    assert text.count("<ADID_CORE>") == 1
    assert text.count("<CODEX_RUNTIME_ADAPTER>") == 1
    core = text.split("<ADID_CORE>")[1].split("</ADID_CORE>")[0]
    # §2.1: the portable half names no instrument of any host.
    for tool in ("codegraph_explore", "cmd_runner", "applypatch", "Glob", "Grep", "Hub", "Task"):
        assert tool not in core, tool


def test_managed_block_is_deterministic() -> None:
    first, second = managed_block("2.0.0-alpha.3"), managed_block("2.0.0-alpha.3")
    assert first == second
    assert first.count(MANAGED_OPEN) == 1
    assert first.count(MANAGED_CLOSE) == 1
    assert 'version="2.0.0-alpha.3"' in first


def test_install_creates_config_with_one_block(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    report = install(path=target)
    assert report.status == "INSTALLED"
    value = _value(target)
    assert value.count(MANAGED_OPEN) == 1
    assert tomllib.loads(target.read_text(encoding="utf-8")) is not None


def test_install_is_byte_idempotent(tmp_path: Path) -> None:
    """T8: install, hash, install, hash — the second run must change nothing."""
    target = tmp_path / "config.toml"
    install(path=target)
    first = hashlib.sha256(target.read_bytes()).hexdigest()
    second_report = install(path=target)
    assert second_report.status == "UNCHANGED"
    assert hashlib.sha256(target.read_bytes()).hexdigest() == first


def test_install_preserves_every_other_key(tmp_path: Path) -> None:
    target = _write(
        tmp_path / "config.toml",
        'model = "gpt-5.4"\napproval_policy = "never"\n\n[projects."D:/proj"]\ntrust_level = "trusted"\n',
    )
    install(path=target)
    data = tomllib.loads(target.read_text(encoding="utf-8"))
    assert data["model"] == "gpt-5.4"
    assert data["approval_policy"] == "never"
    assert data["projects"] == {"D:/proj": {"trust_level": "trusted"}}


def test_foreign_value_is_never_silently_destroyed(tmp_path: Path) -> None:
    """T9, default path: preserve and report; do not overwrite."""
    target = _write(tmp_path / "config.toml", 'developer_instructions = "FOREIGN_X"\n')
    before = target.read_text(encoding="utf-8")
    report = install(path=target)
    assert report.status == "FOREIGN"
    assert target.read_text(encoding="utf-8") == before
    assert "FOREIGN_X" in target.read_text(encoding="utf-8")


def test_reinstall_replaces_only_the_managed_block(tmp_path: Path) -> None:
    target = _write(tmp_path / "config.toml", 'developer_instructions = "FOREIGN_X"\n')
    install(path=target, compose=True)
    foreign_before = _value(target).count("FOREIGN_X")
    install(path=target, compose=True)
    value = _value(target)
    assert value.count(MANAGED_OPEN) == 1
    assert value.count("FOREIGN_X") == foreign_before == 1


def test_invalid_candidate_never_reaches_the_config(tmp_path: Path) -> None:
    """T12: a candidate that cannot round-trip leaves the original bytes alone.

    The staged re-parse is the gate, so the trigger has to be that gate failing.
    A malformed marker is the honest one: encode it into the value, the staged
    file becomes invalid TOML, and the original bytes must survive untouched with
    no candidate file left behind.
    """
    target = _write(tmp_path / "config.toml", 'model = "gpt-5.4"\n')
    before = target.read_bytes()
    with pytest.raises(tomllib.TOMLDecodeError):
        install(path=target, version="2.0.0\u0000alpha")
    assert target.read_bytes() == before
    assert not list(tmp_path.glob("*.candidate"))

def test_compose_keeps_foreign_text_exactly_once(tmp_path: Path) -> None:
    """T9, compose path: ADID present, foreign present once, never duplicated."""
    target = _write(tmp_path / "config.toml", 'developer_instructions = "FOREIGN_X"\n')
    report = install(path=target, compose=True)
    assert report.status == "INSTALLED"
    value = _value(target)
    assert value.count(MANAGED_OPEN) == 1
    assert value.count("FOREIGN_X") == 1
    assert FOREIGN_OPEN in value
    assert "may NOT weaken ADID governance" in value


def test_reinstall_replaces_only_the_managed_block(tmp_path: Path) -> None:
    """A second install swaps our block and leaves the operator's text alone."""
    target = _write(tmp_path / "config.toml", 'developer_instructions = "FOREIGN_X"\n')
    install(path=target, compose=True)
    install(path=target, compose=True)
    value = _value(target)
    assert value.count(MANAGED_OPEN) == 1, "reinstall must not duplicate the block"
    assert value.count("FOREIGN_X") == 1


def test_invalid_candidate_never_reaches_the_config(tmp_path: Path) -> None:
    """T12: a candidate that cannot round-trip leaves the original BYTES alone.

    The staged re-parse is the gate, so the trigger must be that gate failing. A
    raw NUL does it: the encoder escapes quotes, backslashes and newlines but not
    control bytes, and TOML forbids a control character in a basic string.
    """
    target = _write(tmp_path / "config.toml", 'model = "gpt-5.4"\n')
    before = target.read_bytes()
    with pytest.raises(tomllib.TOMLDecodeError):
        install(path=target, version="2.0.0-alpha.3" + chr(0))
    assert target.read_bytes() == before, "rollback must restore the exact bytes"
    assert not list(tmp_path.glob("*.candidate"))


def test_uninstall_removes_only_the_block(tmp_path: Path) -> None:
    target = _write(tmp_path / "config.toml", 'developer_instructions = "FOREIGN_X"\nmodel = "gpt-5.4"\n')
    install(path=target, compose=True)
    install(path=target, compose=True)
    report = uninstall(path=target)
    assert report.status == "UNINSTALLED"
    data = tomllib.loads(target.read_text(encoding="utf-8"))
    assert MANAGED_OPEN not in data["developer_instructions"]
    remaining = data["developer_instructions"]
    assert "FOREIGN_X" in remaining, "uninstall must not destroy the operator's text"
    assert MANAGED_OPEN not in remaining


def test_uninstall_on_a_config_without_adid_changes_nothing(tmp_path: Path) -> None:
    target = _write(tmp_path / "config.toml", 'model = "gpt-5.4"\n')
    before = target.read_bytes()
    assert uninstall(path=target).status == "NOT_CONFIGURED"
    assert target.read_bytes() == before


def test_doctor_reports_the_installed_hash(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    install(path=target)
    rows = dict((check, (status, detail)) for check, status, detail in doctor(path=target))
    assert rows["ADID version"][0] == "PASS"
    assert rows["ADID content hash"][0] == "PASS"
    assert rows["ADID content current"][0] == "PASS"


def test_doctor_reports_a_missing_config(tmp_path: Path) -> None:
    rows = dict((check, (status, detail)) for check, status, detail in doctor(path=tmp_path / "nope.toml"))
    assert rows["config path"][0] == "NOT_CONFIGURED"