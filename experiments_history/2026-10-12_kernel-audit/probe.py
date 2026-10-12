"""Measure kernel contracts; change only in-memory objects and audit artifacts."""

from __future__ import annotations

import difflib
import hashlib
import importlib.util
import json
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from prompt_kernel.addons import GATE_ADDONS, validate_addons
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS, render_cursor_rule
from prompt_kernel.model import Edge
from prompt_kernel.render import render_kernel
from prompt_kernel.source import KERNEL
from prompt_kernel.validate import validate_kernel


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    cases = []
    baseline = validate_kernel(KERNEL)
    assert baseline == [], baseline

    # Controls are independently required by the declared graph namespace.
    invalid_node = replace(
        KERNEL, edges=(*KERNEL.edges, Edge("MISSING", "G7", "side", "diagnostic"))
    )
    control_errors = validate_kernel(invalid_node)
    assert any("edge source is unknown" in error for error in control_errors)
    cases.append({"id": "unknown-node-control", "errors": control_errors})

    for source in ("*", "G0", "SUCCESS"):
        candidate = replace(
            KERNEL, edges=(*KERNEL.edges, Edge(source, "G7", "side", "diagnostic"))
        )
        errors = validate_kernel(candidate)
        rendered = render_kernel(candidate)
        assert errors == [], (source, errors)
        assert f"{source} -> G7" in rendered
        cases.append({"id": f"side-edge-{source}", "errors": errors, "rendered": True})

    g0 = KERNEL.gates[0]
    assert g0.fsm is not None
    broken = replace(g0, fsm=replace(g0.fsm, initial_state="UNDECLARED"))
    candidate = replace(KERNEL, gates=(broken, *KERNEL.gates[1:]))
    errors = validate_kernel(candidate)
    same_render = render_kernel(candidate) == render_kernel(KERNEL)
    assert errors == [] and same_render
    cases.append({"id": "undeclared-fsm-state", "errors": errors, "same_render": same_render})

    g2 = next(gate for gate in KERNEL.gates if gate.id == "G2")
    assert g2.fsm is not None
    small = g2.fsm.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS",
        {"candidates": ["only-feasible-candidate"], "candidate_count": 1},
    )
    full = g2.fsm.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS",
        {"candidates": ["a", "b", "c", "d", "e"], "candidate_count": 5},
    )
    assert small is False and full is True
    cases.append({"id": "g2-small-space", "small": small, "five-control": full})

    g9 = next(gate for gate in KERNEL.gates if gate.id == "G9")
    assert g9.fsm is not None
    nonpass = g9.fsm.is_valid_transition(
        "CHECK_ORACLE", "CHECK_RISKS",
        {"oracle_passed": False, "residual_defined": True, "loop_budget_exhausted": True},
    )
    passing = g9.fsm.is_valid_transition(
        "CHECK_ORACLE", "CHECK_RISKS", {"oracle_passed": True},
    )
    assert nonpass is False and passing is True
    cases.append({"id": "g9-nonpass-closure", "nonpass": nonpass, "pass-control": passing})

    test_path = ROOT / "prompt_kernel/tests/test_variant_parity.py"
    spec = importlib.util.spec_from_file_location("audit_variant_tests", test_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.test_shared_bindings_keep_one_spelling()
    original = module.CURSOR_GATE_ADDONS
    changed = []
    for addon in original:
        if (addon.gate_id, addon.addon_id) == module.SHARED_BINDINGS[0]:
            addon = replace(addon, lines=(*addon.lines, "Audit-only mutation."))
        changed.append(addon)
    module.CURSOR_GATE_ADDONS = tuple(changed)
    control_fired = False
    try:
        module.test_shared_bindings_keep_one_spelling()
    except AssertionError:
        control_fired = True
    assert control_fired
    module.CURSOR_GATE_ADDONS = original
    module.CLAUDE_GATE_ADDONS = ()
    module.GATE_ADDONS = ()
    module.REGISTRIES["product"] = ()
    module.REGISTRIES["claude"] = ()
    module.test_shared_bindings_keep_one_spelling()
    cases.append({"id": "parity-guard", "cursor-control-rejected": True,
                  "product-claude-empty-accepted": True})

    variants = {
        "product": (GATE_ADDONS, None, "packages/opencode/src/session/prompt/reasoning_prompt.txt"),
        "claude": (CLAUDE_GATE_ADDONS, (), ".claude/reasoning_kernel.md"),
        "codex": (CODEX_GATE_ADDONS, (), "C:/Users/Alexander/.codex/AGENTS.md"),
        "cursor": (CURSOR_GATE_ADDONS, (), ".cursor/rules/reasoning-kernel.mdc"),
    }
    receivers = {}
    for name, (addons, identities, relative) in variants.items():
        assert validate_addons(addons) == []
        expected = (render_kernel(KERNEL, addons) if identities is None
                    else render_kernel(KERNEL, addons, identities))
        if name == "cursor":
            expected = render_cursor_rule(expected)
        receiver = Path(relative) if ":/" in relative else ROOT / relative
        current = receiver.read_text(encoding="utf-8")
        chunks = list(difflib.unified_diff(current.splitlines(), expected.splitlines(),
                                         fromfile=relative, tofile=f"render-{name}", n=1))
        (Path(__file__).parent / f"{name}-receiver.diff").write_text(
            "\n".join(chunks) + "\n", encoding="utf-8"
        )
        receivers[name] = {
            "path": str(receiver), "text_matches_render": current == expected,
            "receiver_text_sha256": sha256(current.encode("utf-8")),
            "render_text_sha256": sha256(expected.encode("utf-8")),
            "render_utf8_bytes": len(expected.encode("utf-8")),
            "diff_hunks": sum(line.startswith("@@") for line in chunks),
        }

    result = {"baseline_errors": baseline, "counterexamples": cases,
              "receivers": receivers, "boundary": "IR and host artifacts only; no live model verdict"}
    output = Path(__file__).parent / "probe-results.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("AUDIT_PROBE_COMPLETED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
