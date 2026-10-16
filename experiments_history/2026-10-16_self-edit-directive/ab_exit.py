"""Print verbatim lines 19-27 of prt_11f5fa3b (exit-pair N). READ-ONLY."""
import json
import sqlite3
from pathlib import Path

DB = Path(r"D:\zPython\opencode\.opencode\data\opencode.db")
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
d = json.loads(con.execute(
    "SELECT data FROM part WHERE id='prt_11f5fa3be001cgHu4RPPi9pyYm'").fetchone()[0])
con.close()
for i, x in enumerate(d.get("text", "").splitlines()[18:27], start=19):
    print(f"{i}: {x[:220]}")
