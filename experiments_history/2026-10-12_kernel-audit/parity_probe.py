"""A bounded mutation of one shared slot, preserving registry membership."""

from __future__ import annotations

import importlib.util
import json
import sys
from dataclasses import replace
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location(
    "audit_variant_tests", ROOT / "prompt_kernel/tests/test_variant_parity.py"
)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.test_shared_bindings_keep_one_spelling()
target = module.SHARED_BINDINGS[0]
outcomes = {}
for host in ("product", "claude", "codex", "cursor"):
    original = module.REGISTRIES[host]
    mutated = tuple(
        replace(addon, lines=(*addon.lines, "Audit-only divergent shared binding."))
        if (addon.gate_id, addon.addon_id) == target else addon
        for addon in original
    )
    variable = {"product": "GATE_ADDONS", "claude": "CLAUDE_GATE_ADDONS",
                "codex": "CODEX_GATE_ADDONS", "cursor": "CURSOR_GATE_ADDONS"}[host]
    module.REGISTRIES[host] = mutated
    setattr(module, variable, mutated)
    module.test_registries_share_their_addon_slots()
    rejected = False
    try:
        module.test_shared_bindings_keep_one_spelling()
    except AssertionError:
        rejected = True
    outcomes[host] = {"slots_control_passed": True, "spelling_guard_rejected": rejected}
    module.REGISTRIES[host] = original
    setattr(module, variable, original)
assert outcomes["product"]["spelling_guard_rejected"] is False
assert outcomes["claude"]["spelling_guard_rejected"] is False
assert outcomes["codex"]["spelling_guard_rejected"] is True
assert outcomes["cursor"]["spelling_guard_rejected"] is True
result = {"slot": list(target), "outcomes": outcomes, "source_files_changed": False}
output = Path(__file__).parent / "parity-probe-results.json"
output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
print("PARITY_PROBE_COMPLETED")
