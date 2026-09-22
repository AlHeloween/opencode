"""Read-only probe: what do the SV blocks in the rows actually carry?

The owner's proposal (2026-09-22) is to put keywords WITH WEIGHTS into the fold's table of
contents. Keywords were removed from the summary extractor on 2026-08-27 with the reason
"invented key_phrases had zero consumers" — so before they come back, measure what the rows
already contain, because a field nobody can trust is worse than an absent one.

Measured here, over every part that carries a Keywords line:
  - how many rows carry one at all;
  - how many terms per line (the format says 3-9);
  - how the weights sum (the format says 1.0);
  - whether the terms are ordered by descending weight.

The extraction is literal and validates nothing, exactly like `memory/spine.ts` — this script
only REPORTS the distribution, so the decision is made on numbers rather than on the format's
self-description.

Run: python experiments/2026-09-22_sv-keyword-quality/probe.py
"""

import json
import re
import sqlite3
import statistics
import sys
from pathlib import Path

DB = Path(__file__).resolve().parents[2] / ".opencode" / "data" / "opencode.db"
KEYWORDS = re.compile(r"^Keywords:\s*(.+)$", re.M)
# A term may be MULTI-WORD ("provider auth 0.30" is real traffic, not a malformed line) and the
# weight may carry trailing punctuation, so the term is everything before the last number on the
# chunk. The first attempt here required a single word and produced a false 36% failure rate -
# the filter was the instrument's fault, not the data's.
PAIR = re.compile(r"(.+?)\s+([0-9]*\.?[0-9]+)[.;\s]*$")


def parse_line(line: str):
    """Terms from the LEFT, stopping at the first chunk that is not `term weight`.

    Stopping rather than scanning on is the rule a reader needs: the samples show the model
    sometimes keeps THINKING inside the block ("… decisions-cap 0.15… wait - weights must sum
    1.0"), and absorbing that prose as a term is how an invented vector enters memory.
    """
    chunks = line.split(",")
    terms = []
    leftover = None
    for index, chunk in enumerate(chunks):
        match = PAIR.match(chunk.strip())
        if not match:
            leftover = ",".join(chunks[index:]).strip()[:120]
            break
        terms.append((match.group(1).strip(), float(match.group(2))))
    return (terms or None), leftover


def main() -> int:
    if not DB.exists():
        print(f"no database at {DB}")
        return 1
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute("SELECT data FROM part WHERE data LIKE '%Keywords:%'").fetchall()
    total_parts = con.execute("SELECT COUNT(*) FROM part").fetchone()[0]
    con.close()

    parsed = 0
    bad = 0
    stopped = 0
    samples = []
    counts = []
    sums = []
    ordered = 0
    for (raw,) in rows:
        try:
            text = json.loads(raw).get("text") or ""
        except Exception:
            text = raw
        match = KEYWORDS.search(text or "")
        if not match:
            bad += 1
            continue
        terms, leftover = parse_line(match.group(1))
        if not terms:
            bad += 1
            if len(samples) < 6:
                samples.append(match.group(1)[:160])
            continue
        if leftover:
            stopped += 1
            if len(samples) < 6:
                samples.append(f"[stopped at prose] {leftover}")
        parsed += 1
        counts.append(len(terms))
        sums.append(round(sum(w for _, w in terms), 3))
        if all(terms[i][1] >= terms[i + 1][1] for i in range(len(terms) - 1)):
            ordered += 1

    print(f"parts in db                : {total_parts}")
    print(f"parts with a Keywords line : {len(rows)}")
    print(f"  parsed                   : {parsed}")
    print(f"  parsed, then PROSE       : {stopped}")
    print(f"  unparseable              : {bad}")
    if counts:
        print(f"terms per line             : min {min(counts)} / median {statistics.median(counts)} / max {max(counts)}")
        print(f"  inside the 3-9 band      : {sum(1 for c in counts if 3 <= c <= 9)}/{len(counts)}")
        print(f"weight sum                 : min {min(sums)} / median {statistics.median(sums)} / max {max(sums)}")
        print(f"  within 0.01 of 1.0       : {sum(1 for s in sums if abs(s - 1.0) <= 0.01)}/{len(sums)}")
        print(f"descending order           : {ordered}/{len(counts)}")
    if samples:
        print("\nunparseable samples (literal, so the shape is visible instead of assumed):")
        for sample in samples:
            print(f"  | {sample}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
