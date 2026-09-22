"""Calibrate ΔSV on real rows before any threshold is written into the code.

ADID 12.2 (§I.14.3) says: SV = Embed(msg); ΔSV = ||SV - SV_prev||; if ΔSV >= 0.4 then reverse-search
until ΔSV < 0.3. Those numbers were written for a different embedding. What we actually have is a
weighted term vector per message (Keywords: term w, ...), and the distance we can compute honestly
is L1 over the union of terms — which lives on [0, 2] for vectors whose weights sum to 1, not on the
[0, 1] the document assumed. Copying 0.4 would therefore be a number nobody measured.

This prints the distribution so the threshold is chosen from the data, and the choice is recorded
with it. A marker that never fires is dead; one that fires on every line is noise.

Run: python experiments/2026-09-22_sv-delta/calibrate.py
"""

import json
import re
import sqlite3
import statistics
import sys
from pathlib import Path

DB = Path(__file__).resolve().parents[2] / ".opencode" / "data" / "opencode.db"
KEYWORDS = re.compile(r"^Keywords:\s*(.+)$", re.M)
PAIR = re.compile(r"(.+?)\s+([0-9]*\.?[0-9]+)[.;\s]*$")
THRESHOLDS = [0.4, 0.6, 0.8, 1.0, 1.2, 1.4]


def parse(line: str) -> dict[str, float] | None:
    """Terms from the left, stopping at the first chunk that is not `term weight`."""
    terms: dict[str, float] = {}
    for chunk in line.split(","):
        match = PAIR.match(chunk.strip())
        if not match:
            break
        terms[match.group(1).strip()] = float(match.group(2))
    return terms or None


def l1(a: dict[str, float], b: dict[str, float]) -> float:
    """Manhattan distance over the union — the same metric family the kernel uses."""
    return round(sum(abs(a.get(t, 0.0) - b.get(t, 0.0)) for t in set(a) | set(b)), 3)


def main() -> int:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT message_id, data FROM part WHERE data LIKE '%Keywords:%' ORDER BY id"
    ).fetchall()
    con.close()

    per_message: dict[str, dict[str, float]] = {}
    for message_id, raw in rows:
        try:
            text = json.loads(raw).get("text") or ""
        except Exception:
            text = raw
        match = KEYWORDS.search(text or "")
        if not match:
            continue
        terms = parse(match.group(1))
        if terms:
            per_message[message_id] = terms

    seq = list(per_message.items())
    if len(seq) < 3:
        print(f"not enough vectors to calibrate: {len(seq)}")
        return 1
    distances = [(l1(seq[i - 1][1], seq[i][1]), seq[i][0]) for i in range(1, len(seq))]
    values = [d for d, _ in distances]

    # MEASURED FIRST, AND IT KILLED THE OBVIOUS METRIC: consecutive vectors are disjoint (median
    # 2.0 = the ceiling), so "neighbour against neighbour" flags 97% of all pairs and discriminates
    # nothing. A marker that always fires is not a marker. The alternatives below ask the question
    # the owner actually has - «where did the work leave the window's axis» - rather than «did the
    # topic change between two messages», which it always does.
    def aggregate(terms: list[dict[str, float]]) -> dict[str, float]:
        total: dict[str, float] = {}
        for entry in terms:
            for term, weight in entry.items():
                total[term] = total.get(term, 0.0) + weight
        count = max(1, len(terms))
        return {term: value / count for term, value in total.items()}

    def jaccard(a: set[str], b: set[str]) -> float:
        return round(len(a & b) / len(a | b), 3) if (a | b) else 1.0

    axis_windows = [5, 20]
    print()
    for window in axis_windows:
        axis_values = []
        for i in range(1, len(seq)):
            previous = [terms for _, terms in seq[max(0, i - window) : i]]
            axis_values.append(l1(aggregate(previous), seq[i][1]))
        axis_values.sort()
        print(f"vs the window's axis (last {window:>2} messages, mean weight per term): "
              f"min {axis_values[0]} / median {axis_values[len(axis_values) // 2]} / "
              f"p90 {axis_values[int(len(axis_values) * 0.9)]} / max {axis_values[-1]}")
        hits = [d for d in axis_values if d >= 1.0]
        print(f"  ΔSV >= 1.0 → {len(hits)} of {len(axis_values)} ({100.0 * len(hits) / len(axis_values):.1f}%)")

    jumps = []
    for i in range(1, len(seq)):
        previous = set(seq[i - 1][1])
        current = set(seq[i][1])
        jumps.append((1.0 - jaccard(previous, current), seq[i][0]))
    jumps.sort(reverse=True)
    print(f"\nterm-set churn between neighbours (1 - Jaccard): min {min(j for j, _ in jumps)} / "
          f"median {sorted(j for j, _ in jumps)[len(jumps) // 2]} / max {max(j for j, _ in jumps)}")

    print(f"\nvectors (messages with their own Keywords line): {len(seq)}")
    print(f"consecutive ΔSV (L1 over the union, range 0..2) : "
          f"min {min(values)} / median {statistics.median(values)} / "
          f"p90 {sorted(values)[int(len(values) * 0.9)]} / max {max(values)}")

    # THE SIGNAL THAT ACTUALLY EXISTS. ADID §I.14.3.1 wants exactly this: «if the Content Window
    # shifted then perform reverse search via semantic_link». The link is not something we must
    # compute - the model WRITES it: every vector carries `md5` and `prev-md5`, and a break in that
    # chain is a place where the thread was interrupted. Measured below: does it discriminate?
    # FIELD ANCHORED TO ITS LINE. The first version used rfind("md5:") and was WRONG: the last
    # occurrence of that substring is inside `parent-goal-md5:`, so it compared prev-md5 against the
    # PARENT GOAL hash and reported an 86% "broken chain" that was pure instrument error. A filter
    # that cannot tell two fields apart is part of the instrument, not of the data.
    own_re = re.compile(r"^md5:\s*([0-9a-f]{32})", re.M)
    prev_re = re.compile(r"^prev-md5:\s*([0-9a-f]{32})", re.M)
    chain_part: dict[str, tuple[str | None, str | None]] = {}
    for message_id, raw in rows:
        try:
            text = json.loads(raw).get("text") or ""
        except Exception:
            text = raw
        own_matches = own_re.findall(text)
        prev_matches = prev_re.findall(text)
        own = own_matches[-1] if own_matches else None
        previous = prev_matches[-1] if prev_matches else None
        if own or previous:
            chain_part[message_id] = (own, previous)

    ordered = list(chain_part.items())
    linked = broken = start = unknown = 0
    breaks = []
    for i in range(1, len(ordered)):
        previous_own = ordered[i - 1][1][0]
        current_prev = ordered[i][1][1]
        if current_prev is None or previous_own is None:
            unknown += 1
        elif current_prev == previous_own:
            linked += 1
        elif current_prev == "0" * 32:
            start += 1
        else:
            broken += 1
            breaks.append(ordered[i][0])
    print(f"\nprev-md5 chain over {len(ordered)} vectors with a chain field: "
          f"linked {linked} / chain-start {start} / BROKEN {broken} / unreadable {unknown}")
    for message_id in breaks[:8]:
        print(f"  break at {message_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
