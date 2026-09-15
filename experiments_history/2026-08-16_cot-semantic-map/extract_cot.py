"""Extract reasoning parts from project DB → sentences JSONL.

Read-only sqlite query over the opencode project DB. Each reasoning part is
split into sentences (sequence + session + message + timestamp + text).
"""
from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / ".opencode" / "data" / "opencode.db"
OUT = Path(__file__).parent / "sentences.jsonl"


def split_sentences(text: str) -> list[str]:
    raw = re.split(r"(?<=[.!?])\s+|\n+", text)
    out: list[str] = []
    buf = ""
    for chunk in raw:
        chunk = chunk.strip()
        if not chunk:
            continue
        buf = f"{buf} {chunk}".strip() if buf else chunk
        if len(buf) >= 60:
            out.append(buf)
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return [s for s in out if len(s) >= 8]


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        """
        SELECT p.id, p.session_id, p.message_id, p.time_created, p.data,
               json_extract(m.data, '$.role') AS role
        FROM part p JOIN message m ON m.id = p.message_id
        WHERE json_extract(p.data, '$.type') = 'reasoning'
        ORDER BY p.time_created ASC
        """
    ).fetchall()
    con.close()

    seq = 0
    with OUT.open("w", encoding="utf-8") as f:
        for pid, sid, mid, ts, data, role in rows:
            text = json.loads(data).get("text", "")
            if not text:
                continue
            for s in split_sentences(text):
                f.write(
                    json.dumps(
                        {
                            "seq": seq,
                            "part": pid,
                            "session": sid,
                            "message": mid,
                            "role": role or "",
                            "time": ts,
                            "text": s,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                seq += 1
    print(f"wrote {seq} sentences -> {OUT}")


if __name__ == "__main__":
    main()
