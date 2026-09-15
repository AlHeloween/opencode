"""Quick schema check of the codegraph DB."""
import sqlite3

DB = r"D:\zPython\opencode\.codegraph\codegraph.db"
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

for table in ["nodes", "edges", "files"]:
    print(f"\n=== {table} columns ===")
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    for r in rows:
        print(f"  {r[1]:30s} {r[2]}")

print("\n=== sample nodes (5) ===")
for r in conn.execute("SELECT * FROM nodes LIMIT 5").fetchall():
    print(f"  {r}")

print("\n=== sample edges (5) ===")
for r in conn.execute("SELECT * FROM edges LIMIT 5").fetchall():
    print(f"  {r}")

conn.close()
