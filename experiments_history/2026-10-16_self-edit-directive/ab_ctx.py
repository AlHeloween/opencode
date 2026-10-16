"""A/B context extractor (t70 chunk 1): windows around known error sites.

READ-ONLY over .opencode/data/opencode.db. For CJK parts: every CJK line
+-6 context (cap 12 windows per part). For claim parts: fixed windows.
Writes AB_CTX.json. No network. No commits.
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
CJK_PARTS = ["prt_116ebe244001N28WWqU75jhICw",
             "prt_0e3dd7878001Fuio11duvo8KcL",
             "prt_1172b9c290014NJj033hi5G7Om"]
CLAIM_WINDOWS = {
    "prt_13471853e001nI6GpG95aCmZ1O": [(40, 60)],
    "prt_11f5fa3be001cgHu4RPPi9pyYm": [(1, 25)],
    "prt_1235aee380010QQUgUGEJ9DIIZ": [(50, 62)],
    "prt_13800abef0014ssLYpNatcVbU8": [(20, 32)],
}


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    cur = con.cursor()
    texts = {}
    want = set(CJK_PARTS) | set(CLAIM_WINDOWS)
    for pid in PARTS:
        if pid not in want:
            continue
        row = cur.execute("SELECT data FROM part WHERE id = ?", (pid,)).fetchone()
        texts[pid] = extract_text(row[0]).splitlines()
    con.close()
    out = {"cjk_windows": [], "claim_windows": {}}
    for pid in CJK_PARTS:
        lines = texts[pid]
        wins, used = [], 0
        for i, ln in enumerate(lines):
            if CJK.search(ln) and used < 12:
                lo, hi = max(0, i - 6), min(len(lines), i + 7)
                wins.append({"line": i + 1, "span": [lo + 1, hi],
                             "text": "\n".join(lines[lo:hi])[:3000]})
                used += 1
        out["cjk_windows"].append({"id": pid, "n": len(wins), "windows": wins})
    for pid, spans in CLAIM_WINDOWS.items():
        lines = texts[pid]
        out["claim_windows"][pid] = [
            {"span": [a, b], "text": "\n".join(lines[a - 1:b])[:3000]} for a, b in spans
        ]
    (HERE / "AB_CTX.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"cjk_windows={sum(w['n'] for w in out['cjk_windows'])} claim_parts={len(out['claim_windows'])}")


if __name__ == "__main__":
    sys.exit(main())
