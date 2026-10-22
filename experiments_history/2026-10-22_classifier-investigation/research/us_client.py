"""Minimal client for the local Universal Search Service (127.0.0.1:3005).

Built-in JSON bodies, so no shell quoting of request payloads is needed.
Responses are saved verbatim to --out and a bounded summary is printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3005"


def call(path: str, payload: dict | None, timeout: float) -> tuple[int, str]:
    url = BASE + path
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")


def extract_text(body: str) -> str:
    """Best-effort pull of the readable payload out of the service's JSON."""
    try:
        obj = json.loads(body)
    except Exception:
        return body
    for key in ("content", "markdown", "text", "cleaned_html"):
        val = obj.get(key) if isinstance(obj, dict) else None
        if isinstance(val, str):
            return val
        if isinstance(val, dict):
            for inner in ("content", "markdown", "text"):
                if isinstance(val.get(inner), str):
                    return val[inner]
    if isinstance(obj, dict) and isinstance(obj.get("results"), list):
        return json.dumps(obj.get("results"), ensure_ascii=False)[:200000]
    return body


def summarize(endpoint: str, status: int, body: str, out: str | None) -> None:
    if out:
        with open(out, "w", encoding="utf-8", newline="") as handle:
            handle.write(body)
    text = extract_text(body)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    print(json.dumps({
        "endpoint": endpoint,
        "http_status": status,
        "bytes_body": len(body.encode("utf-8")),
        "bytes_text": len(text.encode("utf-8")),
        "text_sha256": digest,
        "out": out,
        "head": text[:1200],
        "tail": text[-400:] if len(text) > 1400 else "",
    }, ensure_ascii=False))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["health", "status", "search", "context", "fetch", "sourcegraph"],
                    )
    ap.add_argument("--url")
    ap.add_argument("--query")
    ap.add_argument("--count", type=int, default=8)
    ap.add_argument("--out")
    ap.add_argument("--timeout", type=float, default=120.0)
    args = ap.parse_args()

    if args.command in ("health", "status"):
        http, body = call("/" + args.command, None, args.timeout)
        print(body[:4000])
        return 0 if http == 200 else 1

    if args.command == "search":
        payload = {"query": args.query or "", "count": args.count}
        path = "/web/search"
    elif args.command == "sourcegraph":
        payload = {"query": args.query or "", "count": args.count}
        path = "/web/sourcegraph"
    elif args.command == "fetch":
        payload = {"url": args.url}
        path = "/web/fetch"
    else:
        payload = {
            "query": args.url,
            "url": args.url,
            "scrape_formats": "markdown",
            "only_main_content": True,
        }
        path = "/web/context"

    if args.command == "scan":
        return scan_raw(args)

    http, body = call(path, payload, args.timeout)
    summarize(path, http, body, args.out)
    return 0 if http == 200 else 1


def scan_raw(args: argparse.Namespace) -> int:
    """Print bounded, unique excerpts of saved raw files matching a regex."""
    import glob
    import os
    import re

    pattern = re.compile(args.query or "refus|classifier|safety", re.I)
    seen: set[str] = set()
    hits = 0
    for path in sorted(glob.glob(os.path.join("experiments/2026-10-22_classifier-investigation/research/raw", "*.json"))):
        with open(path, encoding="utf-8", errors="replace") as handle:
            text = extract_text(handle.read())
        name = os.path.basename(path)
        blocks = [b.strip() for b in re.split(r"\n{2,}|(?<=[.!?])\s+(?=[A-Z\u0420-\u042f])", text)]
        for block in blocks:
            if not pattern.search(block):
                continue
            norm = " ".join(block.split())[:400]
            if norm in seen or len(norm) < 25:
                continue
            seen.add(norm)
            hits += 1
            print(f"[{name}] {norm}")
            if hits >= args.count:
                return 0
    return 0 if hits else 1


if __name__ == "__main__":
    sys.exit(main())
