"""LOSSLESS oracle for the AGENTS.md split (2026-10-13).

Unit: a PARAGRAPH = blank-line-separated block, further split at top-level list
items (`- ` / `N. `) — an item with its continuation lines is one paragraph, and
it is atomic for this check: it must be found whole, either in the new
AGENTS.md or somewhere under docs/. Whitespace is normalized before matching
(so wrapped lines may re-wrap freely); characters must match exactly.

Every paragraph of the OLD AGENTS.md (git show HEAD:AGENTS.md) must be found as
a contiguous normalized substring of the NEW corpus:
  AGENTS.md (unless --no-agents) + every docs/**/*.md file.

Prints: not-found count (must be 0) + the new AGENTS.md size.
Exit 0 iff 0 paragraphs are not found; exit 1 otherwise (naming the misses;
the full list is also written to misses.txt next to this script).

Usage (from repo root, BEFORE the commit):
  python experiments/2026-10-13_agents-md-split/lossless.py
  python experiments/2026-10-13_agents-md-split/lossless.py --no-agents   # negative control
"""
import re
import subprocess
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
HERE = pathlib.Path(__file__).resolve().parent
INCLUDE_AGENTS = "--no-agents" not in sys.argv[1:]


def paragraphs(text: str):
    """Blank-line blocks, split at top-level list items. Returns [(start, end, text)]."""
    lines = text.split("\n")
    blocks = []
    start = None
    buf = []
    for i, l in enumerate(lines, 1):
        if l.strip() == "":
            if buf:
                blocks.append((start, i - 1, "\n".join(buf)))
            buf = []
            start = None
            continue
        if start is None:
            start = i
        buf.append(l)
    if buf:
        blocks.append((start, len(lines), "\n".join(buf)))

    out = []
    for (a, b, t) in blocks:
        bl = t.split("\n")
        cur = []
        cur_start = a
        for j, l in enumerate(bl):
            if re.match(r"^(- |\d+\. )", l) and cur:
                out.append((cur_start, a + j - 1, "\n".join(cur)))
                cur = [l]
                cur_start = a + j
            else:
                cur.append(l)
        if cur:
            out.append((cur_start, b, "\n".join(cur)))
    return out


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


raw = subprocess.run(
    ["git", "show", "HEAD:AGENTS.md"], cwd=ROOT, capture_output=True
).stdout.decode("utf-8")
old_paras = paragraphs(raw)

new_agents_path = ROOT / "AGENTS.md"
new_agents = new_agents_path.read_text(encoding="utf-8")

corpus_parts = []
if INCLUDE_AGENTS:
    corpus_parts.append(norm(new_agents))
n_docs = 0
for p in sorted(DOCS.rglob("*.md")):
    corpus_parts.append(norm(p.read_text(encoding="utf-8")))
    n_docs += 1
corpus = "\n".join(corpus_parts)

misses = []
for (a, b, t) in old_paras:
    n = norm(t)
    if n and n not in corpus:
        misses.append((a, b, n))

print(f"old file:  {len(raw.splitlines())} lines, {len(raw.encode('utf-8'))} bytes, "
      f"{len(old_paras)} paragraphs")
print(f"new AGENTS.md: {len(new_agents.encode('utf-8'))} bytes, "
      f"{len(new_agents.splitlines())} lines"
      f"{'' if INCLUDE_AGENTS else ' (EXCLUDED from corpus — negative control)'}")
print(f"corpus: {'AGENTS.md + ' if INCLUDE_AGENTS else ''}{n_docs} docs file(s)")
print(f"NOT FOUND: {len(misses)}")
report = [f"MISS L{a}-{b}: {n}" for (a, b, n) in misses]
for line in report[:60]:
    print("  " + line[:150])
if len(report) > 60:
    print(f"  … {len(report) - 60} more (see misses.txt)")
(HERE / "misses.txt").write_text("\n".join(report) + "\n", encoding="utf-8")

sys.exit(0 if not misses else 1)
