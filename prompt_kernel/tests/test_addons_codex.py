from __future__ import annotations

import sys
from pathlib import Path

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS, validate_addons
from prompt_kernel.dedup import normalized_token_count


def _gate_block(text: str, gate_id: str) -> str:
    start = text.index(f"<{gate_id}_RULES>")
    return text[start : text.index(f"</{gate_id}_RULES>", start)]


def test_codex_addons_are_internally_valid() -> None:
    assert validate_addons(CODEX_GATE_ADDONS) == []
    gate_ids = {addon.gate_id for addon in CODEX_GATE_ADDONS}
    assert gate_ids <= {f"G{i}" for i in range(1, 10)}
    addon_ids = [addon.addon_id for addon in CODEX_GATE_ADDONS]
    assert len(addon_ids) == len(set(addon_ids))
    assert all(addon.lines for addon in CODEX_GATE_ADDONS)


def test_codex_addons_render_host_tool_bindings() -> None:
    text = render_kernel(KERNEL, CODEX_GATE_ADDONS)
    g1 = _gate_block(text, "G1")
    assert "codegraph_explore" in g1
    assert "Glob/Grep/Read" in g1
    assert "Browser through Eval" in g1
    g4 = _gate_block(text, "G4")
    assert "unresolved user decision -> Ask" in g4
    g6 = _gate_block(text, "G6")
    assert "LSP definition, references, and implementation" in g6
    g7 = _gate_block(text, "G7")
    assert "AST Edit" in g7
    assert "Hub" in g7
    g8 = _gate_block(text, "G8")
    assert "cmd_runner skill" in g8
    assert "Browser through Eval" in g8
    g9 = _gate_block(text, "G9")
    assert "no message-search tool exists" in g9


def test_codex_variant_avoids_unavailable_tool_instructions() -> None:
    text = render_kernel(KERNEL, CODEX_GATE_ADDONS)
    for unavailable in (
        "AskUserQuestion",
        "Monitor",
        "getmode",
        "messagesearch",
        "jobwait",
        "logsearch",
        "dbread",
        "multiedit",
        "applypatch",
    ):
        assert unavailable not in text, unavailable


def test_codex_variant_stays_within_explicit_budget() -> None:
    text = render_kernel(KERNEL, CODEX_GATE_ADDONS)
    # 34_000 / 4_250 (2026-09-16): mirrors the product raise admitting the
    # DELEGATION protocol — when to send a sub-agent, and the AICall falsifier for
    # the verdict a sub-agent cannot give because it shares our frame.
    # 35_000 / 4_450 (2026-09-16): mirrors the product raise to 34_000 for
    # @COMPACTION_CADENCE and the host bindings for it, for delegation, and for
    # the isolated-call falsifier. This variant keeps its +1 000 for having no
    # fixed slot.
    assert len(text.encode("utf-8")) <= 35_000
    assert normalized_token_count(text) <= 4_450


def test_codex_addon_render_is_deterministic_lf() -> None:
    text = render_kernel(KERNEL, CODEX_GATE_ADDONS)
    assert render_kernel(KERNEL, CODEX_GATE_ADDONS) == text
    assert "\r" not in text
    assert text.endswith("\n")


def test_codex_cli_writes_artifacts_without_installing(tmp_path: Path, monkeypatch) -> None:
    import prompt_kernel.__main__ as cli

    monkeypatch.setattr(cli, "DIST_CODEX", tmp_path)
    monkeypatch.setattr(sys, "argv", ["prompt_kernel", "--codex"])
    assert cli.main() == 0
    assert {path.suffix for path in tmp_path.iterdir()} == {".json", ".mdc", ".txt"}


def test_codex_cli_rejects_unsupported_install(monkeypatch) -> None:
    import prompt_kernel.__main__ as cli

    monkeypatch.setattr(sys, "argv", ["prompt_kernel", "--codex", "--install"])
    assert cli.main() == 2
