#!/usr/bin/env python3
"""Scan assistant reasoning fields in raw-wire bodies for tool-call-shaped content.

The dual-field round-trip (reasoning + reasoning_details) feeds the model's own
thinking back into the prompt. If thinking contains tool-call syntax (DSML
tokens, invoke JSON, tool names with arguments), the model may treat its
thoughts as real history — duplicate executions / disguised-tool-call poison.

Scans the LATEST raw-wire body: per assistant message with reasoning, counts
tool-call-shaped fragments by category and prints examples.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

PATTERNS = {
    "dsml_token": re.compile(r"<\s*(?:\|\||\uff5c)\s*DSML\s*(?:\|\||\uff5c)", re.I),
    "invoke_tag": re.compile(r"<\s*invoke\b|<\s*function\b|<\s*tool\b", re.I),
    "fn_call_json": re.compile(r'"(?:name|function)"\s*:\s*"\w+"\s*,?\s*(?:"arguments"|"parameters")'),
    "arguments_key": re.compile(r'"arguments"\s*:\s*"\{'),
    "tool_call_word": re.compile(r"\btool_call(s)?\b|tool_calls?\s*[:(=]"),
    "antml_style": re.compile(r"<\s*(?:antml:)?(?:invoke|function_calls|tool_use)\b", re.I),
    "named_tool_json": re.compile(r'"(?:tool|command|toolName)"\s*:'),
}

TOOLS_HINT = ("read", "grep", "glob", "bash", "cmd", "edit", "write", "multiedit", "list", "webfetch")


def scan_reasoning(text: str) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    for kind, pattern in PATTERNS.items():
        match = pattern.search(text)
        if match:
            start = max(0, match.start() - 60)
            hits.append((kind, text[start : match.end() + 80].replace("\n", "\\n")))
    return hits


def main() -> int:
    paths = sorted(glob.glob(os.path.join(".opencode", "data", "gateway", "raw-wire", "*.json")))
    path = paths[-1]
    print(f"scanning: {os.path.basename(path)}")
    with open(path, encoding="utf-8") as handle:
        body_raw = str(json.load(handle).get("body_raw", ""))
    body = json.loads(body_raw)
    messages = body.get("messages") or []

    msgs_with_reasoning = 0
    dual_field = 0
    dup_bytes = 0
    reasoning_bytes_once = 0
    flagged = 0
    examples: list[str] = []

    for index, message in enumerate(messages):
        reasoning = message.get("reasoning")
        details = message.get("reasoning_details") or []
        if not isinstance(reasoning, str) or not reasoning:
            continue
        msgs_with_reasoning += 1
        detail_text = "".join(d.get("text", "") for d in details if isinstance(d, dict))
        if detail_text:
            dual_field += 1
            if detail_text == reasoning:
                dup_bytes += len(reasoning)
        reasoning_bytes_once += len(reasoning)
        hits = scan_reasoning(reasoning)
        if hits:
            flagged += 1
            if len(examples) < 5:
                kinds = ",".join(kind for kind, _ in hits)
                snippets = " || ".join(snippet for _, snippet in hits[:2])
                examples.append(f"  msg#{index} [{kinds}]: …{snippets}…")

    total_chars = len(body_raw)
    print(f"messages total: {len(messages)}, with reasoning: {msgs_with_reasoning}")
    print(f"dual-field (reasoning + reasoning_details): {dual_field}")
    print(f"reasoning chars (single copy): {reasoning_bytes_once}")
    print(f"duplicated chars (identical in both fields): {dup_bytes} (~{round(dup_bytes / 3.5)} tok per request)")
    print(f"reasoning messages with tool-call-shaped content: {flagged}")
    for example in examples:
        print(example)
    return 0


if __name__ == "__main__":
    sys.exit(main())
