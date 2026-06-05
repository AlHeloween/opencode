import sqlite3

for label, path in [
    ("OLD", r"D:\zPython\opencode\bin_tst\tst1\.opencode\data\opencode.db"),
    ("NEW", r"D:\zPython\opencode\bin_tst\tst2\.opencode\data\opencode.db"),
]:
    c = sqlite3.connect(path)
    has_bal = "balance_snapshot" in [t[0] for t in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    has_fts = "part_fts" in [t[0] for t in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    
    # Check session table columns
    cols = [r[1] for r in c.execute("PRAGMA table_info(session)").fetchall()]
    
    print(f"{label}: balance_snapshot={has_bal}, part_fts={has_fts}")
    print(f"  session cols: {cols}")
    c.close()
