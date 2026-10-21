"""t135 addendum 2 — the STALE-box check (candidate mechanism), proven on a fixture.

THE DEFECT IT CATCHES (owner, 2026-10-22): «stale план после 2-3 итераций изменений
может тупо устареть и кто нибудь его сделает и испортит код ничего не подозревая?»
Every open box is pinned to the code it was written against. If that code has
drifted since, the box is STALE. A STALE box can be dispatched only as a
re-grounding step, never executed as written.

THE PIN (one line, on the box or in the lines that follow it, up to the next box):
  <!-- pin: <repo-relative path> <sha256 of that file> -->
The path is repo-relative (forward slashes). The hash is the file's bytes as they
were when the box was written.

THE CHECK (one predicate per open box that carries a pin):
  - NO-PIN — the box carries no pin: not stale, not fresh, just unpinned (the check
    says so; it does not invent a pin).
  - FRESH — the file exists and its sha256 equals the pinned one.
  - STALE — the file is missing or its sha256 differs. The report names the box,
    the pinned hash and the current hash (or MISSING).

WHY IT IS A MECHANISM AND NOT A RULE: it is executable, it REPORTS (STALE named
with both hashes), and a dispatcher that reads it refuses to execute a STALE box
as written. The rule would be «re-ground old boxes»; this is the check that says
which ones are old.

Usage:
    python box_stale.py <plan-file> [--root <repo-root>]
Exit: 0 = no STALE box; 1 = at least one STALE box (named); 2 = usage/IO.
"""

import hashlib
import re
import sys
from pathlib import Path

BOX_RE = re.compile(r"^\s*- \[( |x|~)\] (.+)$")
PIN_RE = re.compile(r"<!--\s*pin:\s*(\S+)\s+([0-9a-fA-F]{64})\s*-->")


def file_sha(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def check_plan(plan: Path, root: Path) -> list[dict]:
    lines = plan.read_text(encoding="utf-8", errors="replace").split("\n")
    out = []
    for idx, line in enumerate(lines):
        m = BOX_RE.match(line)
        if not m or m.group(1) != " ":
            continue
        window = [line]
        for k in range(idx + 1, min(idx + 8, len(lines))):
            if BOX_RE.match(lines[k]):
                break
            window.append(lines[k])
        text = "\n".join(window)
        pin = PIN_RE.search(text)
        if not pin:
            out.append({"line": idx + 1, "box": m.group(2).strip()[:120], "status": "NO-PIN"})
            continue
        rel, pinned = pin.group(1).replace("\\", "/"), pin.group(2).lower()
        current = file_sha(root / rel)
        if current is None:
            out.append({"line": idx + 1, "box": m.group(2).strip()[:120], "status": "STALE",
                        "path": rel, "pinned": pinned, "current": "MISSING"})
        elif current.lower() == pinned:
            out.append({"line": idx + 1, "box": m.group(2).strip()[:120], "status": "FRESH",
                        "path": rel, "pinned": pinned})
        else:
            out.append({"line": idx + 1, "box": m.group(2).strip()[:120], "status": "STALE",
                        "path": rel, "pinned": pinned, "current": current})
    return out


def main(argv: list[str]) -> int:
    if not argv:
        sys.stderr.write(__doc__ or "")
        return 2
    plan = Path(argv[0])
    root = Path(argv[2]) if len(argv) > 2 and argv[1] == "--root" else Path(__file__).resolve().parents[1]
    if len(argv) > 2 and argv[1] != "--root":
        sys.stderr.write("usage: box_stale.py <plan-file> [--root <repo-root>]\n")
        return 2
    if not plan.is_file():
        sys.stderr.write(f"box_stale: no such file {plan}\n")
        return 2
    results = check_plan(plan, root)
    stale = [r for r in results if r["status"] == "STALE"]
    for r in results:
        if r["status"] == "STALE":
            print(f"STALE L{r['line']}: {r['box'][:80]} — {r['path']} pinned {r['pinned'][:12]}… current {str(r.get('current'))[:12]}…")
        else:
            print(f"{r['status']} L{r['line']}: {r['box'][:80]}")
    print(f"\n{len(results)} pinned box(es) checked · {len(stale)} STALE")
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
