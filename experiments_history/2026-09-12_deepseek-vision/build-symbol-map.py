"""Build a COMPACT codegraph-style symbol map, render it to images, and test reading.

The insight this exploits: the blind test showed structural data survives pixel rendering
(`G0..G9` read perfectly) while prose does not (function bodies at 12-52% recall).
A codegraph pack is pure structure - names, kinds, line numbers, edges - so it is exactly
the content class that should survive.

The raw dump is unusable as an image too: 63,947 symbols = 4.28 MB = ~1.29M tokens as
text, which is 12 pages of images at 1,024 tokens each = 12,288 tokens. So the question is
not "does it fit one image" but "how many pages does a *useful* slice need".

This builds the slice a coding agent actually asks for: for a set of files, the symbol map
(name, kind, line) plus cross-file edges. Then it renders that to pages and writes both the
pack text and the ground truth, so the read-back can be scored mechanically.

Run: python experiments/2026-09-12_deepseek-vision/build-symbol-map.py [path-filter]
"""

from __future__ import annotations

import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DB = ROOT / ".codegraph" / "codegraph.db"
DIR = pathlib.Path(__file__).resolve().parent

FILTER = sys.argv[1] if len(sys.argv) > 1 else "session/"

KIND_ABBREV = {
    "function": "fn",
    "method": "m",
    "class": "cls",
    "interface": "if",
    "type_alias": "ty",
    "constant": "c",
    "variable": "v",
    "property": "p",
    "import": "imp",
    "enum": "en",
    "enum_member": "em",
    "route": "rt",
    "component": "cmp",
}


def main() -> None:
    db = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)

    nodes = db.execute(
        """
        SELECT id, kind, name, file_path, start_line, is_exported
        FROM nodes
        WHERE file_path LIKE ?
        ORDER BY file_path, start_line
        """,
        (f"%{FILTER}%",),
    ).fetchall()

    if not nodes:
        print(f"no nodes for filter {FILTER!r}")
        return

    node_ids = {n[0] for n in nodes}
    names = {n[0]: n[2] for n in nodes}

    edges = db.execute("SELECT source, target, kind FROM edges").fetchall()
    internal = [(s, t, k) for (s, t, k) in edges if s in node_ids and t in node_ids]

    by_file: dict[str, list] = {}
    for node in nodes:
        by_file.setdefault(node[3], []).append(node)

    lines: list[str] = []
    lines.append(f"# SYMBOL MAP  filter={FILTER}")
    lines.append(f"# files={len(by_file)} symbols={len(nodes)} internal_edges={len(internal)}")
    for path in sorted(by_file):
        short = path.split("/")[-1]
        lines.append(f"@{short}")
        for (_id, kind, name, _fp, line, exported) in by_file[path]:
            mark = "*" if exported else " "
            lines.append(f"{line:>5}{mark}{KIND_ABBREV.get(kind, kind[:3]):>4} {name}")

    # Cross-file edges, as "caller -> callee"
    lines.append("# EDGES")
    for source, target, kind in internal[:4000]:
        lines.append(f"{names.get(source, '?')}->{names.get(target, '?')} [{kind}]")

    pack = "\n".join(lines)
    (DIR / "symbol-map.txt").write_text(pack, encoding="utf-8")

    truth = {
        "filter": FILTER,
        "files": len(by_file),
        "symbols": len(nodes),
        "edges": len(internal),
        "chars": len(pack),
        "est_text_tokens": round(len(pack) / 3.33),
        "file_list": sorted(p.split("/")[-1] for p in by_file),
        "symbols_by_file": {
            p.split("/")[-1]: [
                {"name": n[2], "kind": n[1], "line": n[4], "exported": bool(n[5])}
                for n in sorted(by_file[p], key=lambda x: x[4])
            ]
            for p in sorted(by_file)
        },
        "sample_edges": [
            {"from": names.get(s, "?"), "to": names.get(t, "?"), "kind": k} for s, t, k in internal[:400]
        ],
    }
    (DIR / "symbol-map-truth.json").write_text(json.dumps(truth, indent=2), encoding="utf-8")

    pages = -(-len(pack) // 13440)
    print(f"filter={FILTER}")
    print(f"files={len(by_file)} symbols={len(nodes)} internal_edges={len(internal)}")
    print(f"pack: {len(pack)} chars, ~{truth['est_text_tokens']} tokens as text")
    print(f"as images: {pages} pages x 963 = {pages * 963} tokens")
    print(f"ratio text/images = {truth['est_text_tokens'] / (pages * 963):.2f}x")
    print(f"written: symbol-map.txt, symbol-map-truth.json")


if __name__ == "__main__":
    main()
