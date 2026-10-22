"""t142 — the head hash of `plans/MASTER_PLAN.md`: the hand-owned part, byte for byte.

THE MARKER IS THE PRODUCT'S (util/plan-status.ts:584 `RENDER_MARKER`), copied
verbatim — the boundary between what a human owns and what `svm render` owns.
The hash covers every byte UP TO AND INCLUDING the marker line, so a render that
rewrites the body below cannot move it.

READ-ONLY.

Usage:  python head_hash.py <worktree>
"""

import hashlib
import sys
from pathlib import Path

RENDER_MARKER = (
    "<!-- generated below — `svm render` (S4): every value here is READ from its source; the source wins -->"
)


def head_bytes(path: Path) -> bytes:
    raw = path.read_bytes()
    marker = RENDER_MARKER.encode("utf-8")
    cut = raw.find(marker)
    if cut < 0:
        raise SystemExit("head_hash: no RENDER_MARKER in the file — the head cannot be located")
    return raw[: cut + len(marker)]


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write(__doc__ or "")
        return 2
    worktree = Path(argv[0]).resolve()
    path = worktree / "plans" / "MASTER_PLAN.md"
    head = head_bytes(path)
    whole = path.read_bytes()
    print(f"file          {path}")
    print(f"head_bytes    {len(head)}")
    print(f"head_sha256   {hashlib.sha256(head).hexdigest()}")
    print(f"whole_sha256  {hashlib.sha256(whole).hexdigest()}")
    print(f"whole_bytes   {len(whole)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
