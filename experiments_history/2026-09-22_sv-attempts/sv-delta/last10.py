"""Print the last N semantic vectors exactly as the rows carry them — the owner reads them himself.

Verbose on purpose: this is not a statistic, it is the artefact. Each entry shows the message it
belongs to, its dominant, its weighted terms as written, and the chain it declares (md5 / prev-md5
plus whether that link actually holds against the previous vector). Extraction rules are the ones
the code uses: LAST marker wins per field, field anchored to the start of its own line, terms read
from the left and stopped at the first chunk that is not `term weight`.

Run: python experiments/2026-09-22_sv-delta/last10.py [N]
"""

import json
import re
import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parents[2] / ".opencode" / "data" / "opencode.db"
KEYWORDS = re.compile(r"^Keywords:\s*(.+)$", re.M)
DOMINANT = re.compile(r"^Semantic dominant:\s*(.+)$|^\s*dominant:\s*(.+)$", re.M)
OWN = re.compile(r"^md5:\s*([0-9a-f]{32})", re.M)
PREV = re.compile(r"^prev-md5:\s*([0-9a-f]{32})", re.M)
PAIR = re.compile(r"(.+?)\s+([0-9]*\.?[0-9]+)[.;\s]*$")
EMPTY = "0" * 32


def terms_of(line: str) -> list[str]:
    out = []
    for chunk in line.split(","):
        match = PAIR.match(chunk.strip())
        if not match:
            break
        out.append(f"{match.group(1).strip()} {match.group(2)}")
    return out


def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT message_id, session_id, data FROM part "
        "WHERE type = 'text' AND data LIKE '%Keywords:%' ORDER BY id"
    ).fetchall()
    con.close()

    per_message: dict[str, dict] = {}
    for message_id, session_id, raw in rows:
        try:
            payload = json.loads(raw)
        except Exception:
            continue
        text = payload.get("text") or ""
        kw_match = KEYWORDS.search(text)
        if not kw_match:
            continue
        terms = terms_of(kw_match.group(1))
        if not terms:
            continue
        dom_match = DOMINANT.search(text)
        dominant = (dom_match.group(1) or dom_match.group(2)).strip() if dom_match else "(no dominant)"
        own = OWN.findall(text)
        prev = PREV.findall(text)
        per_message[message_id] = {
            "session": session_id,
            "dominant": dominant,
            "terms": terms,
            "md5": own[-1] if own else None,
            "prev": prev[-1] if prev else None,
        }

    ordered = list(per_message.items())
    window = ordered[-count:]
    print(f"vectors with a Keywords line: {len(ordered)} · showing the last {len(window)}\n")
    for index, (message_id, entry) in enumerate(window, start=len(ordered) - len(window) + 1):
        print(f"{index:>3}. {message_id} [{entry['session'][:24]}]")
        print(f"     dominant: {entry['dominant']}")
        print(f"     keywords: {', '.join(entry['terms'])}")
        own = entry["md5"][:8] if entry["md5"] else "--------"
        prev = entry["prev"][:8] if entry["prev"] else "--------"
        print(f"     md5 {own} · prev-md5 {prev}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
