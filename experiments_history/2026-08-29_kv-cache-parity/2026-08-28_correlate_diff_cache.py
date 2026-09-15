#!/usr/bin/env python3
"""Correlate request-diff churn (bytes) with provider cache loss per turn.

Join, per session, three evidence sources on one timeline:

* usage rows  — jsonl ``cache hit``/``cache miss`` (payload.inputTokens =
  UNCACHED tokens billed for this request; cacheReadTokens = cached prefix);
* diff files  — ``{ms}_diff_{model}_ses_{id}.diff``; churn = bytes of all
  ``-``/``+`` content lines inside the MESSAGES section (the formatted
  delta zone from the checkpoint prefix onward);
* guard rows  — llm stability guard events (``messages prefix restructured``
  / ``sent message content mutated``): prefix mutations that are INVISIBLE
  to the delta-zone diff.

Interpretation contract (user invariant: one changed byte anywhere in the
sent sequence kills the provider cache from that position):

* uncached ≈ churn/3.5 + new-tail        → suffix churn explains the loss;
* uncached ≫ churn/3.5 + new-tail + guard → prefix mutation (diff-blind);
* uncached low, churn low                → healthy append-only turn.

Usage: python 2026-08-28_correlate_diff_cache.py [--session ses_fba5] [--since ISO]
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone

DEFAULT_LOG_DIR = os.path.join(".opencode", "data", "log")
DEFAULT_DB = os.path.join(".opencode", "data", "opencode.db")
JOIN_WINDOW_MS = 8 * 60 * 1000  # usage row must follow its diff within 8 min
GUARD_WINDOW_MS = 2 * 60 * 1000  # guard row near the diff/usage moment
CHARS_PER_TOKEN = 3.5

USAGE_RE = re.compile(r"^cache (hit|miss)$")
GUARD_RE = re.compile(r"messages prefix restructured|sent message content mutated")
DIFF_COUNTS = re.compile(r"(\d+) added, (\d+) removed, (\d+) changed")
TURN_A = re.compile(r"^--- turn-(\d+)\s+(.*)$")
TURN_B = re.compile(r"^\+\+\+ turn-(\d+)\s+(.*)$")


@dataclass
class Usage:
    time_ms: int
    ts: str
    session: str
    hit: bool
    uncached: int
    cached: int
    ratio: float


@dataclass
class Guard:
    time_ms: int
    ts: str
    session: str
    message: str
    first_divergence: int | None
    message_count: int | None


@dataclass
class DiffChurn:
    time_ms: int
    session: str
    turns: str
    from_index: int | None
    added: int
    removed: int
    changed: int
    churn_bytes: int
    minus_bytes: int
    plus_bytes: int


def parse_usages(db_path: str, session_filter: str | None) -> list[Usage]:
    """Per-assistant-message provider usage from the session DB (survives log rotation)."""
    out: list[Usage] = []
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            """
            SELECT time_created, session_id, id,
                   json_extract(data, '$.tokens.input'),
                   json_extract(data, '$.tokens.cache.read'),
                   json_extract(data, '$.cacheRatio')
            FROM message
            WHERE json_extract(data, '$.role') = 'assistant'
              AND json_extract(data, '$.tokens') IS NOT NULL
            ORDER BY time_created
            """
        ).fetchall()
    finally:
        conn.close()
    for time_ms, session, msg_id, uncached, cached, ratio in rows:
        session = str(session or "").removeprefix("ses_")
        if session_filter and session_filter not in session:
            continue
        out.append(
            Usage(
                time_ms=int(time_ms),
                ts="",
                session=session,
                hit=(cached or 0) > 0,
                uncached=int(uncached or 0),
                cached=int(cached or 0),
                ratio=float(ratio) if ratio is not None else 0.0,
            )
        )
    out.sort(key=lambda item: item.time_ms)
    return out


def parse_guards(log_dir: str, session_filter: str | None) -> list[Guard]:
    out: list[Guard] = []
    for path in sorted(glob.glob(os.path.join(log_dir, "*_log_*.jsonl"))):
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
                    if not GUARD_RE.search(message):
                        continue
                    session = str(entry.get("session_id", "") or "")
                    if session_filter and session_filter not in session:
                        continue
                    payload = entry.get("payload") or {}
                    out.append(
                        Guard(
                            time_ms=int(entry.get("time_ms", 0)),
                            ts=str(entry.get("ts", "")),
                            session=session,
                            message=message,
                            first_divergence=payload.get("firstDivergence"),
                            message_count=payload.get("messageCount"),
                        )
                    )
        except OSError as error:
            print(f"warn: cannot read {path}: {error}", file=sys.stderr)
    out.sort(key=lambda item: item.time_ms)
    return out


def parse_diff_churn(log_dir: str, session_filter: str | None) -> list[DiffChurn]:
    out: list[DiffChurn] = []
    for path in sorted(glob.glob(os.path.join(log_dir, "*_diff_*.diff"))):
        name = os.path.basename(path)
        parts = name.split("_")
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        time_ms = int(parts[0])
        session = parts[-1].removesuffix(".diff").removeprefix("ses_")
        if session_filter and session_filter not in session:
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError as error:
            print(f"warn: cannot read {path}: {error}", file=sys.stderr)
            continue
        turn_a = TURN_A.search(text)
        turn_b = TURN_B.search(text)
        counts = DIFF_COUNTS.search(text)
        from_index = None
        from_match = re.search(r"^messages_from_index: (\d+)$", text, re.MULTILINE)
        if from_match:
            from_index = int(from_match.group(1))
        minus_bytes = 0
        plus_bytes = 0
        in_messages = False
        for line in text.splitlines():
            if line.startswith("@@ "):
                in_messages = "MESSAGES" in line
                continue
            if not in_messages:
                continue
            if DIFF_COUNTS.match(line.strip()):
                continue
            if line.startswith("( ") or line.startswith("... ("):
                continue
            if line.startswith("--- ") or line.startswith("+++ "):
                continue
            if line.startswith("-"):
                minus_bytes += len(line)
            elif line.startswith("+"):
                plus_bytes += len(line)
        out.append(
            DiffChurn(
                time_ms=time_ms,
                session=session,
                turns=f"{turn_a.group(1)}->{turn_b.group(1)}" if turn_a and turn_b else "?",
                from_index=from_index,
                added=int(counts.group(1)) if counts else 0,
                removed=int(counts.group(2)) if counts else 0,
                changed=int(counts.group(3)) if counts else 0,
                churn_bytes=minus_bytes + plus_bytes,
                minus_bytes=minus_bytes,
                plus_bytes=plus_bytes,
            )
        )
    out.sort(key=lambda item: item.time_ms)
    return out


def pearson(pairs: list[tuple[float, float]]) -> float:
    n = len(pairs)
    if n < 2:
        return float("nan")
    mean_x = sum(x for x, _ in pairs) / n
    mean_y = sum(y for _, y in pairs) / n
    cov = sum((x - mean_x) * (y - mean_y) for x, y in pairs)
    var_x = sum((x - mean_x) ** 2 for x, _ in pairs)
    var_y = sum((y - mean_y) ** 2 for _, y in pairs)
    if var_x == 0 or var_y == 0:
        return float("nan")
    return cov / (var_x**0.5 * var_y**0.5)


def fmt_k(value: int) -> str:
    return f"{value / 1000:.1f}k" if abs(value) >= 1000 else str(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log-dir", default=DEFAULT_LOG_DIR)
    parser.add_argument("--db", default=DEFAULT_DB, help="session DB (default: %(default)s)")
    parser.add_argument("--session", default=None, help="substring filter on session id")
    args = parser.parse_args()

    usages = parse_usages(args.db, args.session)
    guards: list[Guard] = []  # guard rows lived in rotated jsonl logs; DB has no event trail
    diffs = parse_diff_churn(args.log_dir, args.session)
    if not diffs:
        print("no diff files matched")
        return 1
    print(f"usage rows from DB: {len(usages)}; diffs: {len(diffs)}")

    sessions = sorted({item.session for item in diffs})
    for session in sessions:
        s_diffs = [item for item in diffs if item.session == session]
        s_usages = [item for item in usages if item.session == session]
        s_guards = [item for item in guards if item.session == session]
        print(f"\n=== session {session or '?'} — diffs: {len(s_diffs)}, usage rows: {len(s_usages)}, guard rows: {len(s_guards)} ===")
        print("utc_ms   | turns   | fromIdx | churn(-/+)      | a/r/c   | uncached | cached  | ratio | est_new~ | excess | guard")
        print("-" * 130)
        corr_pairs: list[tuple[float, float]] = []
        clean_uncached: list[int] = []
        joined: list[dict] = []
        for diff in s_diffs:
            usage = next(
                (
                    item
                    for item in s_usages
                    if diff.time_ms - 5000 <= item.time_ms <= diff.time_ms + JOIN_WINDOW_MS
                ),
                None,
            )
            guard = next(
                (
                    item
                    for item in s_guards
                    if diff.time_ms - GUARD_WINDOW_MS <= item.time_ms <= diff.time_ms + JOIN_WINDOW_MS
                ),
                None,
            )
            churn_est_tokens = int(diff.churn_bytes / CHARS_PER_TOKEN)
            uncached = usage.uncached if usage else None
            cached = usage.cached if usage else None
            ratio = usage.ratio if usage else None
            # Skip aborted/zero-token assistant placeholders — not real billed turns.
            if uncached == 0 and cached == 0:
                continue
            excess = None if uncached is None else uncached - churn_est_tokens
            if uncached is not None:
                corr_pairs.append((float(diff.churn_bytes), float(uncached)))
                joined.append(
                    {
                        "ts": datetime.fromtimestamp(diff.time_ms / 1000, tz=timezone.utc).strftime("%H:%M:%S"),
                        "churn": diff.churn_bytes,
                        "a": diff.added,
                        "r": diff.removed,
                        "c": diff.changed,
                        "uncached": uncached,
                        "cached": cached,
                        "est": churn_est_tokens,
                        "excess": excess,
                    }
                )
                if diff.churn_bytes < 500 and not guard:
                    clean_uncached.append(uncached)
            ts = datetime.fromtimestamp(diff.time_ms / 1000, tz=timezone.utc).strftime("%H:%M:%S")
            ratio_s = f"{ratio:>5.3f}" if ratio is not None else "    -"
            excess_s = f"{excess:>6}" if excess is not None else "     -"
            uncached_s = f"{uncached:>8}" if uncached is not None else "       -"
            cached_s = f"{cached:>7}" if cached is not None else "      -"
            guard_note = (
                f"{guard.message[:34]}@div={guard.first_divergence},n={guard.message_count}" if guard else "-"
            )
            print(
                f"{ts} | {diff.turns:>7} | {diff.from_index if diff.from_index is not None else '-':>7} "
                f"| {fmt_k(diff.minus_bytes):>7}/{fmt_k(diff.plus_bytes):>6} | {diff.added}/{diff.removed}/{diff.changed:>3} "
                f"| {uncached_s} | {cached_s} | {ratio_s} | {churn_est_tokens:>8} | {excess_s} | {guard_note}"
            )
        corr = pearson(corr_pairs)
        median_clean = sorted(clean_uncached)[len(clean_uncached) // 2] if clean_uncached else None
        print(f"\nPearson r(churn_bytes, uncached) = {corr:.3f} over {len(corr_pairs)} joined turns (zero-token placeholders excluded)")
        if median_clean is not None:
            print(f"clean-turn baseline (churn<500B, no guard): median uncached = {median_clean}")
        big = [item for item in s_diffs if item.churn_bytes > 20000]
        if big:
            total_churn = sum(item.churn_bytes for item in big)
            print(f"heavy-churn turns (>20k B): {len(big)}, total churn {fmt_k(total_churn)} ≈ {int(total_churn / CHARS_PER_TOKEN)} tokens")
        if joined:
            print("\nTOP-12 worst cache losses by excess (uncached − churn/3.5):")
            print("utc     | churn B  | a/r/c | uncached | cached  | hit%   | est_new~ | excess")
            for item in sorted(joined, key=lambda entry: entry["excess"], reverse=True)[:12]:
                total = item["uncached"] + item["cached"]
                hit_pct = (item["cached"] / total * 100) if total else 0.0
                print(
                    f"{item['ts']} | {item['churn']:>8} | {item['a']}/{item['r']}/{item['c']:>3} "
                    f"| {item['uncached']:>8} | {item['cached']:>7} | {hit_pct:>5.1f} "
                    f"| {item['est']:>8} | {item['excess']:>6}"
                )
    return 0


if __name__ == "__main__":
    sys.exit(main())
