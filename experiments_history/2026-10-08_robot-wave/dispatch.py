"""Create one robot session per brief on the bin/ TUI server and send it (deepseek-flash pinned).

Importable: fleet.py uses brief_text()/dispatch(); the CLI below is the original script.
"""
import json, sys, urllib.parse, urllib.request
sys.path.insert(0, "D:/zPython/opencode/tools")

WT = "D:/zPython/opencode"
D = "D:/zPython/opencode/experiments/2026-10-08_robot-wave/"
BASE = "http://127.0.0.1:4096"
Q = "?directory=" + urllib.parse.quote(WT)
AGENT = "build"
MODEL = {"providerID": "deepseek", "modelID": "deepseek-flash"}


def brief_text(name):
    """The brief as sent: <name>.md + common.md."""
    return (open(D + name + ".md", encoding="utf-8").read() + "\n"
            + open(D + "common.md", encoding="utf-8").read())


def client():
    """(get, post) on the ONE host of the worktree; plain --port server as the older fallback."""
    try:
        from opencode_host import connect
        h = connect(WT)
        return h.get, h.post
    except Exception:  # older binary: plain --port server, no token
        def call(method, path, body=None):
            req = urllib.request.Request(BASE + path + Q, method=method,
                data=None if body is None else json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        return (lambda p, q=None: call("GET", p)), (lambda p, b: call("POST", p, b))


def dispatch(name):
    """Create session 'robot-wave:<name>', send the brief, merge sessions.json. Returns the session id."""
    get, post = client()
    s = post("/session", {"title": "robot-wave:" + name})
    post(f"/session/{s['id']}/prompt_async", {"agent": AGENT, "model": MODEL,
        "parts": [{"type": "text", "text": brief_text(name)}]})
    try:  # merge, never overwrite: watch.py and verification need the earlier robots too
        known = json.load(open(D + "sessions.json", encoding="utf-8"))
    except FileNotFoundError:
        known = {}
    known[name] = s["id"]
    json.dump(known, open(D + "sessions.json", "w"), indent=1)
    return s["id"]


if __name__ == "__main__":
    for name in sys.argv[1:]:
        print(name, dispatch(name))
