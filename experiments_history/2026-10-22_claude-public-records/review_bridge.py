"""Read-only reviewer on the existing authenticated worktree host."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from opencode_host import connect


def main():
    host = connect(str(ROOT))
    sid = "ses_e9e5d41adffeUgrNVztMDV42ZB"
    if sys.argv[1] == "send":
        prompt = Path(sys.argv[2]).read_text(encoding="utf-8")
        host.post("/session/" + sid + "/prompt_async", {
            "agent": "build", "model": {"providerID": "opencode", "modelID": "glm-5.3-flash-free"},
            "parts": [{"type": "text", "text": prompt}],
        })
        print(json.dumps({"session": sid, "submitted": True}))
        return
    rows = host.get("/session/" + sid + "/message", {"limit": 8})
    report = {"session": sid, "status": host.get("/session/status").get(sid, "idle"), "messages": []}
    for row in rows:
        info = row.get("info", {})
        if info.get("role") != "assistant":
            continue
        parts = row.get("parts", [])
        report["messages"].append({
            "id": info.get("id"), "finish": info.get("finish"), "time": info.get("time"),
            "model": [info.get("providerID"), info.get("modelID")], "error": info.get("error"),
            "text": "\n".join(p.get("text", "") for p in parts if p.get("type") == "text"),
            "toolErrors": [p.get("state") for p in parts if p.get("type") == "tool"
                           and p.get("state", {}).get("status") == "error"],
        })
    (HERE / "reviewer-readback.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
