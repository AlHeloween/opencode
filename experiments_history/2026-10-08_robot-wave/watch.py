"""One line per robot: busy/idle, model of the first assistant row, rows, tool errors, last finish.

Importable: fleet.py uses snapshot()/render(); the CLI below is the original script.
"""
import sys, json
sys.path.insert(0, "D:/zPython/opencode/tools")
from opencode_host import connect

ROOT = "D:/zPython/opencode"
D = ROOT + "/experiments/2026-10-08_robot-wave/"


def snapshot(h):
    """One row per robot; an unreadable session becomes a row with state UNREADABLE."""
    st = h.get("/session/status")
    rows = []
    for n, s in json.load(open(D + "sessions.json", encoding="utf-8")).items():
        try:
            m = h.get(f"/session/{s}/message")
        except Exception as e:  # one session's 401 (seen 2026-10-08 on t2) must not hide the others
            rows.append({"name": n, "state": "UNREADABLE", "error": str(e)})
            continue
        a = [x for x in m if x["info"]["role"] == "assistant"]
        last = a[-1]["info"] if a else {}
        rows.append({
            "name": n,
            "state": (st.get(s) or {}).get("type", "idle"),
            "models": {i["info"].get("modelID") for i in a},
            "rows": len(a),
            "tool_errors": sum(1 for x in a for p in x["parts"]
                               if p.get("type") == "tool" and p.get("state", {}).get("status") == "error"),
            "finish": last.get("finish"),
            "error": (last.get("error") or {}).get("name"),
        })
    return rows


def render(rows):
    """The script's one-line-per-robot shape."""
    out = []
    for r in rows:
        if r["state"] == "UNREADABLE":
            out.append(f"{r['name']} UNREADABLE via API: {r['error']}")
        else:
            out.append(f"{r['name']} {r['state']} {r['models']} rows {r['rows']} "
                       f"tool_err {r['tool_errors']} finish {r['finish']} err {r['error']}")
    return out


if __name__ == "__main__":
    print("\n".join(render(snapshot(connect(ROOT)))))
