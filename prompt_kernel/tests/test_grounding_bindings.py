"""Host contracts are bound to available capabilities, with a refresh owner."""
from prompt_kernel.tests.test_variant_parity import REGISTRIES


def test_each_host_names_structural_first_and_refresh_ownership() -> None:
    for host, addons in REGISTRIES.items():
        lines = "\n".join(line for a in addons if a.gate_id == "G1" for line in a.lines)
        assert "graph-before-scanners" in lines, host
        assert "refresh owner" in lines, host
        assert "read-only explorer" in lines, host


def test_codex_maps_actual_process_edit_browser_and_delegation_capabilities() -> None:
    text = "\n".join(line for a in REGISTRIES["codex"] for line in a.lines)
    for capability in ("apply_patch", "exec_command", "write_stdin", "collaboration",
                       "cua_repl", "node_repl"):
        assert capability in text, capability
    for impossible in ("start through Hub", "Browser through Eval", "delegate through Task",
                       "use AST Edit", "use LSP definition"):
        assert impossible not in text, impossible
