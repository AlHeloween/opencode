"""Cut the dead sidecar machinery out of the working code, by ANCHOR, with the seam printed.

Why a script and not an editor call: the region is ~300 lines and an editor needs it reproduced
byte-for-byte; a single mismatch costs a turn and teaches nothing. The anchors here are asserted to
be UNIQUE, the cut is reported in bytes and lines, and the seam is printed so the result is read
back rather than trusted (the rule: believe the file, not the tool's report).

Removes:
  prompt.ts      - captureSidecar (~300 lines): generated a summary at the turn boundary. Its two
                   call sites went in bff5f50f7a, so it is unreachable.
  compaction.ts  - summaryRequestProse (the model-facing template), gapFillRequest and
                   mergeSummarySections (the repair loop around it). All three were only reachable
                   from the capture that no longer runs.

Deliberately NOT removed: diagnoseSummaryGaps, MIN_SUMMARY_SECTION_CHARS, isValidSummaryBody and the
row classification (isSummaryRequestMessage, renderSummaryBlock, IncrementalCheckpoint reading).
Those READ what was already generated - old sessions carry those rows, and a session resumed across
the upgrade may still hold a pending request. Generation dies; reading history stays.

Run: python experiments/2026-09-22_remove-dead-sidecar/cut.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "packages" / "opencode" / "src" / "session"

CUTS = [
    (
        SRC / "prompt.ts",
        "    const captureSidecar = (input: {",
        "    /**\n     * T3: emergency Layer-1 capture for the /summarize route",
        "captureSidecar",
    ),
    (
        SRC / "compaction.ts",
        "/**\n * Model-facing Layer-1 request:",
        "/** Extract ## Key decisions blocks from summary or messageStar text.",
        "summaryRequestProse",
    ),
    (
        SRC / "compaction.ts",
        "/** Targeted gap-fill request — only asks model for the deficient sections. */",
        "/**\n * True when an assistant turn is fully complete",
        "gapFillRequest + mergeSummarySections",
    ),
]


def main() -> int:
    for path, start_anchor, end_anchor, label in CUTS:
        text = path.read_text(encoding="utf-8")
        if text.count(start_anchor) != 1 or text.count(end_anchor) != 1:
            print(f"REFUSED {path.name}: anchor not unique "
                  f"(start {text.count(start_anchor)}, end {text.count(end_anchor)}) for {label}")
            return 1
        start = text.index(start_anchor)
        end = text.index(end_anchor)
        if start >= end:
            print(f"REFUSED {path.name}: anchors out of order for {label}")
            return 1
        removed = text[start:end]
        path.write_text(text[:start] + text[end:], encoding="utf-8")
        print(f"CUT {path.name}: {label} — {len(removed)} chars, {removed.count(chr(10))} lines")
        seam = text[:start].split("\n")[-4:] + text[end:].split("\n")[:6]
        print("  seam:")
        for line in seam:
            print(f"    | {line}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
