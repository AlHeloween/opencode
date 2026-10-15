"""Observable existing-session robot review; credentials stay in Host."""
import json
from pathlib import Path
import sys
ROOT = Path("D:/zPython/opencode")
sys.path.insert(0, str(ROOT / "tools"))
from opencode_host import connect
h = connect(str(ROOT))
sid = "ses_ec7e051faffenMgqqhHX7wzrui"
if sys.argv[1] == "models":
    p = h.get("/provider")
    for provider in p["all"]:
        if provider["id"] in ("opencode", "opencode-go"):
            print(json.dumps({"provider": provider["id"], "models": [k for k in provider["models"] if "muse" in k or "glm-5.3" in k]}))
elif sys.argv[1] in ("send", "send-final"):
    brief = "review-final.md" if sys.argv[1] == "send-final" else "review.md"
    print(h.post(f"/session/{sid}/prompt_async", {"agent": "explore", "model": {"providerID": "opencode", "modelID": "muse-spark-1.3-contributor-free"}, "parts": [{"type": "text", "text": (Path(__file__).parent / brief).read_text(encoding="utf-8") }]}))
elif sys.argv[1] == "read":
    rows = h.get(f"/session/{sid}/message", {"limit": 5})
    last = next((m for m in reversed(rows) if m["info"]["role"] == "assistant"), {})
    result = {"status": h.get("/session/status").get(sid), "info": last.get("info"), "parts": [p for p in last.get("parts", []) if p["type"] == "text" or p["type"] == "tool" and p.get("state", {}).get("status") == "error"]}
    target = "review-final-result.json" if len(sys.argv) > 2 and sys.argv[2] == "final" else "review-result.json"
    (Path(__file__).parent / target).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": result["status"], "finish": result["info"].get("finish"), "model": result["info"].get("modelID")}))
