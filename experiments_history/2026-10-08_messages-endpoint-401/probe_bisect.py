"""Bisect which visible row breaks the plain-page encoding.

`before=<cursor of row i>` returns the oldest i rows as a PLAIN branch page
(more=false -> no cursor -> the framework encodes the array with
Schema.Array(MessageV2.WithParts)). Binary-search the smallest i that 401s:
the culprit is rows[i-1]. Token is never printed; raw bodies land in raw/.
"""
import base64
import json
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import opencode_host  # noqa: E402

OUT = Path(__file__).resolve().parent / "raw"
SID = "ses_ee71eb62bffeGfzHDNQGaxq2Q6"

record = opencode_host.lookup(str(ROOT))
assert record and opencode_host.is_live(record), "host not live"
AUTH = "Basic " + base64.b64encode(f"opencode:{record['token']}".encode()).decode()
BASE = record["url"].rstrip("/")

db = sqlite3.connect(f"file:{(ROOT / '.opencode' / 'data' / 'opencode.db').as_posix()}?mode=ro", uri=True)
rows = db.execute(
    "select id, time_created from message where session_id = ? and compacted = 0 order by time_created asc, id asc",
    (SID,),
).fetchall()
db.close()
print(f"visible rows: {len(rows)}")
for index, (ident, _) in enumerate(rows):
    print(f"  [{index:2}] {ident}")


def cursor_of(index: int) -> str:
    ident, created = rows[index]
    return base64.b64encode(json.dumps({"id": ident, "time": created}).encode()).decode()


def probe(before_index: int):
    """Oldest `before_index` rows; plain branch; returns (status, size, head)."""
    query = urllib.parse.urlencode(
        {"directory": str(ROOT), "limit": 500, "before": cursor_of(before_index)}
    )
    request = urllib.request.Request(f"{BASE}/session/{SID}/message?{query}", headers={"Authorization": AUTH})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        body = error.read()
        status = error.code
    (OUT / f"bisect_before-{before_index}.json").write_bytes(body)
    return status, len(body), body[:120].decode("utf-8", "replace")


results = {}
low, high = 1, len(rows)  # probe(1) known 200; probe(len(rows)) has no row -> use len-1 max
high = len(rows) - 1
while low < high:
    mid = (low + high) // 2
    status, size, head = probe(mid)
    results[mid] = status
    print(f"probe(before_index={mid}) -> {status} ({size} bytes) {head[:80]!r}")
    if status == 200:
        low = mid + 1
    else:
        high = mid

status, size, head = probe(low)
results[low] = status
print(f"probe(before_index={low}) -> {status} ({size} bytes) {head[:80]!r}")
print("smallest failing before_index:", low if status != 200 else "none")
if status != 200:
    print("culprit row:", rows[low - 1][0])
else:
    print("every prefix encodes; failing member is only in the full 75-row array")
