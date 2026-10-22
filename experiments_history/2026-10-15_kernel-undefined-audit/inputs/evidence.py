"""Read-only evidence consumers for G6/G9. Digests detect drift, not truth."""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
import re

LOG = logging.getLogger(__name__)
NON_PLANS = {"master_plan.md", "readme.md", "agents.md"}


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _pin_current(pin: object, root: Path) -> bool:
    if not isinstance(pin, dict) or not isinstance(pin.get("path"), str):
        return False
    target = (root / pin["path"]).resolve()
    if not target.is_relative_to(root):
        return False
    try:
        return _digest(target.read_bytes()) == pin.get("sha256")
    except OSError as error:
        LOG.debug("Evidence pin unavailable: %s: %s", target, error)
        return False


def _pins_current(pins: object, root: Path) -> bool:
    return isinstance(pins, list) and bool(pins) and all(_pin_current(p, root) for p in pins)


def _master_goal(root: Path) -> str:
    text = (root / "plans/MASTER_PLAN.md").read_text(encoding="utf-8-sig")
    match = re.search(r"^## Goal[^\n]*\n.*?(?=^## |\Z)", text, re.M | re.S)
    return _digest(match[0].encode("utf-8")) if match else ""


def _strategy(record: object, root: Path, goal: str) -> bool:
    valid = (isinstance(record, dict) and bool(goal)
            and record.get("master_goal_sha256") == goal
            and record.get("alignment_verdict") == "SUPPORTED"
            and isinstance(record.get("contribution"), str) and bool(record["contribution"].strip())
            and _pin_current(record.get("plan_pin"), root)
            and _pins_current(record.get("evidence_pins"), root))
    if not valid:
        return False
    text = (root / record["plan_pin"]["path"]).read_text(encoding="utf-8-sig")
    boxes = re.findall(r"^\s*- \[x\] (.+)$", text, re.M)
    checks = record.get("completion_checks", [])
    return (isinstance(checks, list)
            and all(isinstance(c, dict) and _pins_current(c.get("source_pins"), root)
                    and _pins_current(c.get("oracle_pins"), root)
                    and c.get("result") in ("PASS", "EXPECTED_FAIL") for c in checks)
            and sorted(c.get("box", "") for c in checks) == sorted(boxes))


def check_evidence(kind: str, context: dict) -> bool:
    """Consume pinned records, re-reading their scope and files at the gate."""
    if not isinstance(context.get("worktree"), str):
        return False
    record = context.get(kind)
    if not isinstance(record, dict):
        return False
    try:
        root = Path(context["worktree"]).resolve()
        if kind == "STRUCTURAL_EVIDENCE":
            if not (isinstance(record.get("scope"), str) and bool(record["scope"])
                    and record["scope"] == context.get("scope")
                    and record.get("owner") and record.get("query_or_reason")
                    and _pins_current(record.get("source_pins"), root)
                    and _pin_current(record.get("result_pin"), root)):
                return False
            method = record.get("method")
            if method == "codegraph":
                required, observed = context.get("required_symbols"), record.get("symbols")
                return (isinstance(required, list) and bool(required)
                        and isinstance(observed, list) and set(required) <= set(observed))
            if method == "no_index":
                return not (root / ".codegraph").exists()
            if method == "not_applicable":
                return (context.get("scope_kind") == "documentation"
                        and not context.get("required_symbols")
                        and all(Path(p["path"]).suffix.lower() in (".md", ".txt")
                                for p in record["source_pins"]))
            if method == "verified_fallback":
                return _pin_current(record.get("qualification_pin"), root)
            return False
        goal = _master_goal(root)
        if kind == "PLAN_STRATEGY":
            return (_strategy(record, root, goal)
                    and record["plan_pin"]["path"] == context.get("plan_path"))
        if kind == "PORTFOLIO_AUDIT":
            plans = sorted("plans/" + p.name for p in (root / "plans").glob("*.md")
                           if p.is_file() and p.name.lower() not in NON_PLANS)
            inventory = _digest(json.dumps(plans, separators=(",", ":")).encode())
            entries = record.get("entries")
            if not (isinstance(entries, list) and record.get("inventory_sha256") == inventory
                    and record.get("master_goal_sha256") == goal and bool(goal)
                    and record.get("unaccounted") == [] and record.get("unaligned") == []
                    and record.get("explorer_id") and record.get("parent_id")
                    and record["explorer_id"] != record["parent_id"]
                    and _pin_current(record.get("explorer_report_pin"), root)
                    and _pin_current(record.get("parent_verification_pin"), root)):
                return False
            if not all(_strategy(entry, root, goal) for entry in entries):
                return False
            return sorted(entry["plan_pin"]["path"] for entry in entries) == plans
        return False
    except (OSError, ValueError, TypeError) as error:
        LOG.debug("Evidence contract unavailable (%s): %s", kind, error)
        return False
