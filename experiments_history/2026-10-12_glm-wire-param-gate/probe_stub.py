import json
import urllib.error
import urllib.request


def post(body):
    req = urllib.request.Request(
        "http://127.0.0.1:8791/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        r = urllib.request.urlopen(req, timeout=10)
        print("status", r.status, "|", r.read(200))
    except urllib.error.HTTPError as e:
        print("status", e.code, "|", e.read(300))


post({"model": "glm-stub", "repetition_penalty": 1.1})
post({"model": "glm-stub"})
