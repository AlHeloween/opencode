"""Prove the masquerade class: declared endpoint errors surface as 401.

Cases (all with the SAME valid Basic credential):
  1. unknown session            -> expected 404/400 by intent
  2. `before` without `limit`   -> the endpoint DECLARES HttpApiError.BadRequest (session.ts:558)
  3. malformed query (limit=abc)-> Schema decode failure
If every one answers {"_tag":"Unauthorized"} the security-scheme loop is eating them.
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
SID = "ses_ee71eb62bffeGfzHDNQGaxq2Q6"


def get(path, query=None):
    url = BASE + path + "?" + urllib.parse.urlencode({"directory": str(ROOT), **(query or {})})
    request = urllib.request.Request(url, headers={"Authorization": AUTH})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


for tag, path, query in [
    ("unknown session       ", "/session/ses_doesnotexist00000000000000/message", {"limit": 2}),
    ("before without limit  ", f"/session/{SID}/message", {"before": "eyJpZCI6Im1zZ18xMThlMTRhNTkwMDFHckd5Z1hYUUl4cE9lUSIsInRpbWUiOjE3OTE0MTg3ODAyNDl9"}),
    ("limit=abc (bad type)  ", f"/session/{SID}/message", {"limit": "abc"}),
    ("negative limit        ", f"/session/{SID}/message", {"limit": -1}),
]:
    status, body = get(path, query)
    print(f"{tag}: status={status} body={body[:120].decode('utf-8', 'replace')!r}")
