from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import hashlib
import json
import pytest


@pytest.fixture
def evidence_context(tmp_path):
    root = tmp_path / "project"
    (root / "plans").mkdir(parents=True)
    (root / "src").mkdir()
    (root / ".codegraph").mkdir()
    (root / "plans/MASTER_PLAN.md").write_text(
        "## Goal — level 0\nKnown verifiable state.\n\n## Checks\n", encoding="utf-8")
    (root / "plans/task.md").write_text("state: ACTIVE\n- [ ] T1 — verify state\n", encoding="utf-8")
    (root / "src/state.py").write_text("def observe(): return 'state'\n", encoding="utf-8")
    for name in ("graph.txt", "explorer.txt", "parent.txt"):
        (root / name).write_text("fixture observation from " + name, encoding="utf-8")

    def pin(name):
        return {"path": name, "sha256": hashlib.sha256((root / name).read_bytes()).hexdigest()}

    goal_hash = hashlib.sha256(b"## Goal \xe2\x80\x94 level 0\nKnown verifiable state.\n\n").hexdigest()
    strategy = {"plan_pin": pin("plans/task.md"), "master_goal_sha256": goal_hash,
                "alignment_verdict": "SUPPORTED",
                "contribution": "T1 makes state observable", "evidence_pins": [pin("src/state.py")]}
    inventory_hash = hashlib.sha256(json.dumps(["plans/task.md"], separators=(",", ":")).encode()).hexdigest()
    return {
        "worktree": str(root), "plan_path": "plans/task.md", "scope": "src/state.py",
        "required_symbols": ["observe"], "impact_analysis": True, "consumers_identified": True,
        "acceptance_covered": True, "oracle": "PASS", "critical_risks": 0,
        "PLAN_STRATEGY": strategy,
        "STRUCTURAL_EVIDENCE": {"scope": "src/state.py", "method": "codegraph", "owner": "tool",
                                "query_or_reason": "observe consumers", "symbols": ["observe"],
                                "source_pins": [pin("src/state.py")], "result_pin": pin("graph.txt")},
        "PORTFOLIO_AUDIT": {"inventory_sha256": inventory_hash, "master_goal_sha256": goal_hash,
                            "entries": [strategy], "explorer_id": "child-1", "parent_id": "root-1",
                            "explorer_report_pin": pin("explorer.txt"), "parent_verification_pin": pin("parent.txt"),
                            "unaccounted": [], "unaligned": []},
    }
