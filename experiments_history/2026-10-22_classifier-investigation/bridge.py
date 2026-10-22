"""Bounded investigation bridge; reuses the existing authenticated host client."""
import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))
from opencode_host import connect

MODELS = {
    "local": {"providerID": "opencode-go", "modelID": "minimax-m3.1-flash-free"},
    "research": {"providerID": "opencode", "modelID": "deepseek-v4.1-flash-free"},
    "verify": {"providerID": "opencode", "modelID": "glm-5.3-flash-free"},
}


def main():
    command, lane = sys.argv[1:3]
    receipt = HERE / (lane + "-session.json")
    host = connect(str(ROOT))
    if command == "create":
        if receipt.exists():
            raise RuntimeError("Session receipt exists; inspect before another creation")
        session = host.post("/session", {"title": "classifier-investigation:" + lane})
        receipt.write_text(json.dumps({"id": session["id"], "model": MODELS[lane]}, indent=2), encoding="utf-8")
        print(receipt.read_text(encoding="utf-8"))
    else:
        record = json.loads(receipt.read_text(encoding="utf-8"))
        sid = record["id"]
        if command == "send":
            text = Path(sys.argv[3]).read_text(encoding="utf-8")
            host.post("/session/" + sid + "/prompt_async", {
                "agent": "build", "model": MODELS[lane],
                "parts": [{"type": "text", "text": text}],
            })
            print(json.dumps({"session": sid, "status": "submitted; confirm by message read-back"}))
        elif command == "read":
            messages = host.get("/session/" + sid + "/message", {"limit": 12})
            (HERE / (lane + "-messages.json")).write_text(json.dumps(messages, ensure_ascii=False, indent=2), encoding="utf-8")
            rows = []
            for message in messages:
                info = message.get("info", {})
                if info.get("role") != "assistant":
                    continue
                parts = message.get("parts", [])
                rows.append({"id": info.get("id"), "finish": info.get("finish"), "time": info.get("time"),
                             "model": [info.get("providerID"), info.get("modelID")], "error": info.get("error"),
                             "text": "\n".join(p.get("text", "") for p in parts if p.get("type") == "text"),
                             "tool_errors": [p.get("state") for p in parts if p.get("type") == "tool" and p.get("state", {}).get("status") == "error"]})
            print(json.dumps({"session": sid, "status": host.get("/session/status").get(sid, "idle"), "assistant": rows}, ensure_ascii=False))
        elif command == "check":
            ast.parse(Path(__file__).read_text(encoding="utf-8"))
            print("syntax PASS")
        else:
            raise ValueError(command)


if __name__ == "__main__":
    main()
