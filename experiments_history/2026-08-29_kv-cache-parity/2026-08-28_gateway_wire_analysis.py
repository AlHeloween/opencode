#!/usr/bin/env python3
"""Gateway wire analyzer — raw bodies diff + response (wire-truth) analysis.

Sources (per gateway logger layout):
  raw-wire/<ts>_<uuid>.json     {url, headers, body(pretty), body_raw(actual bytes)}
  per-response/<ts>_<uuid>.json {status, headers(cf-ray, x-generation-id), body[SSE chunks]}
  gateway.log                   ttft per request (gateway.stream.first_chunk)

Per consecutive request pair (normalized: "max_tokens" scalar masked):
  * structural common byte-prefix length + % of the shorter body
  * first divergence position + context snippet (raw bytes around it)
  * messages alignment: fingerprint per message (role|tool ids|len), appended/removed
  * max_tokens delta reported separately (generation param, not prompt bytes)

Per response:
  * upstream provider (from SSE chunk "provider") — routing flips kill provider cache
  * usage from the last usage-bearing chunk: prompt/cached/completion tokens + cost
  * cf-ray colo + generation id + ttft

Usage: python 2026-08-28_gateway_wire_analysis.py [--gateway-dir PATH]
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

MAX_TOKENS_RE = re.compile(r'("max_tokens"\s*:\s*)(-?\d+)')
CAPTURE_NAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(.+)\.json$")


def parse_capture_name(name: str) -> tuple[str, str] | None:
    """2026-08-28T14-06-35-540Z-<uuid>.json -> (ts_part, uuid)."""
    match = CAPTURE_NAME_RE.match(name)
    return (match.group(1), match.group(2)) if match else None


def short(value: str, width: int = 8) -> str:
    return value[:width]


def iso(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%H:%M:%S")


def load_requests(gateway_dir: str) -> list[dict]:
    out = []
    for path in sorted(glob.glob(os.path.join(gateway_dir, "raw-wire", "*.json"))):
        parsed_name = parse_capture_name(os.path.basename(path))
        if not parsed_name:
            continue
        ts_part, uuid = parsed_name
        try:
            stamp = datetime.strptime(ts_part, "%Y-%m-%dT%H-%M-%S-%fZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError) as error:
            print(f"warn: cannot parse {path}: {error}", file=sys.stderr)
            continue
        body_raw = str(data.get("body_raw", ""))
        parsed = None
        try:
            parsed = json.loads(body_raw)
        except json.JSONDecodeError:
            pass
        out.append(
            {
                "ts": int(stamp.timestamp() * 1000),
                "uuid": uuid,
                "body_raw": body_raw,
                "parsed": parsed,
                "sha": hashlib.sha256(body_raw.encode("utf-8", "replace")).hexdigest(),
            }
        )
    out.sort(key=lambda item: item["ts"])
    return out


def load_responses(gateway_dir: str) -> dict[str, dict]:
    out = {}
    for path in sorted(glob.glob(os.path.join(gateway_dir, "per-response", "*.json"))):
        parsed_name = parse_capture_name(os.path.basename(path))
        if not parsed_name:
            continue
        ts_part, uuid = parsed_name
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                data = json.load(handle)
        except (OSError, json.JSONDecodeError) as error:
            print(f"warn: cannot parse {path}: {error}", file=sys.stderr)
            continue
        chunks = data.get("body") or []
        provider = None
        usage = None
        gen_id = str(data.get("headers", {}).get("x-generation-id", "") or "")
        for raw in chunks:
            try:
                chunk = json.loads(raw) if isinstance(raw, str) else raw
            except json.JSONDecodeError:
                continue
            if provider is None and chunk.get("provider"):
                provider = chunk.get("provider")
            if isinstance(chunk.get("usage"), dict):
                usage = chunk["usage"]
        out[uuid] = {
            "status": data.get("status"),
            "provider": provider,
            "usage": usage,
            "gen_id": gen_id,
            "cf_ray": str(data.get("headers", {}).get("cf-ray", "") or ""),
        }
    return out


def load_ttft(gateway_dir: str) -> dict[str, int]:
    ttft = {}
    path = os.path.join(gateway_dir, "gateway.log")
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if "gateway.stream.first_chunk" not in line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                request_id = str(entry.get("requestId", ""))
                if request_id and "ttftMs" in entry:
                    ttft[request_id] = int(entry["ttftMs"])
    except OSError as error:
        print(f"warn: cannot read {path}: {error}", file=sys.stderr)
    return ttft


def message_fingerprint(message: dict) -> str:
    role = str(message.get("role", "?"))
    tool_call_id = str(message.get("tool_call_id", "") or "")
    calls = message.get("tool_calls") or []
    ids = ",".join(str(call.get("id", "")) for call in calls)
    content = message.get("content")
    if isinstance(content, list):
        length = sum(len(json.dumps(part, ensure_ascii=False)) for part in content)
    elif isinstance(content, str):
        length = len(content)
    else:
        length = 0
    return f"{role}|{tool_call_id}|{ids}|{length}"


def describe_divergence(norm_prev: str, norm_curr: str, position: int) -> str:
    prev_ctx = norm_prev[max(0, position - 40) : position + 60].replace("\n", "\\n")
    curr_ctx = norm_curr[max(0, position - 40) : position + 60].replace("\n", "\\n")
    return f"@{position} …{prev_ctx[-55:]} ≠ …{curr_ctx[-55:]}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--gateway-dir",
        default=os.path.join(".opencode", "data", "gateway"),
        help="gateway logger directory (default: %(default)s)",
    )
    args = parser.parse_args()

    requests = load_requests(args.gateway_dir)
    responses = load_responses(args.gateway_dir)
    ttft = load_ttft(args.gateway_dir)
    if not requests:
        print("no raw-wire captures found")
        return 1

    print(f"requests: {len(requests)}, responses: {len(responses)}")
    print(
        "utc     | id8     | bytes  | structural prefix / divergence            "
        "   | msgs p->c       | max_tokens | routing              | provider | prompt/cached/completion  | cost | colo | ttft"
    )
    print("-" * 172)

    prev = None
    providers_seen: set[str] = set()
    routed = 0
    for request in requests:
        raw = request["body_raw"]
        parsed = request["parsed"] or {}
        uuid = request["uuid"]
        response = responses.get(uuid, {})
        usage = response.get("usage") or {}
        prompt = usage.get("prompt_tokens")
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens")
        completion = usage.get("completion_tokens")
        cost = usage.get("cost")
        provider = response.get("provider") or "-"
        colo = (response.get("cf_ray") or "").rsplit("-", 1)[-1] or "-"
        first_ttft = ttft.get(uuid)
        providers_seen.add(provider)

        messages = parsed.get("messages") or []
        max_tokens = parsed.get("max_tokens")

        # Routing pin (openrouter request body "provider" block) — config
        # provider.openrouter.options.routing → SDK model settings → wire.
        routing_block = parsed.get("provider") if isinstance(parsed, dict) else None
        if isinstance(routing_block, dict) and routing_block:
            routed += 1
            parts = []
            if routing_block.get("order"):
                parts.append(f"order={'+'.join(str(x) for x in routing_block['order'])}")
            if routing_block.get("allow_fallbacks") is False:
                parts.append("no-fallback")
            if routing_block.get("quantizations"):
                parts.append(f"q={'+'.join(str(x) for x in routing_block['quantizations'])}")
            routing_str = "; ".join(parts) if parts else "pin?"
        else:
            routing_str = "-"

        if prev is None:
            note = "first (baseline)"
            msgs_delta = f"{len(messages)}"
        else:
            prev_raw = prev["body_raw"]
            norm_prev = MAX_TOKENS_RE.sub(r"\1X", prev_raw)
            norm_curr = MAX_TOKENS_RE.sub(r"\1X", raw)
            # Structural common PREFIX (max_tokens scalar masked out).
            limit = min(len(norm_prev), len(norm_curr))
            prefix = 0
            while prefix < limit and norm_prev[prefix] == norm_curr[prefix]:
                prefix += 1
            # Structural common SUFFIX — append-only means: prefix + suffix covers
            # prev entirely, and the middle holds ONLY curr's inserted bytes.
            suffix_limit = min(len(norm_prev) - prefix, len(norm_curr) - prefix)
            suffix = 0
            while (
                suffix < suffix_limit
                and norm_prev[len(norm_prev) - 1 - suffix] == norm_curr[len(norm_curr) - 1 - suffix]
            ):
                suffix += 1
            inserted = len(norm_curr) - prefix - suffix
            pct = prefix / len(norm_prev) * 100 if norm_prev else 100.0

            prev_messages = (prev["parsed"] or {}).get("messages") or []
            prev_fps = [message_fingerprint(message) for message in prev_messages]
            curr_fps = [message_fingerprint(message) for message in messages]
            common = 0
            for a, b in zip(prev_fps, curr_fps):
                if a != b:
                    break
                common += 1
            removed = max(0, len(prev_fps) - common)
            added = max(0, len(curr_fps) - common)
            msgs_delta = f"{len(prev_fps)}->{len(curr_fps)} (+{added}/-{removed})"

            if removed > 0 or inserted < 0:
                note = f"MUTATION! prefix {pct:.2f}% suffix {suffix} inserted {inserted} — mid-history change"
            elif prefix + suffix >= len(norm_prev):
                note = f"PURE-APPEND: prefix {prefix}B ({pct:.1f}%) + suffix {suffix}B, inserted {inserted}B at @{prefix}"
            else:
                gap = len(norm_prev) - prefix - suffix
                note = f"MUTATION? gap {gap}B uncovered; prefix@{prefix} suffix@{suffix} — {describe_divergence(norm_prev, norm_curr, prefix)}"
        usage_str = f"{prompt}/{cached}/{completion}" if prompt is not None else "-"
        print(
            f"{iso(request['ts'])} | {short(uuid)} | {len(raw):>6} "
            f"| {note:<58} "
            f"| {msgs_delta:>15} | {max_tokens if max_tokens is not None else '-':>9} "
            f"| {routing_str:<20} | {provider:<8} | {usage_str:>24} | {cost if cost is not None else '-'} "
            f"| {colo:<4} | {first_ttft if first_ttft is not None else '-'}"
        )
        prev = request

    print(f"\nupstream providers seen: {sorted(providers_seen)}")
    print(f"routing pin present: {routed}/{len(requests)} requests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
