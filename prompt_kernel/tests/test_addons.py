from __future__ import annotations

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS, GateAddon, validate_addons


def _gate_block(text: str, gate_id: str) -> str:
    start = text.index(f"<{gate_id}_RULES>")
    return text[start : text.index(f"</{gate_id}_RULES>", start)]


def test_addons_render_inside_gate_rule_blocks() -> None:
    text = render_kernel(KERNEL)
    g1 = _gate_block(text, "G1")
    assert "- first read: plans/*.md, docs/." in g1
    assert "- never store plans under .opencode/plans/." in g1
    assert "- ground via: codegraph, read, messagesearch, webfetch/universalsearch." in g1
    assert (
        "- file enumeration: list/glob/grep/read — never shell ls/dir/find/cat"
        " (hard-blocked)." in g1
    )
    assert (
        "- platform: Windows = cmd/powershell tools; bash unavailable." in g1
    )
    assert (
        "- cmd.exe: never dir/type/tree; quote spaced paths; chain &&; pipe 2>&1." in g1
    )
    g4 = _gate_block(text, "G4")
    assert "- identity or permission uncertain -> getmode; unresolved decision -> question (ASK)." in g4
    g9 = _gate_block(text, "G9")
    assert "- done -> plans_completed/; scan plans for stale refs." in g9
    assert "- verify completion: messagesearch; git status." in g9


def test_tool_addons_bind_expected_gates() -> None:
    text = render_kernel(KERNEL)
    assert "- track candidates: todowrite." in _gate_block(text, "G2")
    assert "- map symbols and ownership: codegraph explore/impact; read-only task grounding." in _gate_block(text, "G6")
    assert "- mutate: edit, multiedit, write, applypatch; crash-prone shell via cmd_runner." in _gate_block(text, "G7")
    assert (
        "- shell = process orchestration only; never file browsing (constitution blocks)."
        in _gate_block(text, "G7")
    )
    assert (
        "- launch processes only via cmd_runner start ... (non-blocking; jobwait/jobkill);"
        " bare shell start hangs the TUI — never do it." in _gate_block(text, "G7")
    )
    assert "- permanent services: nssm install ... start, never ad-hoc detached start." in _gate_block(text, "G7")
    assert (
        "- prove via tests (cmd_runner), jobwait, logsearch, dbread; long-running probes:"
        " cmd_runner start only." in _gate_block(text, "G8")
    )
    assert (
        "- visual claims (TUI render, dialog scroll, web page state) need the cua tool oracle:"
        " screenshot or verify_state — typecheck alone is not a visual oracle." in _gate_block(text, "G8")
    )
    assert (
        "- shell dir/ls scans are not evidence — product tools only."
        in _gate_block(text, "G8")
    )


def test_addons_do_not_spawn_a_separate_section() -> None:
    text = render_kernel(KERNEL)
    assert "## 6." not in text
    assert "GATE_ADDONS" not in text
    sections = tuple(text.index(f"## {number}. ") for number in range(6))
    assert sections == tuple(sorted(sections))


def test_registry_binds_only_declared_gates_with_unique_ids() -> None:
    assert validate_addons() == []
    gate_ids = {addon.gate_id for addon in GATE_ADDONS}
    assert gate_ids <= {f"G{i}" for i in range(1, 10)}
    addon_ids = [addon.addon_id for addon in GATE_ADDONS]
    assert len(addon_ids) == len(set(addon_ids))
    assert all(addon.lines for addon in GATE_ADDONS)


def test_addon_render_is_deterministic_lf() -> None:
    assert render_kernel(KERNEL) == render_kernel(KERNEL)
    text = render_kernel(KERNEL)
    assert "\r" not in text
    assert text.endswith("\n")


def test_validator_rejects_unknown_gate() -> None:
    errors = validate_addons((GateAddon("GX", "PATH_BROKEN", ("line.",)),))
    assert any("unknown gate" in error for error in errors)


def test_validator_rejects_duplicate_addon_id() -> None:
    errors = validate_addons(
        (
            GateAddon("G1", "PATH_TWICE", ("line.",)),
            GateAddon("G2", "PATH_TWICE", ("line.",)),
        )
    )
    assert any("duplicate addon" in error for error in errors)


def test_validator_rejects_empty_lines() -> None:
    errors = validate_addons((GateAddon("G1", "PATH_EMPTY", ()),))
    assert any("non-empty lines" in error for error in errors)


def test_render_rejects_invalid_addon_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    import prompt_kernel.render as render_module

    monkeypatch.setattr(
        render_module,
        "GATE_ADDONS",
        (GateAddon("GX", "PATH_BROKEN", ("line.",)),),
    )
    with pytest.raises(ValueError, match="invalid gate addons"):
        render_kernel(KERNEL)
