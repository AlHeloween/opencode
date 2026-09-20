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
    assert "openrouter-free (user-scope MCP): list_free_models is discovery" in g1
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
    # the Claude variant has no such fixed slot (--claude --install writes
    # .claude/reasoning_kernel.md as a whole file and stamps dist_claude/,
    # rather than filling a sized slot), so it carries its own, slightly
    # looser ceiling to admit host-level MCP tool guidance (e.g.
    # openrouter-free) without endless prose-golfing.
    # Still a real regression guard, not a rubber stamp — bump it
    # deliberately, not just to make a failing test pass.
    # 28_000 / 3_450 (2026-09-11, Alexander): the product cap moved 26_000 ->
    # 27_000 in the same decision, which collapsed the deliberate margin this
    # variant carries for having no fixed slot. Same step (+1 000 / +150)
    # restores the relationship; the product ceiling is unchanged.
    # 30_000 / 3_700 (2026-09-12, Alexander): mirrors the product raise for the
    # kernel-review patch set; this variant keeps its own ceiling because it
    # writes a whole file rather than filling a sized slot.
    # 31_000 / 3_850 (2026-09-12): mirrors the product raise admitting the
    # INTENTION_RESET protocol — the missing return path into G0.
    # 32_000 / 3_950 (2026-09-12): mirrors the revision contract for persisted
    # criteria; this variant has its own G1 binding (Read, no memory tool).
    # 34_000 / 4_250 (2026-09-16): mirrors the product raise admitting the
    # DELEGATION protocol — when to send a sub-agent, and the AICall falsifier for
    # the verdict a sub-agent cannot give because it shares our frame.
    # 35_000 / 4_450 (2026-09-16): mirrors the product raise to 34_000 for
    # @COMPACTION_CADENCE and the host bindings for it, for delegation, and for
    # the isolated-call falsifier. This variant keeps its +1 000 for having no
    # fixed slot.
    # 36_000 / 4_550 (2026-09-16, later): mirrors the product raise to 35_000 for
    # the compaction triggers the user named — fold before EVOLUTION_LOOP returns
    # to G1, and fold on STALL or an outside report of tunnel vision.
    # 38_000 / 5_150 (2026-09-20): the four addon bindings LANDED — PATH_EXPERIMENTS,
    # PATH_SURFACE_DOCS, SURFACE_CONSUMERS, ORACLE_INSTRUMENT_CHECK — so the raise the previous
    # comment anticipated for them is taken here, restoring this variant's +1_000 B / +150 tok
    # margin for having no fixed slot on top of the product's 37_000 / 5_000.
    # Measured after them: 36_691 B / 4_782 tok.
    # 39_000 / 5_150 (2026-09-20, later): mirrors the product raise to 38_000 for the QA/QC
    # bindings (@ACCEPTANCE_FRAME at G1, @ACCEPTANCE_PASS at G9) and for PROJECT_STRUCTURE
    # (G1) + STYLE_AUTHORITY (G7), which the framework's own 15.3 sections 1-2 supply.
    # Measured after them: 38_134 B — the byte cap steps, the token cap already had the room.
    # 40_000 / 5_150 (2026-09-20, later): mirrors the product raise to 40_000 for the GUI/TUI/ergonomics
    # rule sets and the GUI oracle. Measured after them: 39_553 B.
    assert len(text.encode("utf-8")) <= 40_000
    # 5_150 -> 5_400 (2026-09-20, same step): measured 5_202 after the GUI/TUI/ergonomics rule sets —
    # the token cap steps with the byte cap at this batch, 198 spare.
    assert normalized_token_count(text) <= 5_400


def test_claude_addon_render_is_deterministic_lf() -> None:
    text = render_kernel(KERNEL, CLAUDE_GATE_ADDONS)
    assert render_kernel(KERNEL, CLAUDE_GATE_ADDONS) == text
    assert "\r" not in text
    assert text.endswith("\n")
