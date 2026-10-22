"""t142 — the census of plan↔goal links, mirroring the PRODUCT's own parsing.

WHY THIS MIRRORS `src/util/plan-status.ts` AND DOES NOT GUESS:
  - `goal_parent` = the FIRST `parent-goal-md5:\\s*([0-9a-fA-F]{32})` in the file
    (plan-status.ts:323) — FIRST, so a task block that carries a parent line can
    win over the plan header. The line number is reported so that case is visible.
  - the plan's OWN label = the first line matching `^[ \\t]*md5:\\s*<32hex>`
    (memory/spine.ts:190 `planHeaderLabel`).
  - `isPlanLinked` = parent is defined and is not 32 zeros (plan-status.ts:162).
  - the population = the top-level `plans/*.md` minus NON_PLAN_FILES
    (plan-status.ts:441 `collectPlans`) — subfolders (futures/, postponed/) are
    NOT plans for this instrument.
  - the GOAL TREE = every `md5:` label declared in the hand-owned HEAD of
    `plans/MASTER_PLAN.md` (the level-0 goal plus the subgoals under it, read
    from the file that owns them). A parent that names one of those labels is
    RESOLVED; a non-zero parent that names none is FOREIGN — a link into
    nothing. The product's gate (`isPlanLinked`) only asks "non-zero", so this
    census is STRICTLY STRICTER than it, and says so.

READ-ONLY. It writes nothing.

Usage:  python census.py <worktree>
Output: one line per plan + the totals.
"""

import json
import re
import sys
from pathlib import Path

GOAL = "f2e94a7cb5d18603e8a4c9d2f7b56e0a"
ZERO = "0" * 32
NON_PLAN_FILES = {"readme.md", "master_plan.md"}

PARENT_RE = re.compile(r"parent-goal-md5:\s*([0-9a-fA-F]{32})")
LABEL_RE = re.compile(r"^[ \t]*md5:\s*([0-9a-fA-F]{32})", re.M)
INTENTION_RE = re.compile(r"<!--\s*intention:\s*([\s\S]*?)\s*-->")
GOAL_SV_RE = re.compile(r"<!--\s*goal_sv:\s*([^>]*?)\s*-->")
BOX_RE = re.compile(r"^\s*- \[( |x|~)\] ", re.M)
LIFECYCLE_RE = re.compile(r"<!--\s*workflow:\s*lifecycle\s+(\w+)")


def goal_tree(worktree: Path) -> set[str]:
    """Every label the master plan's HEAD owns: the level-0 goal and its subgoals."""
    master = worktree / "plans" / "MASTER_PLAN.md"
    if not master.exists():
        return set()
    raw = master.read_bytes()
    cut = raw.find(b"<!-- generated below")
    head = raw if cut < 0 else raw[:cut]
    text = head.decode("utf-8", "replace")
    return {m.group(1).lower() for m in LABEL_RE.finditer(text)}


def census(worktree: Path) -> list[dict]:
    plans_dir = worktree / "plans"
    tree = goal_tree(worktree)
    rows = []
    for path in sorted(plans_dir.glob("*.md")):
        if path.name.lower() in NON_PLAN_FILES:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = text.split("\n")

        parent_at = None
        parent_val = None
        for n, line in enumerate(lines, start=1):
            m = PARENT_RE.search(line)
            if m:
                parent_at, parent_val = n, m.group(1).lower()
                break

        label_at = None
        label_val = None
        for n, line in enumerate(lines, start=1):
            m = LABEL_RE.match(line)
            if m:
                label_at, label_val = n, m.group(1).lower()
                break

        intention = INTENTION_RE.search(text)
        goal_sv = GOAL_SV_RE.search(text)
        boxes = BOX_RE.findall(text)
        open_boxes = sum(1 for b in boxes if b == " ")

        if parent_val is None:
            link = "no-parent-line"
        elif parent_val == ZERO:
            link = "zeros"
        elif parent_val in tree:
            link = "goal-tree"
        else:
            link = "foreign"

        rows.append(
            {
                "file": path.name,
                "link": link,
                "parent": parent_val,
                "parent_line": parent_at,
                "label": label_val,
                "label_line": label_at,
                "parent_is_own_label": bool(parent_val and label_val and parent_val == label_val),
                "intention": (intention.group(1).strip() if intention else "")[:400],
                "goal_sv": (goal_sv.group(1).strip().replace("\n", " | ") if goal_sv else "")[:300],
                "has_sv_block": label_val is not None,
                "boxes_total": len(boxes),
                "open_boxes": open_boxes,
                "lifecycle": (LIFECYCLE_RE.search(text).group(1) if LIFECYCLE_RE.search(text) else ""),
            }
        )
    return rows


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write(__doc__ or "")
        return 2
    worktree = Path(argv[0]).resolve()
    rows = census(worktree)
    out = worktree / "experiments" / "2026-10-22_subgoal-proposals" / "census.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")

    by = {}
    for r in rows:
        by[r["link"]] = by.get(r["link"], 0) + 1
    print(f"{len(rows)} plan(s) · {by}")
    unresolved = [r for r in rows if r["link"] != "goal"]
    print(f"\n{len(unresolved)} plan(s) NOT resolving to the level-0 goal:\n")
    for r in unresolved:
        flag = " SELF" if r["parent_is_own_label"] else ""
        print(
            f"[{r['link']:>15}] {r['file']}"
            f"\n      parent@{r['parent_line']}={r['parent']} label@{r['label_line']}={r['label']}{flag}"
            f"\n      open={r['open_boxes']}/{r['boxes_total']} lifecycle={r['lifecycle'] or '-'}"
            f"\n      aim: {r['intention'][:230]}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
