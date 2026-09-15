#!/usr/bin/env python3
"""Backlog processor for gateway captures (mirrors the logger's raw-diff/.md).

For existing captures only — future ones are written by the logger itself:

* raw-wire/*.json      -> raw-wire/<name>.diff   (byte-true divergence report over
                          body_raw: prefix/suffix/inserted, message span containing
                          the divergence, prettified BEFORE/AFTER sections, RAW context)
* per-response/*.json  -> per-response/<name>.md (assembled reasoning from SSE chunks:
                          delta.reasoning + reasoning_details[].text, suffix-deduped)

Offsets are UTF-8 character indices in the decoded body_raw string (python str);
token estimates use the same chars/3.5 convention as the correlation tooling.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

CHARS_PER_TOKEN = 3.5
MASK_RE = re.compile(r'("max_tokens"\s*:\s*)(-?\d+)')


def mask_scalars(raw: str) -> tuple[str, int]:
    """Mask cache-neutral generation params (max_tokens). Shift = removed chars."""
    masked = MASK_RE.sub(lambda m: m.group(1) + "0", raw)
    return masked, len(raw) - len(masked)
MESSAGES_RE = re.compile(r'"messages"\s*:\s*\[')
ROLE_RE = re.compile(r'"role"\s*:\s*"([^"]*)"')


def message_spans(raw: str) -> list[dict]:
    match = MESSAGES_RE.search(raw)
    if not match:
        return []
    spans: list[dict] = []
    n = len(raw)
    i = match.end()
    while i < n:
        while i < n and raw[i] in " \t\r\n,":
            i += 1
        if i >= n or raw[i] != "{":
            break
        start = i
        depth = 0
        in_str = False
        esc = False
        while i < n:
            ch = raw[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            i += 1
        role_match = ROLE_RE.search(raw[start:i])
        spans.append({"start": start, "end": i, "role": role_match.group(1) if role_match else "?"})
    return spans


def raw_prefix_suffix(prev_raw: str, curr_raw: str) -> tuple[int, int, int]:
    limit = min(len(prev_raw), len(curr_raw))
    prefix = 0
    while prefix < limit and prev_raw[prefix] == curr_raw[prefix]:
        prefix += 1
    suffix_limit = min(len(prev_raw) - prefix, len(curr_raw) - prefix)
    suffix = 0
    while suffix < suffix_limit and prev_raw[len(prev_raw) - 1 - suffix] == curr_raw[len(curr_raw) - 1 - suffix]:
        suffix += 1
    return prefix, suffix, len(curr_raw) - prefix - suffix


def clamp_text(text: str, clamp: int) -> str:
    if len(text) <= clamp:
        return text
    head = int(clamp * 0.75)
    return f"{text[:head]}\n… (clamped, total {len(text)} chars) …\n{text[-(clamp - head):]}"


def clamp_lines(text: str, max_line: int = 240) -> str:
    return "\n".join(
        line if len(line) <= max_line else f"{line[:max_line]} … (+{len(line) - max_line} chars)"
        for line in text.split("\n")
    )


def render_raw_diff(prev_id: str, prev_raw: str, curr_id: str, curr_raw: str) -> str:
    prev_masked, prev_shift = mask_scalars(prev_raw)
    curr_masked, curr_shift = mask_scalars(curr_raw)
    prefix, suffix, inserted = raw_prefix_suffix(prev_masked, curr_masked)
    lines = [
        "RAW-WIRE DIVERGENCE REPORT (body_raw, byte-true; offsets = chars; max_tokens masked as cache-neutral)",
        f"prev: {prev_id} ({len(prev_raw)} chars)",
        f"curr: {curr_id} ({len(curr_raw)} chars)",
    ]
    covered_prev = prefix + suffix >= len(prev_masked)
    covered_curr = prefix + suffix >= len(curr_masked)
    if prev_raw == curr_raw or (covered_prev and covered_curr):
        lines.extend(["verdict: identical", "bodies identical — cache fully covered"])
        return "\n".join(lines) + "\n"
    if covered_prev:
        verdict = "pure-append" if len(curr_masked) > len(prev_masked) else "vanished"
    elif covered_curr:
        verdict = "vanished"
    else:
        verdict = "mutation"
    d_masked = min(prefix, len(curr_masked))
    d = d_masked + curr_shift  # RAW-space offset (mask only shortens before messages[])
    lines.extend([
        f"verdict: {verdict}",
        f"common prefix: {d_masked} masked chars ({d_masked / max(1, len(prev_masked)) * 100:.1f}% of prev) "
        f"| suffix: {suffix} | inserted: {inserted} @{d_masked}",
        f"est uncached: ~{round((len(curr_raw) - d) / CHARS_PER_TOKEN)} tok "
        f"(={len(curr_raw) - d} raw chars from offset {d} re-prefilled)",
    ])
    spans = message_spans(curr_masked)
    index = next((i for i, span in enumerate(spans) if span["start"] <= d_masked < span["end"]), None)
    if index is None and spans and d_masked >= spans[0]["start"]:
        # Boundary case (pure appends): attach to the next message starting at/after
        # the divergence — divergences before messages[] are envelope scalars.
        index = next((i for i, span in enumerate(spans) if span["start"] >= d_masked), None)
        if index is None:
            index = len(spans) - 1
    if index is not None:
        span = spans[index]
        lines.extend([
            f"divergence inside message: #{index} (role={span['role']}, "
            f"raw offset {span['start'] + curr_shift}, divergence at +{d_masked - span['start']} inside)",
            f"cache estimate: covered = first {index} messages; lost from raw offset {d}",
        ])
        if index > 0:
            prev_span = spans[index - 1]
            try:
                before = clamp_text(json.dumps(json.loads(curr_raw[prev_span["start"] + curr_shift:prev_span["end"] + curr_shift]), ensure_ascii=False, indent=2), 8000)
                lines.extend(["", f"@@ BEFORE — message #{index - 1} ({prev_span['role']}, prettified) @@", before])
            except json.JSONDecodeError:
                lines.extend(["", f"@@ BEFORE — message #{index - 1} @@ (unparseable span)"])
        try:
            after = clamp_text(json.dumps(json.loads(curr_raw[span["start"] + curr_shift:span["end"] + curr_shift]), ensure_ascii=False, indent=2), 8000)
            lines.extend(["", f"@@ AFTER — message #{index} ({span['role']}, prettified; divergence at +{d_masked - span['start']} inside) @@", after])
        except json.JSONDecodeError:
            lines.extend(["", f"@@ AFTER — message #{index} @@ (unparseable span)"])
    else:
        lines.append(f"cache estimate: lost from offset {d} (before/at envelope scalars or messages[])")
    lines.extend(["", f"@@ RAW context @{d} @@"])
    lines.append(f"prev: {prev_raw[max(0, d - 120):d].replace(chr(10), chr(92) + 'n')}")
    lines.append(f"curr: {curr_raw[max(0, d - 120):d + 240].replace(chr(10), chr(92) + 'n')}")
    return clamp_lines("\n".join(lines)) + "\n"


def collect_reasoning(chunks) -> tuple[str, str | None, str | None, dict | None]:
    parts: list[str] = []
    last = ""
    provider = model = None
    usage = None
    for chunk in chunks:
        if isinstance(chunk, str):
            payload = chunk[6:] if chunk.startswith("data: ") else chunk
            if payload == "[DONE]":
                continue
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
        if not isinstance(chunk, dict):
            continue
        provider = provider or chunk.get("provider")
        model = model or chunk.get("model")
        if isinstance(chunk.get("usage"), dict):
            usage = chunk["usage"]
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or choice.get("message") or {}
            piece = delta.get("reasoning")
            if isinstance(piece, str) and piece:
                parts.append(piece[len(last):] if piece.startswith(last) else piece)
                last = piece
            for detail in delta.get("reasoning_details") or []:
                text = (detail or {}).get("text")
                if isinstance(text, str) and text:
                    parts.append(text[len(last):] if text.startswith(last) else text)
                    last = text
    return "".join(parts), provider, model, usage


def process_raw_wire(gateway_dir: str) -> int:
    paths = sorted(glob.glob(os.path.join(gateway_dir, "raw-wire", "*.json")))
    written = 0
    prev: tuple[str, str] | None = None
    for path in paths:
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        body_raw = str(data.get("body_raw", ""))
        if prev is not None:
            report = render_raw_diff(prev[0], prev[1], name, body_raw)
            diff_path = os.path.join(gateway_dir, "raw-wire", name + ".diff")
            with open(diff_path, "w", encoding="utf-8", newline="") as handle:
                handle.write(report)
            written += 1
        prev = (name, body_raw)
    return written


def process_per_response(gateway_dir: str) -> int:
    paths = sorted(glob.glob(os.path.join(gateway_dir, "per-response", "*.json")))
    written = 0
    for path in paths:
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        body = data.get("body")
        chunks = body if isinstance(body, list) else ([body] if isinstance(body, str) and body else [])
        text, provider, model, usage = collect_reasoning(chunks)
        if not text.strip():
            continue
        captured = name.split("-")[0:6]
        header = [
            "# Gateway response — assembled reasoning",
            "",
            f"- id: {data.get('id', '?')}",
            f"- captured: {'-'.join(captured)}",
        ]
        if data.get("status") is not None:
            header.append(f"- status: {data['status']}")
        if provider:
            header.append(f"- provider: {provider}")
        if model:
            header.append(f"- model: {model}")
        if usage:
            header.append(
                f"- usage: {usage.get('prompt_tokens', '?')} prompt / "
                f"{(usage.get('prompt_tokens_details') or {}).get('cached_tokens', '?')} cached / "
                f"{usage.get('completion_tokens', '?')} completion"
            )
        md = "\n".join(header) + "\n\n## Reasoning\n\n" + text.strip() + "\n"
        md_path = os.path.join(gateway_dir, "per-response", name[:-5] + ".md")
        with open(md_path, "w", encoding="utf-8", newline="") as handle:
            handle.write(md)
        written += 1
    return written


def main() -> int:
    gateway_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(".opencode", "data", "gateway")
    diffs = process_raw_wire(gateway_dir)
    mds = process_per_response(gateway_dir)
    print(f"raw-wire divergence reports written: {diffs}")
    print(f"per-response reasoning .md written: {mds}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
