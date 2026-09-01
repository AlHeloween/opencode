from __future__ import annotations

import re
from pathlib import Path

from prompt_kernel import KERNEL, kernel_symbols, validate_kernel


ROOT = Path(__file__).resolve().parents[2]
AGENT_PROMPT_DIR = ROOT / "packages" / "opencode" / "src" / "agent" / "prompt"
SESSION_PROMPT_DIR = ROOT / "packages" / "opencode" / "src" / "session" / "prompt"

ID_RE = re.compile(r'<agent id="([^"]+)"')
SPINE_RE = re.compile(r"<spine>(.*?)</spine>", re.DOTALL)
REF_RE = re.compile(r"@([A-Z][A-Z0-9_]*)")

PROMPT_IDENTITY = {
    "coder.txt": "coder_agent",
    "explore.txt": "explorer_agent",
    "general.txt": "general_agent",
    "researcher.txt": "researcher_agent",
    "media.txt": "media_agent",
    "orchestrator.txt": "orchestrator_agent",
}


def _gates(text: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in text.split("→") if part.strip())


def test_next_kernel_still_valid_after_identity_scope_fix() -> None:
    assert validate_kernel(KERNEL) == []


def test_primary_modes_match_runtime_acl_shape() -> None:
    identities = {item.id: item for item in KERNEL.identities}
    assert identities["BUILD_MODE"].runtime == "build_mode"
    assert identities["BUILD_MODE"].kind == "primary"
    assert identities["BUILD_MODE"].gates == tuple(f"G{i}" for i in range(1, 10))
    assert identities["BUILD_MODE"].may_mutate is True
    assert identities["PLAN_MODE"].runtime == "plan_mode"
    assert identities["PLAN_MODE"].kind == "primary"
    assert identities["PLAN_MODE"].gates == ("G1", "G2", "G3", "G4", "G5", "G6", "G9")
    assert identities["PLAN_MODE"].may_mutate is False
    assert identities["REASONING_MODE"].runtime == "reasoning_mode"
    assert identities["REASONING_MODE"].kind == "primary"
    assert identities["REASONING_MODE"].gates == ()
    assert identities["REASONING_MODE"].may_mutate is False


def test_getmode_is_the_self_identification_tool_not_an_identity() -> None:
    assert "GETMODE" not in {item.id for item in KERNEL.identities}
    assert not any(rule.id == "GETMODE" for rule in KERNEL.shared_rules)
    catalog = next(rule for rule in KERNEL.shared_rules if rule.id == "CATALOG_INVARIANT")
    assert "call getmode" in catalog.text
    from prompt_kernel import render_kernel

    rendered = render_kernel(KERNEL)
    identity_block = rendered[rendered.index("## 5. IDENTITY_CONTRACTS") :]
    assert "Uncertain identity → getmode." in identity_block
    assert "@GETMODE" not in identity_block
    assert "### GETMODE\n" not in rendered
    text = "\n".join(
        (SESSION_PROMPT_DIR / name).read_text(encoding="utf-8")
        for name in ("build.txt", "plan.txt", "reasoning-mode.txt")
    )
    assert text.lower().count("getmode") >= 3


def test_identity_contracts_define_the_entities_that_are_used() -> None:
    from prompt_kernel import render_kernel

    text = render_kernel(KERNEL)
    for identity in KERNEL.identities:
        assert f"### {identity.id}\n" in text
        assert f"### {identity.runtime}\n" not in text
    assert "### BUILD_MODE\n" in text
    assert "### PLAN_MODE\n" in text
    assert "### REASONING_MODE\n" in text
    assert "### build_mode\n" not in text
    assert "runtime: build_mode" not in text


def test_mode_transition_notices_name_canonical_identities() -> None:
    for name, runtime, symbol in (
        ("build.txt", "build_mode", "BUILD_MODE"),
        ("plan.txt", "plan_mode", "PLAN_MODE"),
        ("reasoning-mode.txt", "reasoning_mode", "REASONING_MODE"),
    ):
        text = (SESSION_PROMPT_DIR / name).read_text(encoding="utf-8")
        assert f'<agent id="{runtime}">' in text
        assert f"@{symbol}" in text
        assert f"(runtime {runtime}" not in text
        assert "does not" in text.lower() or "not available" in text.lower() or "outside the mutation spine" in text


