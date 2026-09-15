#!/usr/bin/env python3
"""KV-cache timeline analyzer — per-turn cache stats + cache-poisoning events.

Parses opencode session logs under ``.opencode/data/log/``:

* ``*_log_*.jsonl`` — cache hit/miss usage rows, cache marker checks,
  ``bug: system prompt content changed mid-session`` mutations,
  ``cache: prefix reset`` compaction events, system prompt lengths.
* ``*_diff_*.diff`` — consecutive-request diffs: added/removed/changed
  message counts, reasoning bytes, tool-result bytes.

Emits a markdown timeline per session plus cross-session summary. Supports
``--require-anchors`` which asserts the three recorded regression anchors
from 2026-08-27 are present (cold restart miss, mid-session system mutation,
new-session partial hit) — used as the oracle for this harness.

Usage::

    python 2026-08-28_analyze_cache_timeline.py                     # full report
    python 2026-08-28_analyze_cache_timeline.py --session ses_fba5  # filter
    python 2026-08-28_analyze_cache_timeline.py --since 2026-08-27T23:40
    python 2026-08-28_analyze_cache_timeline.py --require-anchors   # oracle
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone

DEFAULT_LOG_DIR = os.path.join(".opencode", "data", "log")

# Regression anchors recorded 2026-08-27 (see plans/2026-08-28_kv-cache-parity-guard.md):
ANCHOR_COLD_MISS_INPUT = 176137  # full re-prefill after process restart @23:44:22
ANCHOR_MUTATION_OLD = 95038  # system prompt grew mid-session @23:47:40 ...
ANCHOR_MUTATION_NEW = 150706  # ... +55.7k chars (nested AGENTS.md injection)
ANCHOR_PARTIAL_HIT_CACHEREAD = 41024  # new session first request hit @23:54:44


@dataclass
class Row:
    time_ms: int
    ts: str
    session: str
    event: str  # hit | miss | mutation | reset | marker | syslen
    input_tokens: int | None = None
    cache_read: int | None = None
    ratio: float | None = None
    message_id: str | None = None
    system_msg_count: int | None = None
    old_len: int | None = None
    new_len: int | None = None
    diff_line: int | None = None
    shrink_tokens: int | None = None
    sys_len: int | None = None
    note: str = ""


@dataclass
class DiffRow:
    time_ms: int
    session: str
    turns: str
    added: int
    removed: int
    changed: int
    reasoning_bytes: int
    tool_bytes: int


@dataclass
class Report:
    rows: list[Row] = field(default_factory=list)
    diffs: list[DiffRow] = field(default_factory=list)
    files_seen: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log-dir", default=DEFAULT_LOG_DIR, help="log directory (default: %(default)s)")
    parser.add_argument("--session", default=None, help="substring filter on session id")
    parser.add_argument("--since", default=None, help="ISO timestamp lower bound, e.g. 2026-08-27T23:40")
    parser.add_argument("--out", default=None, help="write markdown report to file instead of stdout")
    parser.add_argument(
        "--require-anchors",
        action="store_true",
        help="exit 1 unless the three 2026-08-27 regression anchors are found",
    )
    return parser.parse_args()


def short_session(session_id: str) -> str:
    return session_id[-6:] if session_id else "?"


def parse_logs(log_dir: str, session_filter: str | None, since_ms: int | None) -> Report:
    report = Report()
    for path in sorted(glob.glob(os.path.join(log_dir, "*_log_*.jsonl"))):
        report.files_seen += 1
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    message = str(entry.get("message", ""))
                    time_ms = int(entry.get("time_ms", 0))
                    if since_ms and time_ms < since_ms:
                        continue
                    session = str(entry.get("session_id", "") or "")
                    if session_filter and session_filter not in session:
                        continue
                    payload = entry.get("payload") or {}
                    row = _classify(time_ms, str(entry.get("ts", "")), session, message, payload)
                    if row:
                        report.rows.append(row)
        except OSError as error:
            print(f"warn: cannot read {path}: {error}", file=sys.stderr)
    report.rows.sort(key=lambda row: row.time_ms)
    return report


def _classify(time_ms: int, ts: str, session: str, message: str, payload: dict) -> Row | None:
    if message in ("cache hit", "cache miss"):
        return Row(
            time_ms=time_ms,
            ts=ts,
            session=session,
            event="hit" if message == "cache hit" else "miss",
            input_tokens=int(payload.get("inputTokens", 0) or 0),
            cache_read=int(payload.get("cacheReadTokens", 0) or 0),
            ratio=float(payload.get("cacheRatio", 0) or 0),
            message_id=str(payload.get("messageID", "") or "") or None,
        )
    if "system prompt content changed mid-session" in message:
        return Row(
            time_ms=time_ms,
            ts=ts,
            session=session,
            event="mutation",
            old_len=int(payload.get("oldLen", 0) or 0),
            new_len=int(payload.get("newLen", 0) or 0),
            diff_line=int(payload.get("diffLine", 0) or 0),
            note=f"{payload.get('oldLine', '')!r} -> {payload.get('newLine', '')!r}",
        )
    if "prefix reset" in message:
        return Row(
            time_ms=time_ms,
            ts=ts,
            session=session,
            event="reset",
            shrink_tokens=int(payload.get("shrinkTokens", 0) or 0),
        )
    if message == "cache marker check":
        return Row(
            time_ms=time_ms,
            ts=ts,
            session=session,
            event="marker",
            system_msg_count=int(payload.get("systemMsgCount", 0) or 0),
            note=f"hasCacheControl={payload.get('hasCacheControl')}",
        )
    if message == "system prompt ready (once)":
        content = str(payload.get("content", "") or "")
        return Row(time_ms=time_ms, ts=ts, session=session, event="syslen", sys_len=len(content))
    return None


DIFF_HEADER_A = re.compile(r"^--- turn-(\d+)\s+(.*)$")
DIFF_HEADER_B = re.compile(r"^\+\+\+ turn-(\d+)\s+(.*)$")
DIFF_COUNTS = re.compile(r"(\d+) added, (\d+) removed, (\d+) changed")


def parse_diffs(log_dir: str, session_filter: str | None, since_ms: int | None) -> list[DiffRow]:
    rows: list[DiffRow] = []
    for path in sorted(glob.glob(os.path.join(log_dir, "*_diff_*.diff"))):
        name = os.path.basename(path)
        parts = name.split("_")
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        time_ms = int(parts[0])
        if since_ms and time_ms < since_ms:
            continue
        session = parts[-1].removesuffix(".diff").removeprefix("ses_")
        if session_filter and session_filter not in session:
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError as error:
            print(f"warn: cannot read {path}: {error}", file=sys.stderr)
            continue
        turn_a = DIFF_HEADER_A.search(text)
        turn_b = DIFF_HEADER_B.search(text)
        counts = DIFF_COUNTS.search(text)
        reasoning_bytes = sum(len(line) for line in text.splitlines() if "[reasoning]" in line and line.startswith("+"))
        tool_bytes = sum(len(line) for line in text.splitlines() if line.startswith('+   {"type"'))
        rows.append(
            DiffRow(
                time_ms=time_ms,
                session=session,
                turns=f"{turn_a.group(1)}->{turn_b.group(1)}" if turn_a and turn_b else "?",
                added=int(counts.group(1)) if counts else 0,
                removed=int(counts.group(2)) if counts else 0,
                changed=int(counts.group(3)) if counts else 0,
                reasoning_bytes=reasoning_bytes,
                tool_bytes=tool_bytes,
            )
        )
    rows.sort(key=lambda row: row.time_ms)
    return rows


def since_to_ms(since: str | None) -> int | None:
    if not since:
        return None
    normalized = since.replace("Z", "+00:00")
    moment = datetime.fromisoformat(normalized)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return int(moment.timestamp() * 1000)


def render(report: Report) -> str:
    out: list[str] = []
    out.append("# KV-cache timeline report")
    out.append("")
    out.append(f"log files scanned: {report.files_seen}; usage/mutation rows: {len(report.rows)}; diffs: {len(report.diffs)}")
    out.append("")
    out.append("## Timeline (cache stats + poisoning events)")
    out.append("")
    out.append("| time | ses | event | input | cacheRead | ratio | sysMsgs | detail |")
    out.append("|------|-----|-------|------:|----------:|------:|--------:|--------|")
    for row in report.rows:
        detail = ""
        if row.event == "mutation":
            detail = f"len {row.old_len}->{row.new_len} @line {row.diff_line}; {row.note}"
        elif row.event == "reset":
            detail = f"shrink {row.shrink_tokens}"
        elif row.event == "syslen":
            detail = f"system len {row.sys_len}"
        elif row.event == "marker" and row.note:
            detail = row.note
        out.append(
            f"| {row.ts} | {short_session(row.session)} | {row.event} "
            f"| {row.input_tokens if row.input_tokens is not None else ''} "
            f"| {row.cache_read if row.cache_read is not None else ''} "
            f"| {f'{row.ratio:.3f}' if row.ratio is not None else ''} "
            f"| {row.system_msg_count if row.system_msg_count is not None else ''} "
            f"| {detail} |"
        )
    out.append("")
    out.append("## Request diffs (turn-over-turn)")
    out.append("")
    out.append("| time | ses | turns | added | removed | changed | reasoning bytes | tool bytes |")
    out.append("|------|-----|-------|------:|--------:|--------:|----------------:|-----------:|")
    for diff in report.diffs:
        out.append(
            f"| {datetime.fromtimestamp(diff.time_ms / 1000, tz=timezone.utc).strftime('%H:%M:%S')} "
            f"| {short_session('ses_' + diff.session)} | {diff.turns} | {diff.added} | {diff.removed} "
            f"| {diff.changed} | {diff.reasoning_bytes} | {diff.tool_bytes} |"
        )
    out.append("")
    hits = [row for row in report.rows if row.event == "hit"]
    misses = [row for row in report.rows if row.event == "miss"]
    if hits or misses:
        out.append("## Summary")
        out.append("")
        out.append(f"- hits: {len(hits)}; misses: {len(misses)}")
        if hits:
            ratios = [row.ratio for row in hits if row.ratio is not None]
            out.append(f"- hit ratio: min {min(ratios):.3f} / median {sorted(ratios)[len(ratios) // 2]:.3f} / max {max(ratios):.3f}")
            uncached = sorted(row.input_tokens or 0 for row in hits)
            out.append(f"- uncached tokens on hits: min {uncached[0]} / median {uncached[len(uncached) // 2]} / max {uncached[-1]}")
        markers = [row for row in report.rows if row.event == "marker"]
        no_marker = [row for row in markers if "hasCacheControl=False" in row.note]
        if markers:
            out.append(f"- marker checks: {len(markers)} (explicit cacheControl absent: {len(no_marker)})")
        mutations = [row for row in report.rows if row.event == "mutation"]
        out.append(f"- mid-session system mutations: {len(mutations)}")
        out.append("")
    return "\n".join(out)


def check_anchors(report: Report) -> int:
    found = {
        "cold-restart-miss (input=176137)": any(
            row.event == "miss" and row.input_tokens == ANCHOR_COLD_MISS_INPUT for row in report.rows
        ),
        f"system-mutation ({ANCHOR_MUTATION_OLD}->{ANCHOR_MUTATION_NEW})": any(
            row.event == "mutation" and row.old_len == ANCHOR_MUTATION_OLD and row.new_len == ANCHOR_MUTATION_NEW
            for row in report.rows
        ),
        f"new-session-partial-hit (cacheRead={ANCHOR_PARTIAL_HIT_CACHEREAD})": any(
            row.event == "hit" and row.cache_read == ANCHOR_PARTIAL_HIT_CACHEREAD for row in report.rows
        ),
    }
    print("## Anchors")
    print("")
    missing = 0
    for name, ok in found.items():
        mark = "FOUND" if ok else "MISSING"
        print(f"- [{mark}] {name}")
        if not ok:
            missing += 1
    print("")
    return 1 if missing else 0


def main() -> int:
    args = parse_args()
    since_ms = since_to_ms(args.since)
    report = parse_logs(args.log_dir, args.session, since_ms)
    report.diffs = parse_diffs(args.log_dir, args.session, since_ms)
    body = render(report)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(body)
        print(f"report written: {args.out}")
    else:
        print(body)
    if args.require_anchors:
        return check_anchors(report)
    if not report.rows and not report.diffs:
        print("no matching rows found — check --log-dir/--session/--since", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
