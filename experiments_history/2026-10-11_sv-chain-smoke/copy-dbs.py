import pathlib
import sqlite3

repo = pathlib.Path(__file__).resolve().parents[2]
stand = repo / "experiments" / "2026-10-11_sv-chain-smoke" / "stand"
(stand / ".opencode" / "data" / "memory").mkdir(parents=True, exist_ok=True)

for src, dst in [
    (repo / ".opencode" / "data" / "opencode.db", stand / ".opencode" / "data" / "opencode.db"),
    (repo / ".opencode" / "data" / "memory" / "memory.db", stand / ".opencode" / "data" / "memory" / "memory.db"),
]:
    source = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    target = sqlite3.connect(str(dst))
    with target:
        source.backup(target)
    source.close()
    target.close()
    print("copied", dst)