def test_agent_prompt_spines_match_kernel_identities() -> None:
    identities = {item.runtime: item for item in KERNEL.identities}
    for filename, runtime in PROMPT_IDENTITY.items():
        text = (AGENT_PROMPT_DIR / filename).read_text(encoding="utf-8")
        assert ID_RE.search(text).group(1) == runtime
        spine = SPINE_RE.search(text)
        assert spine, f"{filename} missing <spine>"
        assert _gates(spine.group(1)) == identities[runtime].gates


def test_agent_prompt_refs_resolve_in_next_kernel() -> None:
    symbols = kernel_symbols(KERNEL)
    unresolved: list[str] = []
    for filename in PROMPT_IDENTITY:
        text = (AGENT_PROMPT_DIR / filename).read_text(encoding="utf-8")
        for ref in REF_RE.findall(text):
            if ref not in symbols:
                unresolved.append(f"{filename}: @{ref}")
    assert unresolved == []


def test_session_identity_reminders_have_no_unresolved_kernel_refs() -> None:
    symbols = kernel_symbols(KERNEL)
    unresolved: list[str] = []
    for name in ("build.txt", "plan.txt", "reasoning-mode.txt"):
        text = (SESSION_PROMPT_DIR / name).read_text(encoding="utf-8")
        for ref in REF_RE.findall(text):
            if ref not in symbols:
                unresolved.append(f"{name}: @{ref}")
    assert unresolved == []


def test_rendered_kernel_and_bound_prompts_have_no_unresolved_refs() -> None:
    from prompt_kernel import render_kernel

    symbols = kernel_symbols(KERNEL)
    unresolved: list[str] = []
    surfaces = [("render", render_kernel(KERNEL))]
    surfaces.extend((path.name, path.read_text(encoding="utf-8")) for path in sorted(AGENT_PROMPT_DIR.glob("*.txt")))
    for name in ("build.txt", "plan.txt", "reasoning-mode.txt"):
        surfaces.append((name, (SESSION_PROMPT_DIR / name).read_text(encoding="utf-8")))
    tool_dir = ROOT / "packages" / "opencode" / "src" / "tool"
    surfaces.extend((path.name, path.read_text(encoding="utf-8")) for path in sorted(tool_dir.glob("*.txt")))
    for label, text in surfaces:
        for ref in REF_RE.findall(text):
            if ref not in symbols:
                unresolved.append(f"{label}: @{ref}")
    assert unresolved == []


def test_legacy_unresolved_refs_are_gone() -> None:
    banned = {
        "ADID_OPS",
        "HYGIENE",
        "NO_SCRIPT_EDITING",
        "READ_ENTIRE_FILE",
        "SEARCH_ORDER",
        "GROUND",
    }
    texts = [path.read_text(encoding="utf-8") for path in AGENT_PROMPT_DIR.glob("*.txt")]
    texts.extend((SESSION_PROMPT_DIR / name).read_text(encoding="utf-8") for name in ("build.txt", "plan.txt", "reasoning-mode.txt"))
    present = {ref for text in texts for ref in REF_RE.findall(text)}
    found = sorted(name for name in banned if name in present)
    assert found == []


def test_explorer_prompt_does_not_invent_codegraphstatus() -> None:
    text = (AGENT_PROMPT_DIR / "explore.txt").read_text(encoding="utf-8")
    assert "codegraphcodegraphstatus" not in text
    assert "`codegraph`" in text


def test_orchestrator_does_not_treat_getplanstatus_as_a_tool() -> None:
    text = (AGENT_PROMPT_DIR / "orchestrator.txt").read_text(encoding="utf-8")
    assert "Call getPlanStatus()" not in text
    assert "not a tool" in text
