"""Reproduce the 401 on GET /session/:id/message reported 2026-07-08 (oh: 2026-10-08).

Run:
    python experiments/2026-10-08_messages-401/repro.py

Uses tools/opencode_host.py against the worktree's OWN live host (owner's bin/ TUI).
The token is read there and NEVER printed here (Host.__repr__ prints url+pid only).
Raw bodies are saved under experiments/2026-10-08_messages-401/raw/ for evidence.
"""
import json
import sys
import time
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from opencode_host import connect  # noqa: E402

OUT = Path(__file__).resolve().parent / "raw"
TARGET = "ses_ee71eb62bffeGfzHDNQGaxq2Q6"
CONTROLS = ["ses_ee71eb865ffeZZyounpd8FJn2o", "ses_ee71eb514ffeI9TlISy8kYBwYj"]
BOUNDARY = "msg_118e14a0e001tSIMQsCfRxwN1D"
LIMITS = [None, 1, 10, 74, 75, 76, 100, 500]


def call(host, sid, limit):
    query = {} if limit is None else {"limit": limit}
    t0 = time.perf_counter()
    try:
        body = host.get(f"/session/{sid}/message", query)
        return 200, body, time.perf_counter() - t0
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            body = json.loads(raw)
        except ValueError:
            body = raw
        return error.code, body, time.perf_counter() - t0
    except urllib.error.URLError as error:
        return None, f"URLError: {error}", time.perf_counter() - t0


def summarize(status, body):
    if isinstance(body, list):
        ids = []
        for item in body:
            if isinstance(item, dict):
                info = item.get("info")
                ids.append(info.get("id") if isinstance(info, dict) else None)
        return {
            "status": status,
            "items": len(body),
            "first": ids[0] if ids else None,
            "last": ids[-1] if ids else None,
            "has_boundary": BOUNDARY in ids,
        }
    text = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    return {"status": status, "body": text[:300]}


def main() -> int:
    host = connect(str(ROOT))
    print(f"host: {host}")  # url + pid only, never the token
    OUT.mkdir(exist_ok=True)
    summary = []
    for sid in [TARGET, *CONTROLS]:
        for limit in LIMITS if sid == TARGET else [None, 75]:
            status, body, seconds = call(host, sid, limit)
            line = {"session": sid, "limit": limit, "seconds": round(seconds, 3), **summarize(status, body)}
            summary.append(line)
            print(json.dumps(line, ensure_ascii=False))
            name = f"{sid}_limit-{limit if limit is not None else 'none'}"
            (OUT / f"{name}.json").write_text(
                json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8"
            )
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
