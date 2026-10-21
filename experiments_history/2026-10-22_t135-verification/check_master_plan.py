"""t136 — MASTER_PLAN render check.

Answers three questions with bytes, not with prose:
  1. is the hand-owned head (everything up to and including the render marker)
     byte-identical between the parent and the triage commit?
  2. how many plan entries does the rendered body carry, and does that equal the
     number of plan files under plans/ at the same commit?
  3. does every plan file under plans/ appear in the body, and vice versa?

Run:  python experiments/2026-10-22_t135-verification/check_master_plan.py
"""

import re
import subprocess
import sys

REPO = "D:\\zPython\\opencode"
MARKER = "<!-- generated below"


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace"
    ).stdout


def text_at(rev: str, path: str) -> str:
    return git("show", f"{rev}:{path}")


def split_head(body: str) -> tuple[str, str]:
    cut = body.find(MARKER)
    if cut == -1:
        return "", body
    return body[: cut + len(MARKER)], body[cut + len(MARKER) :]


def plan_files(rev: str) -> list[str]:
    """Top-level plan files under plans/ at a revision (no recursion, no README)."""
    out = []
    for name in git("ls-tree", "--name-only", f"{rev}:plans").splitlines():
        if name.endswith(".md") and name not in ("MASTER_PLAN.md", "README.md"):
            out.append(name)
    return out


def body_entries(body: str) -> list[str]:
    """Plan entries the renderer emits: a line naming a file under plans/."""
    return re.findall(r"^- `plans/([^`]+\.md)`", body, flags=re.M)


def main() -> int:
    rev = sys.argv[1] if len(sys.argv) > 1 else "e4b2313eb0"
    parent = rev + "~1"

    before = text_at(parent, "plans/MASTER_PLAN.md")
    after = text_at(rev, "plans/MASTER_PLAN.md")

    head_b, body_b = split_head(before)
    head_a, body_a = split_head(after)

    print(f"revision            : {rev} (parent {parent})")
    print(f"head bytes          : parent={len(head_b)} child={len(head_a)}")
    print(f"HEAD BYTE-IDENTICAL : {head_b == head_a}")
    print(f"total bytes         : parent={len(before)} child={len(after)} delta={len(after) - len(before)}")
    print(f"body bytes          : parent={len(body_b)} child={len(body_a)}")

    files = plan_files(rev)
    entries = body_entries(body_a)
    print(f"plan files in tree  : {len(files)}")
    print(f"plan entries in body: {len(entries)}")

    missing = sorted(set(files) - set(entries))
    extra = sorted(set(entries) - set(files))
    print(f"in tree, NOT in body: {len(missing)} {missing if missing else ''}")
    print(f"in body, NOT in tree: {len(extra)} {extra if extra else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
