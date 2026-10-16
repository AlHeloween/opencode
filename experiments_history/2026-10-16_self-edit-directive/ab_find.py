"""A/B pair finder (t70 chunk 1): real errors in the 30-part corpus.

READ-ONLY over .opencode/data/opencode.db (sqlite URI mode=ro).
Finds: (a) CJK insertions (owner's field case), (b) retraction markers —
later-refuted claims. For each hit: part/message/session ids, line numbers,
and the NEXT message of the same session (real N+1 context).
Writes AB_CANDIDATES.json. No network. No commits.
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = Path(r"D:\zPython\opencode\.opencode\data\opencode.db")
sys.path.insert(0, str(HERE))
from mk_excerpts import PARTS, extract_text

CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]")
RETRACT = re.compile(
    r"неверно|неверн|ошибк|ошибоч|не так|на самом деле|противореч|исправл|"
    r"wrong|incorrect|mistake|retract|actually,? no|on second thought",
    re.IGNORECASE,
)


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    cur = con.cursor()
    cjk_hits, retract_hits = [], []
    for pid in PARTS:
        row = cur.execute(
            "SELECT data, session_id, message_id FROM part WHERE id = ?", (pid,)
        ).fetchone()
        if not row:
            continue
        text = extract_text(row[0])
        lines = text.splitlines()
        cjk_lines = [(i + 1, ln[:200]) for i, ln in enumerate(lines) if CJK.search(ln)]
        if cjk_lines:
            cjk_hits.append({"id": pid, "session": row[1], "message": row[2],
                             "n_lines": len(lines), "cjk": cjk_lines[:8],
                             "cjk_count": len(cjk_lines)})
        ret_lines = [(i + 1, ln[:200]) for i, ln in enumerate(lines) if RETRACT.search(ln)]
        if ret_lines:
            retract_hits.append({"id": pid, "session": row[1], "message": row[2],
                                 "n_lines": len(lines), "retract": ret_lines[:8],
                                 "retract_count": len(ret_lines)})
    # next message per hit message (real N+1 context)
    seen = {}
    for h in cjk_hits + retract_hits:
        key = (h["session"], h["message"])
        if key in seen:
            h["next"] = seen[key]
            continue
        nxt = cur.execute(
            "SELECT id, substr(data,1,300) FROM message "
            "WHERE session_id = ? AND time_created > "
            "(SELECT time_created FROM message WHERE id = ?) "
            "ORDER BY time_created LIMIT 2",
            (h["session"], h["message"]),
        ).fetchall()
        items = []
        for r in nxt:
            try:
                role = json.loads(r[1]).get("role", "?")
            except Exception:
                role = "?"
            items.append({"id": r[0], "role": role, "head": r[1][:300]})
        seen[key] = items
        h["next"] = seen[key]
    con.close()
    out = {"cjk_parts": len(cjk_hits), "retract_parts": len(retract_hits),
           "cjk": cjk_hits, "retract": retract_hits}
    (HERE / "AB_CANDIDATES.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"cjk_parts={len(cjk_hits)} retract_parts={len(retract_hits)}")
    for h in cjk_hits:
        print(f"CJK {h['id'][:12]} lines={h['n_lines']} hits={h['cjk_count']} next={[n['role'] for n in h['next']]}")
    for h in retract_hits:
        print(f"RET {h['id'][:12]} lines={h['n_lines']} hits={h['retract_count']} next={[n['role'] for n in h['next']]}")


if __name__ == "__main__":
    sys.exit(main())
