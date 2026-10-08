"""Final acceptance against the _build.ps1 candidate (dist/bin/opencode.exe) for the 2026-10-08 defect.

The candidate serves a SCRATCH worktree whose DB is a snapshot copy of this project's
(`prepare_dist_worktree.py`), so the real rows — including the unparsed tool part that made the
endpoint answer 401 — are exercised end to end. The owner's live TUI is never touched.

Run:  python experiments/2026-10-08_messages-401/verify_dist.py
"""
import base64
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import opencode_host  # noqa: E402

WORKTREE = str(Path(__file__).resolve().parent / "dist-worktree")
OUT = Path(__file__).resolve().parent / "raw-dist"
SID = "ses_ee71eb62bffeGfzHDNQGaxq2Q6"
BOUNDARY = "msg_118e14a0e001tSIMQsCfRxwN1D"
CULPRIT = "msg_118eb1f9e001MubqwDWiPzRFkn"
RAW_HEAD = '{"files":'

record = opencode_host.lookup(WORKTREE)
assert record is not None, "no host record in the candidate worktree — is the candidate running?"
assert opencode_host.is_live(record), "candidate host record is not live"
TOKEN = record["token"]
AUTH = "Basic " + base64.b64encode(f"opencode:{TOKEN}".encode()).decode()
BASE = record["url"].rstrip("/")
OUT.mkdir(exist_ok=True)

print(f"candidate: {record['url']} pid={record['pid']}")


def get(path, query=None, headers=None):
    url = BASE + path + "?" + urllib.parse.urlencode({"directory": WORKTREE, **(query or {})})
    request = urllib.request.Request(url, headers={"Authorization": AUTH} if headers is None else headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()


results = []


def record_case(case, status, ok, detail):
    results.append({"case": case, "status": status, "ok": bool(ok), "detail": detail})
    print(json.dumps(results[-1], ensure_ascii=False))


# A1 — the whole history, including the row whose tool part never parsed.
status, headers, body = get(f"/session/{SID}/message")
(OUT / "whole-history.json").write_bytes(body)
items = json.loads(body) if status == 200 else []
ids = [item["info"]["id"] for item in items] if isinstance(items, list) else []
culprit = None
for item in items:
    if item["info"]["id"] == CULPRIT:
        culprit = next((part for part in item["parts"] if part.get("type") == "tool"), None)
record_case(
    "A1 whole history (no limit)",
    status,
    status == 200 and len(items) == 75 and BOUNDARY in ids and CULPRIT in ids,
    {"items": len(items), "oldest_present": BOUNDARY in ids, "culprit_present": CULPRIT in ids},
)
record_case(
    "A1 culprit part served whole",
    200 if culprit else 0,
    bool(culprit)
    and culprit["state"]["input"] == {}
    and str(culprit["state"].get("metadata", {}).get("rawInput", "")).startswith(RAW_HEAD),
    {
        "input": culprit["state"]["input"] if culprit else None,
        "rawInputLen": len(str(culprit["state"].get("metadata", {}).get("rawInput", ""))) if culprit else 0,
    },
)

status, headers, body = get(f"/session/{SID}/message", {"limit": 75})
items75 = json.loads(body) if status == 200 else []
record_case("A1 limit=75", status, status == 200 and len(items75) == 75, {"items": len(items75)})

status, headers, body = get(f"/session/{SID}/message", {"limit": 74})
record_case(
    "A3 limit=74 cursor branch intact",
    status,
    status == 200 and "x-next-cursor" in headers and 'rel="next"' in headers.get("link", ""),
    {"items": len(json.loads(body)) if status == 200 else None},
)

# A2 — a declared BadRequest reports itself (400), never the swallowed Unauthorized.
before = base64.b64encode(json.dumps({"id": BOUNDARY, "time": 1}).encode()).decode()
status, headers, body = get(f"/session/{SID}/message", {"before": before})
record_case(
    "A2 declared BadRequest -> 400",
    status,
    status == 400 and b"Unauthorized" not in body,
    {"body": body[:120].decode("utf-8", "replace")},
)

# A4 — the query spelling of the credential still authenticates (no Authorization header).
query_auth = urllib.parse.urlencode({"directory": WORKTREE, "limit": 1, "auth_token": base64.b64encode(f"opencode:{TOKEN}".encode()).decode()})
request = urllib.request.Request(f"{BASE}/session/{SID}/message?{query_auth}")
try:
    with urllib.request.urlopen(request, timeout=60) as response:
        status, body = response.status, response.read()
except urllib.error.HTTPError as error:
    status, body = error.code, error.read()
record_case("A4 auth_token query -> 200", status, status == 200, {"body0": body[:80].decode("utf-8", "replace")})

# Known residual (NOT part of the acceptance): a missing session dies as 500 — measured on the
# pre-fix binary too (2026-08-10 probe), tracked by test/server/session-messages.test.ts:149.
status, headers, body = get("/session/ses_zzzzzzzzzzzzzzzzzzzzzzzzzz/message", {"limit": 2})
record_case("residual: missing session (expected 404 by the test) ", status, True, {"body0": body[:80].decode("utf-8", "replace")})

(OUT / "summary.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
failed = [r for r in results if not r["ok"]]
print(f"\n{len(results) - len(failed)}/{len(results)} cases as required")
sys.exit(1 if failed else 0)
