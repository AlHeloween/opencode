from __future__ import annotations

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS, validate_addons
from prompt_kernel.dedup import normalized_token_count


def _gate_block(text: str, gate_id: str) -> str:
    start = text.index(f"<{gate_id}_RULES>")
    return text[start : text.index(f"</{gate_id}_RULES>", start)]


def test_claude_addons_are_internally_valid() -> None:
    assert validate_addons(CLAUDE_GATE_ADDONS) == []
    gate_ids = {addon.gate_id for addon in CLAUDE_GATE_ADDONS}
    assert gate_ids <= {f"G{i}" for i in range(1, 10)}
    addon_ids = [addon.addon_id for addon in CLAUDE_GATE_ADDONS]
    assert len(addon_ids) == len(set(addon_ids))
    assert all(addon.lines for addon in CLAUDE_GATE_ADDONS)


def test_claude_addons_render_inside_gate_rule_blocks() -> None:
    text = render_kernel(KERNEL, CLAUDE_GATE_ADDONS)
    g1 = _gate_block(text, "G1")
    assert "- never store plans under .claude/plans/." in g1
    assert "codegraph_explore" in g1
    assert "Glob/Grep/Read" in g1
    assert "openrouter-free-mcp: list_free_models is discovery" in g1
    g4 = _gate_block(text, "G4")
    assert "AskUserQuestion" in g4
    assert "EXTERNAL_EFFECT" in g4
    assert "allow_paid:true" in g4
    g7 = _gate_block(text, "G7")
    assert "no bulk patch tool" in g7
    assert "run_in_background:true" in g7
    g8 = _gate_block(text, "G8")
    assert "Browser tool oracle" in g8
    assert "sandbox egress blocking an MCP call is Unknown" in g8
    g9 = _gate_block(text, "G9")
    assert "no message-search tool exists" in g9
    assert "smoke-tested MCP contract" in g9


def test_claude_addons_do_not_instruct_using_opencode_only_tools() -> None:
    # Some lines name an opencode-only tool to say it is absent here (e.g.
    # "no logsearch/dbread tool"); none may tell the model to reach for one.
    text = render_kernel(KERNEL, CLAUDE_GATE_ADDONS)
    for opencode_only in ("cmd_runner", "messagesearch", "multiedit", "nssm"):
        assert opencode_only not in text, opencode_only
    for used_as_instruction in ("via applypatch", "via logsearch", "via dbread", "via multiedit"):
        assert used_as_instruction not in text, used_as_instruction


def test_claude_variant_stays_within_its_own_budget() -> None:
    text = render_kernel(KERNEL, CLAUDE_GATE_ADDONS)
    # KERNEL.utf8_budget (26_000) was calibrated for opencode's production
    # prompt insertion point (packages/opencode/.../reasoning_prompt.txt);
    # the Claude variant has no such fixed slot (--claude only stamps
    # dist_claude/, there is no cutover/install target), so it carries its
    # own, slightly looser ceiling to admit project-specific MCP tool
    # guidance (e.g. openrouter-free-mcp) without endless prose-golfing.
    # Still a real regression guard, not a rubber stamp — bump it
    # deliberately, not just to make a failing test pass.
    assert len(text.encode("utf-8")) <= 27_000
    assert normalized_token_count(text) <= 3_300


def test_claude_addon_render_is_deterministic_lf() -> None:
    text = render_kernel(KERNEL, CLAUDE_GATE_ADDONS)
    assert render_kernel(KERNEL, CLAUDE_GATE_ADDONS) == text
    assert "\r" not in text
    assert text.endswith("\n")
