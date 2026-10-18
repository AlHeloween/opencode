"""RED fixture: proves the codex-hooks API is absent before implementation.

Run BEFORE codex_hooks.py exists and keep the output as RED evidence
(experiments/2026-10-18_codex-hooks/robot/red-evidence.txt). After
implementation the same assertions become the API-surface contract.
"""

from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_DIR = REPO_ROOT / "scripts" / "codex-hooks"

REQUIRED_API = (
    "handle_event",        # hook dispatch: event dict -> output dict
    "capture_pre_compact",  # PreCompact: full texts + SV + addresses -> SQLite
    "restore_context",      # PostCompact/SessionStart: labeled historical context
    "fossil_lookup",        # read-only provenance by exact sv:<md5> labels
    "collect_opencode",     # external robot completion via host read API
    "record_subagent_stop",  # immutable execution report
    "Store",                # SQLite codex_hook_* namespace wrapper
    "BUDGET_BYTES",         # injection budget: 256 KiB UTF-8
)


class TestApiSurface(unittest.TestCase):
    def test_module_exists(self):
        self.assertTrue(
            (MODULE_DIR / "codex_hooks.py").is_file(),
            "scripts/codex-hooks/codex_hooks.py must exist",
        )

    def test_module_importable(self):
        if str(MODULE_DIR) not in __import__("sys").path:
            __import__("sys").path.insert(0, str(MODULE_DIR))
        try:
            __import__("codex_hooks")
        except ImportError as error:  # the RED state itself — named, never silent
            self.fail(f"codex_hooks not importable yet (expected RED): {error}")

    def test_required_entrypoints_present(self):
        if str(MODULE_DIR) not in __import__("sys").path:
            __import__("sys").path.insert(0, str(MODULE_DIR))
        module = __import__("codex_hooks")
        missing = [name for name in REQUIRED_API if not hasattr(module, name)]
        self.assertEqual(missing, [], f"missing API: {missing}")

    def test_budget_is_256kib(self):
        if str(MODULE_DIR) not in __import__("sys").path:
            __import__("sys").path.insert(0, str(MODULE_DIR))
        module = __import__("codex_hooks")
        self.assertEqual(module.BUDGET_BYTES, 256 * 1024)


if __name__ == "__main__":
    unittest.main()
