"""t135 — measure the open-plan debt, per plan, from the files themselves.

The parsers MIRROR packages/opencode/src/util/plan-status.ts (parseLifecycle and the
box regex) so the numbers this report prints are the numbers the runtime's own
plan-status prints — not a second opinion about what a plan is.

Reads:  plans/*.md (flat), git history for each plan file.
Writes: plan_inventory.json, open_boxes.md  (into this experiments folder)
"""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PLANS = ROOT / "plans"
SKIP = {"readme.md", "master_plan.md"}

BOX_RE = re.compile(r"^\s*- \[( |x|~)\] (.+)$")
WORKFLOW_RE = re.compile(r"<!--\s*workflow:\s*lifecycle\s+(\w+)(?:\s*\|\s*gate\s*(G\d+))?\s*-->")
HEAD_STATE_RE = re.compile(r"\*{0,2}(?:Status|Статус)\s*:\s*\*{0,2}\s*([A-Za-z][\w-]*)", re.I)
MACHINE_STATE_RE = re.compile(r"(?:^|\n)[^\S\n]*(?:state|status)\s*:\s*([A-Za-z][\w-]*)", re.I)
INTENTION_RE = re.compile(r"<!--\s*intention:\s*([^>]*?)\s*-->")
GOAL_SV_RE = re.compile(r"<!--\s*goal_sv:\s*([^>]*?)\s*-->")
HASH_RE = re.compile(r"\b[0-9a-f]{7,40}\b")
SMOKE_HEAD_RE = re.compile(r"^##+\s*Smoke Tests", re.I | re.M)
SMOKE_NA_RE = re.compile(r"smoke:\s*N/A", re.I)
PRIOR_ART_RE = re.compile(r"^##+\s*Prior art", re.I | re.M)
REUSE_RE = re.compile(r"reuse:\s*N/A", re.I)
STOP_CLAIM_RE = re.compile(r"^##+\s*Stop claim", re.I | re.M)


def git(*args: str) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return proc.stdout.strip()


def parse_lifecycle(content: str):
    """Mirror of parseLifecycle() in util/plan-status.ts."""
    m = WORKFLOW_RE.search(content)
    if m:
        return m.group(1)
    head = "\n".join(content.split("\n")[:40])
    m = HEAD_STATE_RE.search(head)
    if m:
        return m.group(1).upper()
    m = MACHINE_STATE_RE.search(head)
    if m:
        return m.group(1).upper()
    return None


def main() -> None:
    plans = sorted(p for p in PLANS.glob("*.md") if p.name.lower() not in SKIP)
    inventory = []
    boxes_md = ["# t135 — every open box, with the plan line it sits on", ""]

    for path in plans:
        content = path.read_text(encoding="utf-8", errors="replace")
        lines = content.split("\n")
        boxes = []
        for idx, line in enumerate(lines, start=1):
            m = BOX_RE.match(line)
            if not m:
                continue
            mark, text = m.group(1), m.group(2).strip()
            boxes.append(
                {
                    "line": idx,
                    "state": "open" if mark == " " else ("done" if mark == "x" else "partial"),
                    "text": text,
                    "has_sv_tag": "<!-- sv:" in line,
                    "has_manifest": "<!--" in line and ("done_pct" in line or "attempts" in line),
                }
            )
        open_boxes = [b for b in boxes if b["state"] == "open"]
        done_boxes = [b for b in boxes if b["state"] == "done"]
        partial = [b for b in boxes if b["state"] == "partial"]
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", str(path.relative_to(ROOT)).replace("\\", "/")],
            cwd=ROOT,
            capture_output=True,
        ).returncode == 0
        history = git("log", "-4", "--format=%h|%ad|%s", "--date=short", "--", str(path.relative_to(ROOT)).replace("\\", "/"))
        slug = path.stem
        mentions = git("log", "-6", "--format=%h|%ad|%s", "--date=short", "--grep", slug)
        record = {
            "file": f"plans/{path.name}",
            "tracked": tracked,
            "bytes": len(content),
            "lines": len(lines),
            "lifecycle": parse_lifecycle(content),
            "intention": (INTENTION_RE.search(content).group(1) if INTENTION_RE.search(content) else None),
            "goal_sv": (GOAL_SV_RE.search(content).group(1) if GOAL_SV_RE.search(content) else None),
            "has_smoke_section": bool(SMOKE_HEAD_RE.search(content)),
            "smoke_na": bool(SMOKE_NA_RE.search(content)),
            "has_prior_art": bool(PRIOR_ART_RE.search(content) or REUSE_RE.search(content)),
            "has_stop_claim": bool(STOP_CLAIM_RE.search(content)),
            "open": len(open_boxes),
            "done": len(done_boxes),
            "partial": len(partial),
            "open_boxes": open_boxes,
            "history": [h for h in history.split("\n") if h],
            "name_mentions": [h for h in mentions.split("\n") if h],
            "hash_count": len(set(HASH_RE.findall(content))),
        }
        inventory.append(record)

        boxes_md.append(f"## {path.name}  — open {len(open_boxes)} / done {len(done_boxes)} / partial {len(partial)}")
        boxes_md.append(f"- lifecycle: {record['lifecycle'] or 'UNKNOWN'} · smoke: "
                        f"{'section' if record['has_smoke_section'] else ('N/A' if record['smoke_na'] else 'MISSING')}"
                        f" · prior-art: {'yes' if record['has_prior_art'] else 'no'}"
                        f" · tracked: {'yes' if tracked else 'NO (untracked)'}")
        if record["history"]:
            boxes_md.append("- last commits touching this file: " + "; ".join(record["history"]))
        boxes_md.append("")
        for b in open_boxes:
            boxes_md.append(f"- L{b['line']}: {b['text']}")
        boxes_md.append("")

    totals = {
        "plans": len(inventory),
        "open": sum(r["open"] for r in inventory),
        "done": sum(r["done"] for r in inventory),
        "partial": sum(r["partial"] for r in inventory),
        "no_box_at_all": sum(1 for r in inventory if r["open"] == 0 and r["done"] == 0 and r["partial"] == 0),
        "no_smoke_section": sum(1 for r in inventory if not r["has_smoke_section"] and not r["smoke_na"]),
        "no_prior_art": sum(1 for r in inventory if not r["has_prior_art"]),
        "untracked": sum(1 for r in inventory if not r["tracked"]),
        "lifecycle_unknown": sum(1 for r in inventory if not r["lifecycle"]),
        "boxes_without_sv_tag": sum(1 for r in inventory for b in r["open_boxes"] if not b["has_sv_tag"]),
    }
    (HERE / "plan_inventory.json").write_text(
        json.dumps({"totals": totals, "plans": inventory}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (HERE / "open_boxes.md").write_text("\n".join(boxes_md), encoding="utf-8")
    print(json.dumps(totals, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
