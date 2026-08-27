#!/usr/bin/env python3
"""cg.py — my own codegraph packer (twin of opencode's tool/codegraph.ts hybrid).

Philosophy copied from packages/opencode/src/codegraph/{mcp-client,sqlite-pack}.ts:
the external MCP explore returns a wall of prose/source ("полотно"); we instead
pack STRUCTURE straight from the readonly .codegraph/codegraph.db SQLite index:
symbols by file, cross-file edges, external impact files — all hard-capped,
plus a <=1500-char fossil-style sym tag. MCP narrative suppressed.

Usage:
  python tools/cg.py <symbol> [symbol2 ...] [--file path1 path2 ...]
                      [--cap-symbols 120] [--cap-edges 80] [--cap-files 40]

Examples:
  python tools/cg.py ensureRunning cancel --file src/effect/runner.ts
  python tools/cg.py SessionPrompt
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys

DB = ".codegraph/codegraph.db"
SYM_CAP = 120
EDGE_CAP = 80
FILE_CAP = 40
TAG_CAP = 1500


def connect() -> sqlite3.Connection:
    if not os.path.exists(DB):
        sys.exit(f"no {DB} — run `codegraph init` first")
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    db.execute("PRAGMA busy_timeout = 5000")
    return db


def norm(p: str) -> str:
    return p.replace("\\", "/").lstrip("./")


def files_for_symbol(db: sqlite3.Connection, n: str, per_tier: int = 8) -> list[str]:
    """Tiered lookup: exact name -> qualified_name tail -> FTS token -> substring."""
    tiers = (
        ("SELECT DISTINCT file_path FROM nodes WHERE name = ? LIMIT ?", (n,)),
        ("SELECT DISTINCT file_path FROM nodes WHERE qualified_name LIKE ? LIMIT ?",
         ("%" + n,)),
        ("SELECT DISTINCT file_path FROM nodes JOIN nodes_fts ON nodes.id = nodes_fts.id "
         "WHERE nodes_fts MATCH ? LIMIT ?", (n,)),
        ("SELECT DISTINCT file_path FROM nodes WHERE name LIKE ? AND name != ? LIMIT ?",
         ("%" + n + "%", n)),
    )
    for sql, params in tiers:
        try:
            rows = db.execute(sql, params + (per_tier,)).fetchall()
        except sqlite3.OperationalError:
            continue
        if rows:
            return [norm(r[0]) for r in rows]
    return []


def node_ids(db: sqlite3.Connection, paths: list[str]) -> dict[str, tuple[str, str]]:
    ph = ",".join("?" * len(paths))
    rows = db.execute(
        f"SELECT id, name, file_path FROM nodes WHERE file_path IN ({ph})", paths
    ).fetchall()
    return {r[0]: (r[1], norm(r[2])) for r in rows}


def pack(db: sqlite3.Connection, paths: list[str], caps: dict[str, int]) -> str:
    ph = ",".join("?" * len(paths))

    syms = db.execute(
        f"""SELECT kind, name, file_path, start_line FROM nodes
            WHERE file_path IN ({ph}) AND kind != 'file'
            ORDER BY file_path,
              CASE kind WHEN 'class' THEN 1 WHEN 'struct' THEN 1
                WHEN 'function' THEN 2 WHEN 'method' THEN 3
                WHEN 'property' THEN 4 ELSE 10 END,
              name""",
        paths,
    ).fetchall()

    by_kind: dict[str, int] = {}
    for k, *_ in syms:
        by_kind[k] = by_kind.get(k, 0) + 1

    ids = node_ids(db, paths)
    idlist = list(ids.keys())
    raw: list[tuple[str, str, str, int | None]] = []
    chunk = 900
    for i in range(0, len(idlist), chunk):
        part = idlist[i : i + chunk]
        ph2 = ",".join("?" * len(part))
        raw += db.execute(
            f"SELECT e.source, e.target, e.kind, e.line FROM edges e "
            f"WHERE e.source IN ({ph2}) OR e.target IN ({ph2})",
            part + part,
        ).fetchall()

    # Second pass: resolve endpoints that live OUTSIDE the file set — dropping
    # them silently erased every cross-file edge (the first-cut bug).
    unresolved = {x for s, t, _, _ in raw for x in (s, t) if x not in ids}
    ul = list(unresolved)
    for i in range(0, len(ul), chunk):
        part = ul[i : i + chunk]
        ph2 = ",".join("?" * len(part))
        for nid, name, fp in db.execute(
            f"SELECT id, name, file_path FROM nodes WHERE id IN ({ph2})", part
        ):
            ids[nid] = (name, norm(fp))

    cross: list[tuple[str, str, str]] = []
    ext_files: set[str] = set()
    cross_kinds = {"calls", "imports", "references", "instantiates"}
    seen_edges: set[tuple[str, str, str]] = set()
    def lbl(name: str, fp: str, ln: int | None) -> str:
        # File-level nodes carry the path as their name — collapse the
        # duplicate ("agent.ts:agent.ts") to just the basename.
        base = os.path.basename(fp)
        body = base if name in (fp, base) else base + ":" + name
        return body + (f":{ln}" if ln else "")

    for s, t, kind, eline in raw:
        src, dst = ids.get(s), ids.get(t)
        if not src or not dst:
            continue
        (name_s, file_s), (name_t, file_t) = src, dst
        if file_s == file_t:
            continue
        edge = (lbl(name_s, file_s, eline), kind, lbl(name_t, file_t, None))
        if edge not in seen_edges:
            seen_edges.add(edge)
            cross.append(edge)
        if file_t not in paths and kind in cross_kinds:
            ext_files.add(file_t)

    lines = ["# CodeGraph pack (SQLite structure, MCP prose suppressed)", ""]
    lines.append(f"**Files ({len(paths)}):**")
    for f in paths[: caps["files"]]:
        lines.append(f"- `{f}`")
    if len(paths) > caps["files"]:
        lines.append(f"- … +{len(paths) - caps['files']} more")
    lines += ["", f"**Kinds:** {by_kind}",
              f"**Symbols:** {len(syms)} · **Cross-file:** {len(cross)}", ""]

    lines.append("## Symbols")
    if not syms:
        lines.append("_(none in index for these paths)_")
    else:
        cur = ""
        for kind, name, fp, ln in syms[: caps["symbols"]]:
            fpn = norm(fp)
            if fpn != cur:
                cur = fpn
                lines.append(f"### `{cur}`")
            loc = f":{ln}" if ln else ""
            lines.append(f"- `{kind}` **{name}**{loc}")
        if len(syms) > caps["symbols"]:
            lines.append(f"- … +{len(syms) - caps['symbols']} more")

    lines += ["", "## Cross-file edges"]
    if not cross:
        lines.append("_(none outside same-file)_")
    else:
        for frm, kind, to in cross[: caps["edges"]]:
            lines.append(f"- `{frm}` -{kind}-> `{to}`")
        if len(cross) > caps["edges"]:
            lines.append(f"- … +{len(cross) - caps['edges']} more")

    lines += ["", "## External impact files"]
    if not ext_files:
        lines.append("_(none outside the file set)_")
    else:
        for f in sorted(ext_files)[: caps["files"]]:
            lines.append(f"- `{f}`")

    kinds = ",".join(f"{k}={v}" for k, v in sorted(by_kind.items(), key=lambda kv: -kv[1]))
    top = ",".join(
        f"{n}[{k}@{os.path.basename(norm(fp))}]"
        for k, n, fp, _ in syms[:20]
        if k not in ("import", "file")
    )
    impact = ",".join(os.path.basename(f) for f in sorted(ext_files)[:12])
    tag = (
        f"KINDS:{kinds or 'none'}|TOP:{top or 'none'}"
        + (f"|IMPACT:{impact}" if impact else "")
        + f"|XF:{len(cross)}"
    )
    tag = tag[:TAG_CAP] + "…" if len(tag) > TAG_CAP else tag
    lines += ["", f"**symtag:** `{tag}`"]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description="compact CodeGraph SQLite pack")
    ap.add_argument("symbols", nargs="*", help="symbol names to locate files")
    ap.add_argument("--file", nargs="*", default=[], help="explicit relative paths")
    ap.add_argument("--cap-symbols", type=int, default=SYM_CAP)
    ap.add_argument("--cap-edges", type=int, default=EDGE_CAP)
    ap.add_argument("--cap-files", type=int, default=FILE_CAP)
    args = ap.parse_args()

    db = connect()
    try:
        paths = [norm(p) for p in args.file]
        missing = [p for p in paths if not os.path.exists(p)]
        if missing:
            sys.exit(f"path(s) not found: {missing}")
        merged: list[str] = []
        for p in paths:
            if p not in merged:
                merged.append(p)
        for n in args.symbols:
            for f in files_for_symbol(db, n):
                if f not in merged:
                    merged.append(f)
        if not merged:
            sys.exit("no files resolved — pass symbols or --file")
        print(
            pack(
                db,
                merged,
                {"symbols": args.cap_symbols, "edges": args.cap_edges, "files": args.cap_files},
            )
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
