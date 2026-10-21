"""t135 — the plan ADMISSION gate (candidate mechanism), proven on a fixture.

THE DEFECT IT CATCHES (measured 2026-10-22 over plans/*.md): an open box whose text
names neither a BINDING (a concrete path/symbol) nor an ORACLE (an instrument that
could fail) cannot be executed by anybody — robot or owner — because nothing states
what to run or what "done" would look like. 198 of the 211 open boxes had no oracle
in the SVM manifest store, and the share with no inline oracle is measured by
`make_report.py`.

THE GATE (one predicate, three parts, evaluated per OPEN box):
  1. BINDING — the box (or the lines that follow it, up to the next box) names a
     concrete path (`packages/opencode/src/...`, `test/tool/x.test.ts`) or a
     path:line. A box that says «сделать красиво» names nothing to touch.
  2. ORACLE — either (a) the SVM manifest store holds a record for this task with a
     non-empty `oracle` (the store's own field, session/svm.ts), or (b) the box text
     states an instrument: «Oracle:», «oracle=», a predicted result («→ PASS»,
     «Predicted»), a command (`bun test`, `cmd_runner`, `pytest`, `_build.ps1`,
     `dbread`, `grep`, `codegraph`), or a run id.
  3. THE PLAN carries a smoke section (`## Smoke Tests`) or says `smoke: N/A`.

WHY IT IS A MECHANISM AND NOT A RULE: it is executable, it REFUSES (non-zero exit,
the offending boxes named), and it has exactly one place to live — the commit route
`scripts/commit_own.py`, which is already the only way a plan enters the tree in
this repo (t66). The rule would be «write executable boxes»; the mechanism is
`plan_admission.py` refusing the commit that adds a plan whose boxes are not
executable.

Usage:
    python plan_admission.py <plans-dir> [--store <svm-store-dir>]
Exit: 0 = every open box is admissible; 1 = at least one plan is refused (named);
2 = usage/IO error.
"""

import json
import re
import sys
from pathlib import Path

BOX_RE = re.compile(r"^\s*- \[( |x|~)\] (.+)$")
# A concrete path or a path:line — the thing an executor would open.
PATH_RE = re.compile(
    r"(?:\b[\w.-]+/[\w./-]+|[\w.-]+\.(?:ts|tsx|js|mts|jsx|py|go|rs|zig|md|json|jsonc|ps1|sh|cmd|txt|ya?ml|xml|sql|html|css))\b"
)
LINE_RE = re.compile(r"[\w./-]+\.[A-Za-z]{1,4}:\d")
# An instrument that could fail.
ORACLE_MARK_RE = re.compile(
    r"(?:\boracle\b\s*[:=]|\bOracle\b|→\s*PASS|\bPredicted\b|\bprediction\b|"
    r"\bbun test\b|\bcmd_runner\b|\bpytest\b|\b_build\.ps1\b|\bdbread\b|\bcodegraph\b|\bgrep\b|"
    r"\btypecheck\b|\bprobe\b|\bverifier\b|\breproducer\b|\baccept(?:ance)?\b|\bcmp\b|\bdiff\b)",
    re.I,
)
RUN_ID_RE = re.compile(r"\b20\d{6}T\d{6}Z_\w+")
SMOKE_HEAD_RE = re.compile(r"^##+\s*Smoke Tests", re.I | re.M)
SMOKE_NA_RE = re.compile(r"smoke:\s*N/A", re.I)


def task_id(rest: str, index: int) -> str:
    """The task id, EXACTLY as util/plan-status.ts computes it."""
    bold = re.match(r"^\*\*([^*]+)\*\*(.*)$", rest.strip())
    header = bold.group(1) if bold else rest.strip()
    if bold:
        hit = re.match(r"^([A-Za-z0-9][A-Za-z0-9_-]*)", header)
        if hit:
            return hit.group(1)
    return f"TASK-{index}"


def store_oracle(store: Path, plan_stem: str, task: str) -> str | None:
    rec = store / plan_stem / f"{task}.json"
    if not rec.is_file():
        return None
    try:
        data = json.loads(rec.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None
    oracle = (data.get("oracle") or "").strip()
    return oracle or None


def audit_plan(path: Path, store: Path) -> dict:
    content = path.read_text(encoding="utf-8", errors="replace")
    lines = content.split("\n")
    has_smoke = bool(SMOKE_HEAD_RE.search(content) or SMOKE_NA_RE.search(content))
    open_boxes = []
    index = 0
    for idx, line in enumerate(lines):
        m = BOX_RE.match(line)
        if not m:
            continue
        index += 1
        if m.group(1) != " ":
            continue
        task = task_id(m.group(2), index)
        # the box + the lines that follow it, up to the next box
        window = [m.group(2)]
        for k in range(idx + 1, min(idx + 15, len(lines))):
            if BOX_RE.match(lines[k]):
                break
            window.append(lines[k])
        text = "\n".join(window)
        has_binding = bool(PATH_RE.search(text) or LINE_RE.search(text))
        has_oracle = bool(ORACLE_MARK_RE.search(text) or RUN_ID_RE.search(text))
        oracle_src = "inline"
        if not has_oracle:
            found = store_oracle(store, path.stem, task)
            if found:
                has_oracle = True
                oracle_src = "manifest"
        open_boxes.append(
            {
                "task": task,
                "line": idx + 1,
                "binding": has_binding,
                "oracle": has_oracle,
                "oracle_src": oracle_src if has_oracle else None,
                "text": m.group(2).strip()[:160],
            }
        )
    refused = [b for b in open_boxes if not (b["binding"] and b["oracle"])]
    return {
        "file": path.name,
        "has_smoke": has_smoke,
        "open": len(open_boxes),
        "refused": refused,
        "admissible": not refused and has_smoke,
    }


def main(argv: list[str]) -> int:
    if not argv:
        sys.stderr.write(__doc__ or "")
        return 2
    plans_dir = Path(argv[0])
    store = Path(argv[1]) if len(argv) > 1 else ROOT_DEFAULT / ".opencode" / "data" / "storage" / "svm" / "task"
    if not plans_dir.is_dir():
        sys.stderr.write(f"plan_admission: no such directory {plans_dir}\n")
        return 2
    plans = sorted(p for p in plans_dir.glob("*.md") if p.name.lower() not in {"readme.md", "master_plan.md"})
    reports = [audit_plan(p, store) for p in plans]
    bad = [r for r in reports if not r["admissible"]]
    for r in bad:
        print(f"REFUSED {r['file']}: {len(r['refused'])} open box(es) without a binding+oracle"
              + ("" if r["has_smoke"] else " · no ## Smoke Tests section"))
        for b in r["refused"]:
            why = []
            if not b["binding"]:
                why.append("no binding")
            if not b["oracle"]:
                why.append("no oracle")
            print(f"    L{b['line']} {b['task']}: {'+'.join(why)} — {b['text'][:110]}")
    total_open = sum(r["open"] for r in reports)
    refused_boxes = sum(len(r["refused"]) for r in reports)
    print(
        f"\n{len(plans)} plan(s) · {total_open} open box(es) · "
        f"{refused_boxes} box(es) would be refused ({100.0 * refused_boxes / max(total_open, 1):.1f}%) · "
        f"{len(bad)} plan(s) refused"
    )
    return 1 if bad else 0


ROOT_DEFAULT = Path(__file__).resolve().parents[2]

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
