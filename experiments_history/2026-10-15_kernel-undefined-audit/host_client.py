"""Narrow authenticated bridge; never print host credentials or provider configs."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from opencode_host import connect

host = connect(str(ROOT))
mode = sys.argv[1]
if mode == "probe":
    catalog = host.get("/provider")
    rows = []
    for provider in catalog.get("all", []):
        if provider.get("id") not in ("opencode", "opencode-go"):
            continue
        for model_id, model in provider.get("models", {}).items():
            if "muse" in model_id.lower() or ("glm" in model_id.lower() and "flash" in model_id.lower()):
                rows.append({"providerID": provider["id"], "modelID": model_id, "name": model.get("name")})
    agents = host.get("/agent")
    print(json.dumps({"host": host.url, "models": rows, "connected": catalog.get("connected"),
                      "agents": [item.get("name") for item in agents]}, ensure_ascii=False))
elif mode == "dispatch":
    request = json.loads((Path(__file__).parent / "request.json").read_text(encoding="utf-8"))
    session = host.post("/session", {"title": "Smit: kernel undefined contracts audit"})
    session_id = session["id"]
    (Path(__file__).parent / "session.json").write_text(json.dumps({"sessionID": session_id}), encoding="utf-8")
    host.post(f"/session/{session_id}/prompt_async", request)
    print(json.dumps({"sessionID": session_id, "dispatched": True, "model": request["model"]}))
elif mode == "followup":
    sid = json.loads((Path(__file__).parent / "session.json").read_text(encoding="utf-8"))["sessionID"]
    request = json.loads((Path(__file__).parent / "followup-request.json").read_text(encoding="utf-8"))
    if sid in host.get("/session/status"):
        raise RuntimeError("follow-up held: current turn is still busy")
    host.post(f"/session/{sid}/prompt_async", request)
    print(json.dumps({"sessionID": sid, "followup_dispatched": True}))
elif mode == "status":
    sid = json.loads((Path(__file__).parent / "session.json").read_text(encoding="utf-8"))["sessionID"]
    status = host.get("/session/status")
    messages = host.get(f"/session/{sid}/message", {"limit": 100})
    assistants = [message for message in messages if message.get("info", {}).get("role") == "assistant"]
    last = assistants[-1] if assistants else {}
    info = last.get("info", {})
    errors = [p.get("state", {}).get("error") for m in messages for p in m.get("parts", [])
              if p.get("type") == "tool" and p.get("state", {}).get("status") == "error"]
    done = sid not in status and info.get("finish") not in (None, "tool-calls") and info.get("time", {}).get("completed")
    texts = [p.get("text", "") for p in last.get("parts", []) if p.get("type") == "text"]
    print(json.dumps({"sessionID": sid, "busy": status.get(sid), "assistant_count": len(assistants),
                      "finish": info.get("finish"), "completed": bool(done), "modelID": info.get("modelID"),
                      "errors": errors, "final": texts if done else []}, ensure_ascii=False))
