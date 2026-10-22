"""t142 — the HEAD diff: what changed in the hand-owned part of MASTER_PLAN.md.

The head is every byte up to and including the `RENDER_MARKER` line
(`util/plan-status.ts:584`) — the part a human owns and the renderer preserves.
The BODY below the marker is generated and is not part of this diff.

BEFORE = the committed revision given on the command line (the state this task
started the apply from). AFTER = the working tree.

LINE ENDINGS: git's `core.autocrlf` writes LF into the blob and CRLF back into
the working tree, so the two sides differ in line endings by construction. The
diff therefore compares NORMALISED (CRLF -> LF) content, and prints the raw
byte facts of both sides so nothing is hidden by the normalisation.

READ-ONLY. Usage:  python head_diff.py <worktree> <before-rev>
"""

import difflib
import hashlib
import subprocess
import sys
from pathlib import Path

MARKER = b"<!-- generated below"
CR = b"\r"


def head_bytes(raw: bytes) -> bytes:
    cut = raw.find(MARKER)
    if cut < 0:
        raise SystemExit("head_diff: no RENDER_MARKER in the file")
    end = raw.find(b"\n", cut)
    return raw[: end + 1] if end >= 0 else raw[:cut]


def norm(raw: bytes) -> bytes:
    """CRLF -> LF, so the two sides are compared as CONTENT."""
    return raw.replace(b"\r\n", b"\n")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write(__doc__ or "")
        return 2
    worktree = Path(argv[0]).resolve()
    rev = argv[1]
    path = worktree / "plans" / "MASTER_PLAN.md"

    before_raw = subprocess.run(
        ["git", "show", f"{rev}:plans/MASTER_PLAN.md"],
        cwd=worktree,
        capture_output=True,
        check=True,
    ).stdout
    after_raw = path.read_bytes()

    before = head_bytes(before_raw)
    after = head_bytes(after_raw)

    print(f"before  {rev}  head_bytes {len(before)}  crlf {before.count(CR)}  sha256 {hashlib.sha256(before).hexdigest()}")
    print(f"after   working tree  head_bytes {len(after)}  crlf {after.count(CR)}  sha256 {hashlib.sha256(after).hexdigest()}")
    print(f"content (LF-normalised)  sha256 {hashlib.sha256(norm(before)).hexdigest()}")
    print(f"                          -> sha256 {hashlib.sha256(norm(after)).hexdigest()}")
    print(f"body    {len(before_raw) - len(before)} -> {len(after_raw) - len(after)} bytes (generated, not in this diff)")
    print()

    before_text = norm(before).decode("utf-8", "replace").splitlines(keepends=True)
    after_text = norm(after).decode("utf-8", "replace").splitlines(keepends=True)
    diff = list(
        difflib.unified_diff(before_text, after_text, fromfile=f"{rev}:head", tofile="working:head", n=2)
    )
    if not diff:
        print("the head is byte-identical")
        return 0
    sys.stdout.writelines(diff)
    added = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))
    print(f"\n+{added} / -{removed} lines in the head")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
