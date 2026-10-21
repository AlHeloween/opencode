"""t135 — the context around every open box: the section it lives in, the lines that
follow it (usually the oracle), and the receipt-ish lines anywhere in the plan.

The classification needs the ORACLE, not the box title: a box whose following lines
name a runnable oracle is a different animal from one that says «later» or «when the
owner decides».
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
PLANS = ROOT / "plans"
SKIP = {"readme.md", "master_plan.md"}

BOX_RE = re.compile(r"^\s*- \[( |x|~)\] (.+)$")
HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)$")
RECEIPT_RE = re.compile(
    r"(Actual \[Exact\]|Receipt:|receipt|run id|run_id|\b20\d{6}T\d{6}Z|\b[0-9a-f]{7,40}\b|"
    r"\bbun test\b|typecheck exit|_build\.ps1|cmd_runner|smoke)",
    re.I,
)
OWNER_RE = re.compile(
    r"(owner|владел|owner'?s? decision|решени\w* владельца|owner box|OWNER BOX|GATED on|"
    r"parked|postponed|BLOCKED|waiting-on-user|STOP before|await)",
    re.I,
)

manifests = json.loads((HERE / "manifests.json").read_text(encoding="utf-8"))
inventory = json.loads((HERE / "plan_inventory.json").read_text(encoding="utf-8"))["plans"]

out = []
for rec in inventory:
    path = PLANS / Path(rec["file"]).name
    lines = path.read_text(encoding="utf-8", errors="replace").split("\n")
    heading = "(none)"
    plan_manifest = manifests.get(path.stem, {})
    receipts = [
        f"L{i}: {l.strip()[:220]}"
        for i, l in enumerate(lines, start=1)
        if RECEIPT_RE.search(l) and not BOX_RE.match(l)
    ]
    owner_lines = [
        f"L{i}: {l.strip()[:220]}"
        for i, l in enumerate(lines, start=1)
        if OWNER_RE.search(l) and not BOX_RE.match(l)
    ]
    entries = []
    task_index = 0
    for idx, line in enumerate(lines):
        m = BOX_RE.match(line)
        if not m:
            continue
        task_index += 1
        # the task id, EXACTLY as parsePlanFiles computes it (util/plan-status.ts)
        rest = m.group(2).strip()
        bold = re.match(r"^\*\*([^*]+)\*\*(.*)$", rest)
        header = bold.group(1) if bold else rest
        named = None
        if bold:
            hit = re.match(r"^([A-Za-z0-9][A-Za-z0-9_-]*)", header)
            named = hit.group(1) if hit else None
        task_id = named or f"TASK-{task_index}"
        if m.group(1) != " ":
            continue
        # the section this box lives in
        for j in range(idx, -1, -1):
            h = HEADING_RE.match(lines[j])
            if h:
                heading = h.group(2).strip()
                break
        # the lines that follow, until the next box (max 14)
        after = []
        for k in range(idx + 1, min(idx + 15, len(lines))):
            if BOX_RE.match(lines[k]):
                break
            after.append(f"L{k + 1}: {lines[k].strip()[:300]}")
        entries.append(
            {
                "line": idx + 1,
                "text": m.group(2).strip(),
                "section": heading,
                "after": after,
                "manifest": plan_manifest.get(task_id),
                "task_id": task_id,
            }
        )
    out.append(
        {
            "file": rec["file"],
            "lifecycle": rec["lifecycle"],
            "open": rec["open"],
            "done": rec["done"],
            "partial": rec["partial"],
            "has_smoke": rec["has_smoke_section"],
            "smoke_na": rec["smoke_na"],
            "history": rec["history"],
            "receipt_lines": receipts[:40],
            "owner_lines": owner_lines[:25],
            "boxes": entries,
            "manifests": plan_manifest,
        }
    )

(HERE / "box_context.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

md = ["# t135 — box context: section, following lines, manifest, receipts", ""]
for plan in out:
    md.append(f"## {plan['file']}  — open {plan['open']} / done {plan['done']} · lifecycle {plan['lifecycle'] or 'UNKNOWN'}")
    if plan["manifests"]:
        for task, rec in plan["manifests"].items():
            md.append(f"- manifest `{task}`: state={rec.get('state')} eta={rec.get('etaTurns')} oracle={str(rec.get('oracle'))[:160]}")
    md.append("")
    for b in plan["boxes"]:
        man = b.get("manifest")
        tag = (
            f" · {b['task_id']} · manifest {man.get('state')}/eta{man.get('etaTurns')} · oracle {str(man.get('oracle'))[:110]}"
            if man
            else f" · {b['task_id']} · manifest MISSING"
        )
        md.append(f"- **L{b['line']}** [{b['section']}]{tag} — {b['text'][:200]}")
        for a in b["after"]:
            md.append(f"    {a}")
    md.append("")
(HERE / "box_context.md").write_text("\n".join(md), encoding="utf-8")
print(f"plans: {len(out)}  boxes: {sum(len(p['boxes']) for p in out)}")
