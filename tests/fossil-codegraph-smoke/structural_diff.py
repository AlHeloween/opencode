"""
Smoke test: Fossil snapshot → CodeGraph structural diff.

Takes two fossil snapshot hashes, finds changed files via `fossil diff`,
queries the codegraph SQLite DB for symbols in those files, and traces
caller/dependent impact.

Usage:
    python structural_diff.py <from_hash> <to_hash>
    python structural_diff.py ef6b7730cb 3de6fa2d10
"""

import sqlite3
import subprocess
import sys
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CODEGRAPH_DB = ROOT / ".codegraph" / "codegraph.db"


def fossil_diff(from_hash: str, to_hash: str) -> list[str]:
    """Return list of changed file paths from fossil diff."""
    result = subprocess.run(
        ["fossil", "diff", "--from", from_hash, "--to", to_hash, "--brief"],
        capture_output=True, text=True, cwd=str(ROOT), timeout=30,
    )
    if result.returncode != 0:
        print(f"Fossil error: {result.stderr}")
        sys.exit(1)

    files = []
    for line in result.stdout.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        # fossil diff --brief output: "CHANGED  path/to/file" or "ADDED  path/to/file"
        parts = line.split(None, 1)
        if len(parts) == 2:
            status, path = parts
            files.append((status, path))
    return files


def file_in_codegraph(db_path: str) -> set[str]:
    """Return set of files tracked in codegraph (normalized paths)."""
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        rows = conn.execute("SELECT path FROM files WHERE language IS NOT NULL").fetchall()
        conn.close()
        return {row[0].replace("\\", "/") for row in rows}
    except Exception as e:
        print(f"Codegraph DB error: {e}")
        return set()


def symbols_in_files(db_path: str, files: list[str]) -> list[dict]:
    """Return all symbols (nodes) in the given files."""
    if not files:
        return []

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        placeholders = ",".join("?" for _ in files)
        query = f"""
            SELECT kind, name, file_path, start_line, end_line
            FROM nodes
            WHERE file_path IN ({placeholders})
            ORDER BY kind, name
        """
        rows = conn.execute(query, files).fetchall()
        conn.close()

        return [
            {
                "kind": row[0],
                "name": row[1],
                "file_path": row[2],
                "line_start": row[3],
                "line_end": row[4],
            }
            for row in rows
        ]
    except Exception as e:
        print(f"Codegraph node query error: {e}")
        return []


def callers_of(db_path: str, symbols: list[dict]) -> list[dict]:
    """Find all nodes that reference (call/import/use) the given symbols."""
    if not symbols:
        return []

    # Build unique (file_path, name) pairs to match
    targets = {(s["file_path"].replace("\\", "/"), s["name"]) for s in symbols}

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

        # Edges: source (caller node id) → target (callee node id)
        # Match where target is one of our changed symbols
        # Build set of target node IDs
        target_ids = set()
        id_query = """
            SELECT id FROM nodes
            WHERE file_path IN ({placeholders})
        """.format(placeholders=",".join("?" for _ in targets))
        id_rows = conn.execute(
            id_query,
            [fp for fp, _ in targets]
        ).fetchall()
        target_ids = {row[0] for row in id_rows}

        if not target_ids:
            conn.close()
            return []

        # Query edges where target is one of our symbols
        query = f"""
            SELECT DISTINCT
                src.kind,
                src.name,
                src.file_path,
                src.start_line,
                tgt.kind,
                tgt.name,
                tgt.file_path
            FROM edges e
            JOIN nodes src ON e.source = src.id
            JOIN nodes tgt ON e.target = tgt.id
            WHERE e.kind = 'references'
              AND e.target IN ({','.join('?' for _ in target_ids)})
        """
        rows = conn.execute(query, list(target_ids)).fetchall()
        conn.close()

        callers = []
        seen = set()
        for row in rows:
            caller_file = row[2].replace("\\", "/") if row[2] else ""
            caller_name = row[1]
            tgt_file = (row[6] or "").replace("\\", "/")
            tgt_name = row[5]

            key = (tgt_file, tgt_name, caller_file, caller_name)
            if key in seen:
                continue
            seen.add(key)

            callers.append({
                "caller_kind": row[0],
                "caller_name": caller_name,
                "caller_file": caller_file,
                "caller_line": row[3],
                "target_kind": row[4],
                "target_name": tgt_name,
                "target_file": tgt_file,
            })

        return callers
    except Exception as e:
        print(f"Codegraph edge query error: {e}")
        return []


def main():
    if len(sys.argv) != 3:
        print("Usage: python structural_diff.py <from_hash> <to_hash>")
        sys.exit(1)

    from_hash, to_hash = sys.argv[1], sys.argv[2]

    print(f"=== Structural Diff: {from_hash[:8]} → {to_hash[:8]} ===\n")

    # 1. Get changed files
    changed = fossil_diff(from_hash, to_hash)
    if not changed:
        print("No file changes detected.")
        return

    print(f"Files changed ({len(changed)}):")
    for status, path in changed:
        print(f"  {status:8s} {path}")

    # 2. Filter to files codegraph can analyze
    cg_files = file_in_codegraph(str(CODEGRAPH_DB))
    source_files = [(s, p) for s, p in changed if p.replace("\\", "/") in cg_files]
    print(f"\nSource files analyzable by codegraph: {len(source_files)}")

    if not source_files:
        print("No source files with codegraph data — structural diff is empty.")
        return

    # 3. Get symbols in changed files
    file_paths = [p.replace("\\", "/") for _, p in source_files]
    symbols = symbols_in_files(str(CODEGRAPH_DB), file_paths)
    print(f"Symbols in changed files: {len(symbols)}")

    if not symbols:
        print("No symbols found in changed files.")
        return

    # Group by kind
    by_kind: dict[str, list] = {}
    for s in symbols:
        by_kind.setdefault(s["kind"], []).append(s)

    print("\n--- Symbols touched ---")
    for kind in sorted(by_kind):
        items = by_kind[kind]
        print(f"\n  [{kind}] ({len(items)}):")
        for item in items[:15]:  # cap per kind
            loc = f"L{item['line_start']}" if item["line_start"] else ""
            print(f"    {item['name']:50s} {loc}")
        if len(items) > 15:
            print(f"    ... and {len(items) - 15} more")

    # 4. Find callers/dependents
    print("\n--- Caller impact ---")
    callers = callers_of(str(CODEGRAPH_DB), symbols)
    print(f"Callers referencing touched symbols: {len(callers)}")

    if callers:
        # Group by caller file
        by_caller_file: dict[str, list] = {}
        for c in callers:
            by_caller_file.setdefault(c["caller_file"], []).append(c)

        for file in sorted(by_caller_file)[:10]:
            entries = by_caller_file[file]
            print(f"\n  {file} ({len(entries)} references):")
            for c in entries[:5]:
                print(f"    {c['caller_kind']:15s} {c['caller_name']:40s} → {c['target_name']}")
            if len(entries) > 5:
                print(f"    ... and {len(entries) - 5} more")
        if len(by_caller_file) > 10:
            print(f"\n  ... and {len(by_caller_file) - 10} more files with callers")

    print("\n=== Done ===")


if __name__ == "__main__":
    main()
