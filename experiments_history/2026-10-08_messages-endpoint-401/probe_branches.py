"""Discriminate which branch/row produces the 401.

single-row endpoint (`/session/:id/message/:messageID`, success = MessageV2.WithParts)
vs the plain page return vs the cursor branch. Token is never printed.
"""
import base64
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import opencode_host  # noqa: E402

record = opencode_host.lookup(str(ROOT))
assert record and opencode_host.is_live(record), "host not live"
AUTH = "Basic " + base64.b64encode(f"opencode:{record['token']}".encode()).decode()
BASE = record["url"].rstrip("/")
DIRECTORY = str(ROOT)

SID = "ses_ee71eb62bffeGfzHDNQGaxq2Q6"
BOUNDARY = "msg_118e14a0e001tSIMQsCfRxwN1D"
NEWER = "msg_118e14a59001GrGygXXQIxpOeQ"


def get(path, query=None):
    url = BASE + path + "?" + urllib.parse.urlencode({"directory": DIRECTORY, **(query or {})})
    req = urllib.request.Request(url, headers={"Authorization": AUTH})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            headers = {k.lower(): v for k, v in response.headers.items()}
            return response.status, headers, response.read()
    except urllib.error.HTTPError as error:
        headers = {k.lower(): v for k, v in error.headers.items()}
        return error.code, headers, error.read()


def show(tag, status, headers, body):
    text = body.decode("utf-8", "replace")
    print(f"{tag}: status={status} bytes={len(body)} next_cursor={headers.get('x-next-cursor')!r} body0={text[:160]!r}")


status, headers, body = get(f"/session/{SID}/message/{BOUNDARY}")
show("single(boundary)", status, headers, body)

status, headers, body = get(f"/session/{SID}/message/{NEWER}")
show("single(newer)   ", status, headers, body)

status, headers, body = get(f"/session/{SID}/message", {"limit": 74})
show("page(limit=74)  ", status, headers, body)
cursor = headers.get("x-next-cursor")

if cursor:
    status, headers, body = get(f"/session/{SID}/message", {"limit": 1, "before": cursor})
    show("before+limit=1  ", status, headers, body)

    status, headers, body = get(f"/session/{SID}/message", {"limit": 75, "before": cursor})
    show("before+limit=75 ", status, headers, body)
