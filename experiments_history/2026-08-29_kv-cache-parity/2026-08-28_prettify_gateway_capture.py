#!/usr/bin/env python3
r"""Prettify escaped single-line gateway captures (request body / SSE response).

The `!`-subdir captures are double-escaped dumps: request bodies store `\"`
for quotes, SSE streams store literal `\\n` between lines. One pass of
escape-reversal (regex `\\\\(.)`) restores the original text, then:
  * JSON files -> json.dumps(indent=2)
  * SSE files  -> real newlines + each `data: {...}` chunk pretty-printed

Usage:
  python 2026-08-28_prettify_gateway_capture.py [file1 file2 ...]
  (no args -> the two 6ce000a3 captures that motivated the script)

A `<file>.bak-raw` backup (non-.json extension, invisible to analyzer globs)
is written before rewriting.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys

DEFAULT_FILES = [
    r".opencode\data\gateway\per-response\!\2026-08-28T18-52-41-696Z-6ce000a3-0411-4d8b-a447-c814b40847ad.json",
    r".opencode\data\gateway\per-response\!\2026-08-28T18-53-47-150Z-6ce000a3-0411-4d8b-a447-c814b40847ad.json",
]

SIMPLE_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f"}


def unescape_once(text: str) -> str:
    r"""Reverse exactly one level of JSON-string escaping.

    `\"` -> `"`, real `\n` -> newline, `\\` -> `\`, `\\n` -> `\n` (kept as
    JSON escape). One pass, pairs consumed left-to-right.
    """
    return re.sub(r"\\(.)", lambda m: SIMPLE_ESCAPES.get(m.group(1), m.group(1)), text)


def pretty_json(text: str) -> str:
    return json.dumps(json.loads(text), ensure_ascii=False, indent=2)


def pretty_sse(text: str) -> str:
    out: list[str] = []
    for line in text.split("\n"):
        payload = line[6:] if line.startswith("data: ") else None
        if payload is not None and payload[:1] in "{[":
            try:
                out.append("data: " + json.dumps(json.loads(payload), ensure_ascii=False, indent=2))
                continue
            except json.JSONDecodeError:
                pass
        out.append(line)
    return "\n".join(out)


def prettify(path: str) -> None:
    size_before = os.path.getsize(path)
    shutil.copy2(path, path + ".bak-raw")
    with open(path, encoding="utf-8") as handle:
        raw = handle.read()
    text = unescape_once(raw)
    try:
        pretty, kind = pretty_json(text), "json"
    except json.JSONDecodeError:
        pretty, kind = pretty_sse(text), "sse"
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(pretty)
        if not pretty.endswith("\n"):
            handle.write("\n")
    print(f"{kind:<4} {size_before:>9} -> {os.path.getsize(path):>9} bytes  {path}")


def main() -> int:
    files = sys.argv[1:] or DEFAULT_FILES
    for path in files:
        if not os.path.exists(path):
            print(f"missing: {path}", file=sys.stderr)
            return 1
        prettify(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
