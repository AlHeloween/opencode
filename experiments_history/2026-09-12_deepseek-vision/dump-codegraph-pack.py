"""Dump the codegraph pack to a TEXT FILE - without reading it into the agent's context.

This is the point of the exercise: codegraph exists so the agent does not have to read
source files. But its pack is itself a wall of text, which costs tokens exactly like the
sources would. Here the pack is extracted straight from the SQLite index into a file, and
then rendered to images, so the agent never holds the text.

Outputs (in this directory):
  codegraph-pack.txt        the pack, as the agent-side tool would show it
  codegraph-pack-meta.json  row counts and sizes, for the record

Run: python experiments/2026-09-12_deepseek-vision/dump-codegraph-pack.py
"""

from __future__ import annotations

import json
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[2]
DB = ROOT / ".codegraph" / "codegraph.db"
DIR = pathlib.Path(__file__).resolve().parent
PACK = DIR / "codegraph-pack.txt"
META = DIR / "codegraph-pack-meta.json"


def main() -> None:
    meta: dict = {"db": str(DB)}
    if not DB.exists():
        PACK.write_text(f"missing db: {DB}\n", encoding="utf-8")
        return

    db = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    meta["tables"] = {}
    for table in tables:
        try:
            rows = db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            cols = [d[1] for d in db.execute(f'PRAGMA table_info("{table}")')]
            meta["tables"][table] = {"rows": rows, "cols": cols}
        except Exception as error:  # noqa: BLE001
            meta["tables"][table] = {"error": str(error)}

    lines: list[str] = []
    lines.append("# CodeGraph pack dump")
    lines.append(f"# tables: {', '.join(tables)}")
    lines.append("")

    # The two tables that carry the agent-visible pack.
    for table in ("nodes", "edges", "symbols", "files"):
        if table not in tables:
            continue
        cols = [d[1] for d in db.execute(f'PRAGMA table_info("{table}")')]
        lines.append(f"## {table}")
        lines.append("cols: " + ", ".join(cols))
        curious = db.execute(f'SELECT * FROM "{table}" LIMIT 4000')
        names = [d[0] for d in curious.description]
        for row in curious:
            record = dict(zip(names, row))
            lines.append(json.dumps(record, ensure_ascii=False, default=str))
        lines.append("")

    text = "\n".join(lines)
    PACK.write_text(text, encoding="utf-8")
    meta["pack"] = {
        "bytes": len(text.encode("utf-8")),
        "chars": len(text),
        "lines": text.count("\n") + 1,
        "est_text_tokens": round(len(text) / 3.33),
    }
    META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"pack: {meta['pack']}")


if __name__ == "__main__":
    main()
