"""Phase E excerpt builder (t70 self-edit directive).

READ-ONLY over .opencode/data/opencode.db (sqlite URI mode=ro).
Writes 6 batch files with numbered + tagged lines for aicall directive trials.
No product source touched. No network. No commits here.
"""
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = Path(r"D:\zPython\opencode\.opencode\data\opencode.db")

PARTS = [
    "prt_0ec9230270019lmkyKJwcurgU4",
    "prt_141361ec7001R1GVmAGN6EaegO",
    "prt_13471853e001nI6GpG95aCmZ1O",
    "prt_11f5fa3be001cgHu4RPPi9pyYm",
    "prt_123587520001AGbjp6FaC3Gyrz",
    "prt_1412e9150001yOzozC7jawHS3c",
    "prt_135047482001ia2Glp9u5namcD",
    "prt_1235aee380010QQUgUGEJ9DIIZ",
    "prt_1235e9a56001Kyot4LijZlrDxT",
    "prt_1192d539d001qz0BsPozEgogHM",
    "prt_13d6d71c2001NMcfE92iZPW7e9",
    "prt_13da98baf001VCiQX310Uj0aKE",
    "prt_13489b909001o2tnespNpicZxT",
    "prt_1352a665e001wQzwhgwpq7k03W",
    "prt_1413218e40013i6CIbvkatQlnH",
    "prt_142ee91ed001hRdNlB7CyE7eHh",
    "prt_12363ffc0001R6Myp3LIadhCfl",
    "prt_1172b9c290014NJj033hi5G7Om",
    "prt_0e3dd7878001Fuio11duvo8KcL",
    "prt_1350730bc001s78tZqYnoNbwpe",
    "prt_135509d2e001Q91psjo52X4feZ",
    "prt_116ebe244001N28WWqU75jhICw",
    "prt_14133d71a001J6G1UihhFkWJlU",
    "prt_13800abef0014ssLYpNatcVbU8",
    "prt_118f6cb85001cemQUQVixP7xzs",
    "prt_138028f1e0014sDxH49nYXfaRR",
    "prt_11eb0bde4001wDQ54Toz5nzC3o",
    "prt_11f1e293d0018rAB9n2i1cFxQJ",
    "prt_1350165f9001tHyAWAZQdoIwBr",
    "prt_11eae553f001TSF2wpoyVKLG5y",
]

MAX_LINES = 60
MAX_COLS = 200


def tag(n: int) -> str:
    return format((n * 2654435761) % 0x100000000, "08x")


def extract_text(raw: str) -> str:
    try:
        d = json.loads(raw)
    except Exception:
        return raw
    if isinstance(d, dict):
        t = d.get("text")
        if isinstance(t, str) and t:
            meta = d.get("metadata") or {}
            if isinstance(meta, dict) and meta:
                keys = sorted(meta.keys())
                return t + "\nmetadata: " + ",".join(keys)
            return t
        if t == "":
            meta = d.get("metadata") or {}
            desc = []
            for k, v in meta.items():
                if isinstance(v, dict):
                    keys = ",".join(sorted(v.keys()))
                    sig = v.get("signature") or ""
                    desc.append(f"{k}:{{{keys}}} signature={len(sig)}chars {sig[:80]}")
                else:
                    desc.append(f"{k}:{str(v)[:80]}")
            return "(empty reasoning text)\nmetadata: " + ("; ".join(desc) if desc else "(none)")
        return raw
    return raw if isinstance(raw, str) else ""


def to_lines(text: str) -> list:
    lines = text.splitlines() or [""]
    if len(lines) < 3 and sum(map(len, lines)) > 2000:
        wrapped: list = []
        for ln in lines:
            while len(ln) > MAX_COLS:
                wrapped.append(ln[:MAX_COLS])
                ln = "      \u21b3+" + ln[MAX_COLS:]
            wrapped.append(ln)
        return wrapped
    return lines

def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    cur = con.cursor()
    batches = []
    for bi in range(6):
        chunk = PARTS[bi * 5 : bi * 5 + 5]
        out_lines = []
        meta = []
        for pid in chunk:
            row = cur.execute("SELECT data FROM part WHERE id = ?", (pid,)).fetchone()
            if not row:
                out_lines.append(f"### {pid} — MISSING ROW")
                meta.append({"id": pid, "missing": True})
                continue
            text = extract_text(row[0])
            lines = to_lines(text)
            kept = lines[:MAX_LINES]
            out_lines.append(f"### EXCERPT {pid} ({len(lines)} lines total, showing {len(kept)})")
            for i, ln in enumerate(kept, start=1):
                out_lines.append(f"{i}  {tag(i)}: {ln[:MAX_COLS]}")
            out_lines.append("")
            meta.append({"id": pid, "total_lines": len(lines), "shown": len(kept)})
        batch_path = HERE / f"batch_{bi + 1:02d}.txt"
        batch_path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
        batches.append((str(batch_path), meta))
    con.close()
    print(json.dumps([{"file": f, "excerpts": m} for f, m in batches], indent=1))


if __name__ == "__main__":
    sys.exit(main())
