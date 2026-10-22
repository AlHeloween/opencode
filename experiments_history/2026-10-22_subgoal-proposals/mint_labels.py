"""t142 — mint 32-hex LABELS for the vectors this task creates.

WHY A SCRIPT AND NOT A HASH: an `@SV_FORMAT` md5 is a LABEL, not a checksum
(kernel §1.2: «a distinct high-entropy label for linking and ranking these
vectors, not a checksum. Do not compute or verify it»). So the label is RANDOM
HEX — what needs a machine is not the randomness but the two facts a hand
cannot guarantee:

  1. it is exactly 32 hex characters (the tree already carries TWO plans whose
     md5 is 31 characters — `2026-10-16_self-edit-directive.md` and
     `2026-10-21_delegator-memory-repair.md` — which is why their labels are
     invisible to `planHeaderLabel` and to the coupling watcher);
  2. it does not collide with ANY label already in the tree.

The script collects every `md5:` line in `plans/` (the label set the coupling
watcher reads) and hands out labels that are not in it.

Usage:  python mint_labels.py <worktree> <count>
"""

import re
import secrets
import sys
from pathlib import Path

LABEL_RE = re.compile(r"^[ \t]*md5:\s*([0-9a-fA-F]{32})", re.M)


def existing_labels(plans_dir: Path) -> set[str]:
    labels: set[str] = set()
    for path in plans_dir.glob("*.md"):
        text = path.read_text(encoding="utf-8", errors="replace")
        labels.update(m.group(1).lower() for m in LABEL_RE.finditer(text))
    return labels


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write(__doc__ or "")
        return 2
    worktree = Path(argv[0]).resolve()
    count = int(argv[1])

    taken = existing_labels(worktree / "plans")
    # The level-0 goal's own label is in the master plan's head, not in a plan file.
    taken.add("f2e94a7cb5d18603e8a4c9d2f7b56e0a")

    minted: list[str] = []
    while len(minted) < count:
        candidate = secrets.token_hex(16)
        assert len(candidate) == 32, candidate
        if candidate in taken:
            continue
        taken.add(candidate)
        minted.append(candidate)

    for i, label in enumerate(minted, start=1):
        print(f"{i:>2}  {label}")
    print(f"\n{len(taken)} labels known in the tree; {len(minted)} minted, all 32-hex and unique.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
