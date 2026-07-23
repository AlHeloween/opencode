"""Benchmark structural diff performance."""
import time
import subprocess
import sys

ROOT = r"D:\zPython\opencode"
RUNS = 3

def bench(label: str, args: list[str], cwd: str = ROOT):
    times = []
    for _ in range(RUNS):
        t0 = time.perf_counter()
        subprocess.run(args, capture_output=True, cwd=cwd, timeout=30)
        elapsed = (time.perf_counter() - t0) * 1000
        times.append(elapsed)
    avg = sum(times) / len(times)
    print(f"  {label:30s} avg={avg:7.1f}ms  ({' / '.join(f'{t:.0f}ms' for t in times)})")
    return avg

print("=== Performance breakdown (3 runs each) ===\n")

# 1. Fossil diff
bench("fossil diff --brief", [
    "fossil", "diff", "--from", "c2a989f784", "--to", "3de6fa2d10", "--brief",
])

# 2. Full structural diff script
t_total = bench("structural_diff.py (full)", [
    sys.executable, r"tests\fossil-codegraph-smoke\structural_diff.py",
    "c2a989f784", "3de6fa2d10",
])

# 3. Codegraph DB: raw SQL - symbols query
import sqlite3
DB = ROOT + r"\.codegraph\codegraph.db"

def bench_sql(label: str, sql: str, params=()):
    times = []
    for _ in range(RUNS):
        conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        t0 = time.perf_counter()
        list(conn.execute(sql, params))
        elapsed = (time.perf_counter() - t0) * 1000
        times.append(elapsed)
        conn.close()
    avg = sum(times) / len(times)
    print(f"  {label:30s} avg={avg:7.1f}ms  ({' / '.join(f'{t:.0f}ms' for t in times)})")
    return avg

files = [
    "packages/opencode/src/session/constitution.ts",
    "packages/opencode/src/cli/cmd/tui/component/dialog-navigation.tsx",
    "packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx",
    "packages/opencode/test/tool/bash.test.ts",
    "packages/opencode/test/tool/cmd.test.ts",
    "tests/test_reasoning_kernel.py",
]

# Get node IDs for these files
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
node_ids = [r[0] for r in conn.execute(
    "SELECT id FROM nodes WHERE file_path IN ({})".format(",".join("?" for _ in files)),
    files,
).fetchall()]
conn.close()

bench_sql(f"nodes query ({len(files)} files, {len(node_ids)} node ids)", 
    "SELECT * FROM nodes WHERE file_path IN ({})".format(",".join("?" for _ in files)),
    files)

bench_sql(f"caller edges (6K refs filtered to {len(node_ids)} targets)",
    "SELECT * FROM edges WHERE kind='references' AND target IN ({})".format(",".join("?" for _ in node_ids)),
    node_ids)

bench_sql("full join: edges + src nodes + tgt nodes",
    """SELECT src.kind, src.name, tgt.kind, tgt.name
       FROM edges e
       JOIN nodes src ON e.source = src.id
       JOIN nodes tgt ON e.target = tgt.id
       WHERE e.kind='references' AND e.target IN ({})
    """.format(",".join("?" for _ in node_ids)),
    node_ids)

print(f"\nFull script total: {t_total:.0f}ms (includes fossil + Python startup)")
