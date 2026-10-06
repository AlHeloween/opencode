"""The Cursor host registry: its own bindings, and the tools it must not name.

A variant test that only asserts "it renders" is a smoke test. These pin the
two things a fourth host actually gets wrong: it drifts back to the opencode
tool names it does not have, and it grows past the prefix budget because
nobody measured it.
"""

from __future__ import annotations

import sys
from pathlib import Path

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS, render_cursor_rule, validate_addons
from prompt_kernel.dedup import normalized_token_count


def _gate_block(text: str, gate_id: str) -> str:
    start = text.index(f"<{gate_id}_RULES>")
    return text[start : text.index(f"</{gate_id}_RULES>", start)]


def test_cursor_addons_are_internally_valid() -> None:
    assert validate_addons(CURSOR_GATE_ADDONS) == []
    gate_ids = {addon.gate_id for addon in CURSOR_GATE_ADDONS}
    assert gate_ids <= {f"G{i}" for i in range(1, 10)}
    addon_ids = [addon.addon_id for addon in CURSOR_GATE_ADDONS]
    assert len(addon_ids) == len(set(addon_ids))
    assert all(addon.lines for addon in CURSOR_GATE_ADDONS)


def test_cursor_addons_render_this_hosts_tool_bindings() -> None:
    text = render_kernel(KERNEL, CURSOR_GATE_ADDONS, ())
    g1 = _gate_block(text, "G1")
    assert "Read File, Grep, Search Files and Codebase" in g1
    assert "never shell ls/dir/find/cat" in g1
    assert "host blocker to report, never a route around" in g1
    assert "durable criteria" in g1
    assert "Fetch Rules" in g1
    g2 = _gate_block(text, "G2")
    assert "track candidates: Todo." in g2
    assert "through one Agent batch" in g2
    g4 = _gate_block(text, "G4")
    assert "is asked in chat, never decided alone" in g4
    assert "python -m prompt_kernel --cursor --install" in g4
    g6 = _gate_block(text, "G6")
    assert "no LSP tool is bound here" in g6
    g7 = _gate_block(text, "G7")
    assert "Terminal executes binaries or short fact pipelines only" in g7
    assert "delegate through Agent" in g7
    assert "no background or daemon-control tool is bound" in g7
    g8 = _gate_block(text, "G8")
    assert "this host has no cmd_runner" in g8
    assert "no isolated model call is bound here" in g8
    g9 = _gate_block(text, "G9")
    assert "no message-search tool is bound" in g9
    assert "treat the fold as lossy" in g9


def test_cursor_variant_never_names_a_tool_it_does_not_have() -> None:
    """The defect this host inherits from a copy-pasted registry: opencode tool names."""
    text = render_kernel(KERNEL, CURSOR_GATE_ADDONS, ())
    for unavailable in (
        "applypatch",
        "multiedit",
        "checkstate",
        "messagesearch",
        "logsearch",
        "dbread",
        "jobwait",
        "nssm",
        "AskUserQuestion",
        "Monitor",
        "run_in_background",
        "TodoWrite",
        "codegraph_explore",
    ):
        assert unavailable not in text, unavailable


def test_cursor_variant_stays_within_explicit_budget() -> None:
    text = render_kernel(KERNEL, CURSOR_GATE_ADDONS, ())
    # 8_400 (2026-10-06, owner: limits by measurement): @CAPABILITY_ABSTRACTION, the G0
    # turn-termination clarification and @ASSERTION_SCOPE; measured 8_394. This host stays the
    # largest of the four because its bindings name capabilities («Read File, Grep,
    # Search Files and Codebase») that the product variant's snake_case tool names
    # did not. The byte cap is the shared one, not a number repeated here.

    assert len(text.encode("utf-8")) <= KERNEL.utf8_budget
    assert normalized_token_count(text) <= 8_400


def test_cursor_addon_render_is_deterministic_lf() -> None:
    text = render_kernel(KERNEL, CURSOR_GATE_ADDONS, ())
    assert render_kernel(KERNEL, CURSOR_GATE_ADDONS, ()) == text
    assert "\r" not in text
    assert text.endswith("\n")


def test_cursor_rule_carries_the_frontmatter_cursor_reads() -> None:
    """Without `alwaysApply` the rule is a file Cursor may load without applying."""
    rule = render_cursor_rule("BODY\n")
    head = rule.split("---")[1]
    assert "alwaysApply: true" in head
    assert rule.endswith("BODY\n")


def test_cursor_cli_writes_artifacts_without_installing(tmp_path: Path, monkeypatch) -> None:
    import prompt_kernel.__main__ as cli

    monkeypatch.setattr(cli, "DIST_CURSOR", tmp_path)
    monkeypatch.setattr(sys, "argv", ["prompt_kernel", "--cursor"])
    assert cli.main() == 0
    assert {path.suffix for path in tmp_path.iterdir()} == {".json", ".mdc", ".txt"}


def test_cursor_cli_installs_the_generated_rule(tmp_path: Path, monkeypatch) -> None:
    import prompt_kernel.__main__ as cli

    target = tmp_path / ".cursor" / "rules" / "reasoning-kernel.mdc"
    monkeypatch.setattr(cli, "DIST_CURSOR", tmp_path / "dist_cursor")
    monkeypatch.setattr(cli, "CURSOR_KERNEL_PATH", target)
    monkeypatch.setattr(sys, "argv", ["prompt_kernel", "--cursor", "--install"])
    assert cli.main() == 0
    assert target.read_text(encoding="utf-8") == render_cursor_rule(
        render_kernel(KERNEL, CURSOR_GATE_ADDONS, ())
    )