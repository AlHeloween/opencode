"""Cross-variant guards — the defect class no single-variant test can see.

Twice now a norm landed in `addons.py` and `addons_claude.py` and never reached
`addons_codex.py` (2026-09-16, caught by hand on 09-17), and twice a variant's
artifact went stale while its source moved on (codex 09-17, claude 09-22). The
reverse-reachability check in `validate.py` guards the dataflow INSIDE one render;
nothing guarded agreement BETWEEN renders. These do.

A difference between registries is legitimate — the hosts differ — but it has to be
DECLARED here with its reason, so the next divergence is a test failure instead of a
reading.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.artifacts import DIST_CODEX
from prompt_kernel.cutover import CLAUDE_KERNEL_PATH

REGISTRIES = {
    "product": GATE_ADDONS,
    "claude": CLAUDE_GATE_ADDONS,
    "codex": CODEX_GATE_ADDONS,
}

# (variant, gate, addon_id) -> why this host and no other carries it.
DECLARED_DIFFERENCES = {
    ("product", "G9", "ARTIFACT_LANGUAGE"): "names the owner's language; the Claude variant shares this repo, the external Codex harness does not",
    ("claude", "G9", "ARTIFACT_LANGUAGE"): "same repo, same owner-facing split",
    ("product", "G1", "PATH_AGI_WORKOUT"): "the build_mode overlay's journal is bound to THIS kernel only: /automode exists here, the Codex and Claude hosts have no such overlay",
    ("product", "G7", "PATH_AGI_WORKOUT_LOG"): "same binding, write half — the overlay's memory is host-local by design",
}


def _slots(addons) -> set[tuple[str, str]]:
    return {(addon.gate_id, addon.addon_id) for addon in addons}


def test_registries_share_their_addon_slots() -> None:
    """A norm that reaches two hosts and not the third is the drift this catches."""
    common = set.intersection(*(_slots(addons) for addons in REGISTRIES.values()))
    undeclared = [
        (variant, gate, addon_id)
        for variant, addons in REGISTRIES.items()
        for gate, addon_id in _slots(addons) - common
        if (variant, gate, addon_id) not in DECLARED_DIFFERENCES
    ]
    assert undeclared == [], undeclared


def test_every_declared_difference_still_exists() -> None:
    """An exemption that outlived its difference is a licence nobody revoked."""
    for variant, gate, addon_id in DECLARED_DIFFERENCES:
        assert (gate, addon_id) in _slots(REGISTRIES[variant]), (variant, gate, addon_id)


def test_declared_differences_carry_a_reason() -> None:
    assert all(reason.strip() for reason in DECLARED_DIFFERENCES.values())


def test_claude_kernel_is_installed_current() -> None:
    """`.claude/reasoning_kernel.md` is loaded by CLAUDE.md, so a stale file is a stale prefix.

    Fix: `python -m prompt_kernel --claude --install`.
    """
    installed = Path(CLAUDE_KERNEL_PATH).read_text(encoding="utf-8")
    assert installed == render_kernel(KERNEL, CLAUDE_GATE_ADDONS)


def test_codex_artifact_is_current() -> None:
    """The stamped artifact is the in-repo evidence that the Codex variant was rendered.

    Its installed receiver (`$CODEX_HOME/AGENTS.md`, default `~/.codex/AGENTS.md`) is
    host-local, so no test here can assert it; the artifact is what travels with the repo.
    Fix: `python -m prompt_kernel --codex`.
    """
    artifacts = sorted(Path(DIST_CODEX).glob("*_reasoning_prompt.txt"))
    if not artifacts:
        # WHY: dist_codex/ is gitignored (6c31c09ce4), so a fresh clone carries no artifact and
        # this guard has nothing to compare. It is a staleness check for a working host, not a
        # claim the repo can make about itself.
        pytest.skip("no Codex artifact on this host; run `python -m prompt_kernel --codex`")
    assert artifacts[-1].read_text(encoding="utf-8") == render_kernel(KERNEL, CODEX_GATE_ADDONS)
